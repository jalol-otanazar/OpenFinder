import { join } from 'node:path';
import { FileConfigStore } from '../config/config-store.js';
import { BlockingError, ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import {
  CatalogFileSchema,
  CatalogShardSchema,
  type CatalogFile,
  type CatalogShard,
} from '../core/types/program-record.js';
import type { CountryCode } from '../core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../core/types/run-manifest.js';
import { type UniverseEntry, type UniverseFile, UniverseFileSchema } from '../core/types/universe.js';
import { RoutedLlmClient } from '../llm/routed-client.js';
import { FileStore, type Store } from '../storage/store.js';
import { HttpFetcher } from '../tools/fetcher.js';
import { HttpSearchClient } from '../tools/search.js';
import { mergeCatalogShards } from './merge.js';
import { type PoolOutcome, runPool } from './pool.js';
import {
  LlmCatalogWorker,
  type CatalogBatch,
  type CatalogWorker,
  type CatalogWorkerResult,
} from './worker.js';

/** rules/03 §3.5 — default per-batch LLM-completion budget. */
const DEFAULT_LLM_CALL_BUDGET = 25;
/** Safety bound on resume passes — one pass clears everything at the default budget. */
const MAX_PASSES = 100;

export interface BuildCatalogOptions {
  force?: boolean;
  batchSize?: number;
  concurrency?: number;
  llmBudget?: number;
}

export interface BuildCatalogDeps {
  store?: Store;
  /** Inject a stub worker for offline tests; the default drives the real LLM. */
  worker?: CatalogWorker;
}

export interface CountryCatalogSummary {
  country: CountryCode;
  total: number;
  /** Processed = checked + no-programs + unreachable (docs/coverage-methodology.md). */
  processed: number;
  programsFound: number;
}

export interface BuildCatalogResult {
  runId: string;
  skipped: boolean;
  /** False when the LLM budget left institutions `unchecked` — re-run to resume. */
  complete: boolean;
  catalogPath: string;
  totalPrograms: number;
  remainingUnchecked: number;
  countries: CountryCatalogSummary[];
}

/**
 * The `catalog` skill (pipeline stage 3). The orchestrator: it slices the
 * `unchecked` institutions of `universe.json` into batches, dispatches workers
 * with bounded concurrency, and — as each worker returns its compact result —
 * flips universe statuses, records the batch, and merges the shards into
 * `catalog.json`. It holds only the manifest + universe index, never program
 * data (rules/03 §3.1). A re-run resumes from `unchecked` with zero lost work.
 */
export async function buildCatalog(
  runId: string,
  options: BuildCatalogOptions = {},
  deps: BuildCatalogDeps = {},
): Promise<BuildCatalogResult> {
  const store = deps.store ?? new FileStore();
  const runDir = store.resolveRunDir(runId);
  const manifestPath = join(runDir, 'run-manifest.json');

  if (!(await store.exists(manifestPath))) {
    throw new BlockingError(`no run manifest for run "${runId}"`, {
      hint: `run \`finder intake --run ${runId} ...\` first`,
    });
  }
  const manifest = await store.readJson(manifestPath, RunManifestSchema);

  if (manifest.stage_status.universe !== 'complete') {
    throw new BlockingError(`the universe for run "${runId}" is not built yet`, {
      hint: `run \`finder universe build --run ${runId}\` first`,
    });
  }

  const universePath = join(runDir, manifest.files.universe);
  if (!(await store.exists(universePath))) {
    throw new BlockingError(`universe.json is missing for run "${runId}"`, {
      hint: `run \`finder universe build --run ${runId}\` first`,
    });
  }
  const universe = await store.readJson(universePath, UniverseFileSchema);
  const catalogPath = join(runDir, manifest.files.catalog_merged);

  if (manifest.stage_status.catalog === 'complete' && !options.force) {
    return {
      runId,
      skipped: true,
      complete: true,
      catalogPath,
      totalPrograms: await readProgramCount(store, catalogPath),
      remainingUnchecked: 0,
      countries: summarize(universe),
    };
  }

  if (options.force) {
    for (const entry of universe.institutions) {
      entry.status = 'unchecked';
      entry.programs_found = null;
      entry.last_checked = null;
      entry.checked_by_batch = null;
    }
    manifest.batches = manifest.batches.filter((b) => b.stage !== 'catalog');
    await store.writeJson(universePath, universe, UniverseFileSchema);
  }

  const worker = deps.worker ?? (await defaultWorker(store));
  const batchSize = options.batchSize ?? manifest.concurrency.default_batch_size;
  const concurrency = options.concurrency ?? manifest.concurrency.max_parallel_workers;
  const llmBudget = options.llmBudget ?? DEFAULT_LLM_CALL_BUDGET;

  manifest.stage_status.catalog = 'in-progress';
  recomputeCoverage(manifest, universe);
  manifest.updated = new Date().toISOString();
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  const entryById = new Map(universe.institutions.map((e) => [e.id, e]));
  const startTimes = new Map<string, string>();
  let batchSeq = manifest.batches.filter((b) => b.stage === 'catalog').length;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const unchecked = universe.institutions.filter((e) => e.status === 'unchecked');
    if (unchecked.length === 0) break;

    const batches: CatalogBatch[] = sliceByCountry(unchecked, batchSize).map((institutions) => {
      const country = institutions[0]!.country;
      const batchId = `catalog-${country}-${String(++batchSeq).padStart(3, '0')}`;
      return {
        runId,
        batchId,
        country,
        institutions,
        fields: manifest.scope.fields,
        intake: manifest.scope.intake,
        llmCallBudget: llmBudget,
        shardPath: join(runDir, manifest.files.catalog_shards_dir, `${batchId}.json`),
      };
    });

    let progressed = 0;
    await runPool(
      batches,
      concurrency,
      (batch) => {
        startTimes.set(batch.batchId, new Date().toISOString());
        return worker.run(batch);
      },
      async (outcome) => {
        progressed += await applyOutcome(
          outcome,
          manifest,
          universe,
          entryById,
          startTimes,
          store,
          manifestPath,
          universePath,
        );
      },
    );

    // No batch made progress — stop cleanly; the run stays resumable.
    if (progressed === 0) {
      logger.warn('catalog: a pass made no progress — stopping; re-run to resume');
      break;
    }
  }

  // Merge every completed shard into catalog.json (skills/catalog step 6).
  const shards: CatalogShard[] = [];
  for (const batch of manifest.batches) {
    if (batch.stage !== 'catalog' || batch.status !== 'complete' || batch.shard_file.length === 0) {
      continue;
    }
    const shardPath = join(runDir, batch.shard_file);
    if (!(await store.exists(shardPath))) {
      logger.warn(`catalog: shard ${batch.shard_file} is missing — skipped in merge`);
      continue;
    }
    shards.push(await store.readJson(shardPath, CatalogShardSchema));
  }
  const programs = mergeCatalogShards(shards);
  const catalogFile: CatalogFile = {
    schema_version: '1.0',
    run_id: runId,
    generated: today(),
    program_count: programs.length,
    programs,
  };
  await store.writeJson(catalogPath, catalogFile, CatalogFileSchema);

  const remainingUnchecked = universe.institutions.filter((e) => e.status === 'unchecked').length;
  const complete = remainingUnchecked === 0;
  const now = new Date().toISOString();
  manifest.stage_status.catalog = complete ? 'complete' : 'in-progress';
  recomputeCoverage(manifest, universe);
  manifest.updated = now;
  manifest.log.push(
    `${now} catalog ${complete ? 'complete' : 'partial'} — ${programs.length} programs; ` +
      `${remainingUnchecked} institution(s) still unchecked`,
  );
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  return {
    runId,
    skipped: false,
    complete,
    catalogPath,
    totalPrograms: programs.length,
    remainingUnchecked,
    countries: summarize(universe),
  };
}

/** Apply one settled worker outcome to disk state. Returns institutions processed. */
async function applyOutcome(
  outcome: PoolOutcome<CatalogBatch, CatalogWorkerResult>,
  manifest: RunManifest,
  universe: UniverseFile,
  entryById: Map<string, UniverseEntry>,
  startTimes: Map<string, string>,
  store: Store,
  manifestPath: string,
  universePath: string,
): Promise<number> {
  const now = new Date().toISOString();
  const batch = outcome.item;
  const started = startTimes.get(batch.batchId) ?? now;

  if (!outcome.ok) {
    logger.warn(
      `catalog batch ${batch.batchId} failed (${describe(outcome.error)}) — ` +
        'its institutions stay unchecked and will be retried',
    );
    manifest.batches.push({
      batch_id: batch.batchId,
      stage: 'catalog',
      country: batch.country,
      institution_ids: batch.institutions.map((e) => e.id),
      status: 'failed',
      tool_calls_used: null,
      tool_call_budget: batch.llmCallBudget,
      shard_file: '',
      started,
      finished: now,
    });
    manifest.updated = now;
    await store.writeJson(manifestPath, manifest, RunManifestSchema);
    return 0;
  }

  const result = outcome.result;
  const checkedDate = today();
  let programCount = 0;
  for (const o of result.outcomes) {
    const entry = entryById.get(o.id);
    if (!entry) continue;
    entry.status = o.status;
    entry.programs_found = o.programsFound;
    entry.last_checked = checkedDate;
    entry.checked_by_batch = result.batchId;
    programCount += o.programsFound;
  }

  manifest.batches.push({
    batch_id: result.batchId,
    stage: 'catalog',
    country: batch.country,
    institution_ids: result.outcomes.map((o) => o.id),
    status: 'complete',
    tool_calls_used: result.llmCallsUsed,
    tool_call_budget: batch.llmCallBudget,
    shard_file: join(manifest.files.catalog_shards_dir, `${result.batchId}.json`),
    started,
    finished: now,
  });
  recomputeCoverage(manifest, universe);
  manifest.updated = now;
  manifest.log.push(
    `${now} catalog batch ${result.batchId} — ${result.outcomes.length} institution(s), ` +
      `${programCount} program(s)`,
  );
  logger.step(
    `${result.batchId}: ${result.outcomes.length} institution(s), ${programCount} program(s)` +
      (result.budgetExhausted ? ' (budget reached — remainder deferred)' : ''),
  );

  await store.writeJson(universePath, universe, UniverseFileSchema);
  await store.writeJson(manifestPath, manifest, RunManifestSchema);
  return result.outcomes.length;
}

/** Group institutions by country, then chunk each country's list. */
function sliceByCountry(entries: UniverseEntry[], size: number): UniverseEntry[][] {
  const byCountry = new Map<CountryCode, UniverseEntry[]>();
  for (const entry of entries) {
    const list = byCountry.get(entry.country) ?? [];
    list.push(entry);
    byCountry.set(entry.country, list);
  }
  const batches: UniverseEntry[][] = [];
  for (const list of byCountry.values()) {
    for (let i = 0; i < list.length; i += size) {
      batches.push(list.slice(i, i + size));
    }
  }
  return batches;
}

/** Coverage is computed from the universe, never estimated (CLAUDE.md). */
function recomputeCoverage(manifest: RunManifest, universe: UniverseFile): void {
  const counts = new Map<CountryCode, { total: number; checked: number }>();
  for (const entry of universe.institutions) {
    const c = counts.get(entry.country) ?? { total: 0, checked: 0 };
    c.total += 1;
    if (entry.status !== 'unchecked') c.checked += 1;
    counts.set(entry.country, c);
  }
  for (const [country, { total, checked }] of counts) {
    manifest.coverage[country] = {
      total,
      checked,
      ratio: total > 0 ? checked / total : 0,
    };
  }
}

function summarize(universe: UniverseFile): CountryCatalogSummary[] {
  const map = new Map<CountryCode, CountryCatalogSummary>();
  for (const entry of universe.institutions) {
    const s = map.get(entry.country) ?? {
      country: entry.country,
      total: 0,
      processed: 0,
      programsFound: 0,
    };
    s.total += 1;
    if (entry.status !== 'unchecked') s.processed += 1;
    s.programsFound += entry.programs_found ?? 0;
    map.set(entry.country, s);
  }
  return [...map.values()];
}

async function defaultWorker(store: Store): Promise<CatalogWorker> {
  const config = await new FileConfigStore().load();
  if (config.roles.worker.length === 0) {
    throw new ConfigError('no LLM model is configured for the "worker" role', {
      hint: 'run `finder setup` to configure a provider and model',
    });
  }
  const fetcher = new HttpFetcher();
  return new LlmCatalogWorker({
    llm: new RoutedLlmClient(config),
    fetcher,
    search: new HttpSearchClient(fetcher),
    store,
  });
}

async function readProgramCount(store: Store, catalogPath: string): Promise<number> {
  if (!(await store.exists(catalogPath))) return 0;
  const catalog = await store.readJson(catalogPath, CatalogFileSchema);
  return catalog.program_count;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
