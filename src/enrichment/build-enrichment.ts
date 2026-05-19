import { join } from 'node:path';
import { runPool, type PoolOutcome } from '../catalog/pool.js';
import { FileConfigStore } from '../config/config-store.js';
import { BlockingError, ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import {
  CatalogFileSchema,
  CatalogShardSchema,
  type CatalogFile,
  type ProgramRecord,
} from '../core/types/program-record.js';
import type { CountryCode } from '../core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../core/types/run-manifest.js';
import {
  ScholarshipFileSchema,
  ScholarshipShardSchema,
  type ScholarshipRecord,
} from '../core/types/scholarship-record.js';
import { StudentProfileSchema } from '../core/types/student-profile.js';
import { UniverseFileSchema } from '../core/types/universe.js';
import { RoutedLlmClient } from '../llm/routed-client.js';
import { FileStore, type Store } from '../storage/store.js';
import { HttpFetcher } from '../tools/fetcher.js';
import { HttpSearchClient } from '../tools/search.js';
import {
  LlmScholarshipWorker,
  type ScholarshipTask,
  type ScholarshipWorker,
} from './scholarships.js';
import {
  LlmEnrichmentWorker,
  type EnrichmentBatch,
  type EnrichmentWorker,
  type EnrichmentWorkerResult,
} from './worker.js';

/** rules/03 §3.5 — default per-batch LLM-completion budget. */
const DEFAULT_LLM_CALL_BUDGET = 25;
const MAX_PASSES = 100;
/** Scholarship-pass shards live here, beside `catalog/` under the run dir. */
const SCHOLARSHIP_SHARDS_DIR = 'scholarships/';

export interface BuildEnrichmentOptions {
  force?: boolean;
  batchSize?: number;
  concurrency?: number;
  llmBudget?: number;
}

export interface BuildEnrichmentDeps {
  store?: Store;
  worker?: EnrichmentWorker;
  scholarshipWorker?: ScholarshipWorker;
}

export interface CountryEnrichmentSummary {
  country: CountryCode;
  programs: number;
  enriched: number;
}

export interface BuildEnrichmentResult {
  runId: string;
  skipped: boolean;
  /** False when the LLM budget left programs unenriched — re-run to resume. */
  complete: boolean;
  catalogPath: string;
  scholarshipsPath: string;
  totalPrograms: number;
  enrichedPrograms: number;
  remainingPrograms: number;
  scholarshipsFound: number;
  countries: CountryEnrichmentSummary[];
}

/**
 * The `enrichment` skill (pipeline stage 4). It fills every catalog program's
 * detail sections from official pages and gathers scholarships. The orchestrator
 * slices unenriched programs into batches, dispatches workers with bounded
 * concurrency, and rewrites `catalog.json` as each batch returns. A re-run
 * resumes from the still-null sections with zero lost work.
 */
export async function buildEnrichment(
  runId: string,
  options: BuildEnrichmentOptions = {},
  deps: BuildEnrichmentDeps = {},
): Promise<BuildEnrichmentResult> {
  const store = deps.store ?? new FileStore();
  const runDir = store.resolveRunDir(runId);
  const manifestPath = join(runDir, 'run-manifest.json');

  if (!(await store.exists(manifestPath))) {
    throw new BlockingError(`no run manifest for run "${runId}"`, {
      hint: `run \`finder intake --run ${runId} ...\` first`,
    });
  }
  const manifest = await store.readJson(manifestPath, RunManifestSchema);

  if (manifest.stage_status.catalog !== 'complete') {
    throw new BlockingError(`the catalog for run "${runId}" is not built yet`, {
      hint: `run \`finder catalog build --run ${runId}\` first`,
    });
  }

  const catalogPath = join(runDir, manifest.files.catalog_merged);
  const scholarshipsPath = join(runDir, manifest.files.scholarships);
  if (!(await store.exists(catalogPath))) {
    throw new BlockingError(`catalog.json is missing for run "${runId}"`, {
      hint: `run \`finder catalog build --run ${runId}\` first`,
    });
  }
  const catalog = await store.readJson(catalogPath, CatalogFileSchema);
  const programs = catalog.programs;

  if (manifest.stage_status.enrichment === 'complete' && !options.force) {
    return {
      runId,
      skipped: true,
      complete: true,
      catalogPath,
      scholarshipsPath,
      totalPrograms: programs.length,
      enrichedPrograms: programs.filter(isEnriched).length,
      remainingPrograms: 0,
      scholarshipsFound: await countScholarships(store, scholarshipsPath),
      countries: summarize(programs),
    };
  }

  if (options.force) {
    for (const program of programs) {
      program.requirements = null;
      program.logistics = null;
      program.cost_and_funding = null;
      program.outcomes = null;
    }
    manifest.batches = manifest.batches.filter((b) => b.stage !== 'enrichment');
    await writeCatalog(store, catalogPath, runId, programs);
  }

  // institution_id → official_url, for the worker's homepage fetch.
  const universePath = join(runDir, manifest.files.universe);
  const officialUrlById = new Map<string, string>();
  if (await store.exists(universePath)) {
    const universe = await store.readJson(universePath, UniverseFileSchema);
    for (const entry of universe.institutions) officialUrlById.set(entry.id, entry.official_url);
  }

  // The student's nationality, if `intake` seeded a profile.
  const nationality = await readNationality(store, join(runDir, manifest.scope.profile_ref));

  const { worker, scholarshipWorker } =
    deps.worker && deps.scholarshipWorker
      ? { worker: deps.worker, scholarshipWorker: deps.scholarshipWorker }
      : await defaultWorkers(store);

  const batchSize = options.batchSize ?? manifest.concurrency.default_batch_size;
  const concurrency = options.concurrency ?? manifest.concurrency.max_parallel_workers;
  const llmBudget = options.llmBudget ?? DEFAULT_LLM_CALL_BUDGET;

  manifest.stage_status.enrichment = 'in-progress';
  manifest.updated = new Date().toISOString();
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  const indexById = new Map(programs.map((p, i) => [p.id, i]));
  const startTimes = new Map<string, string>();
  let batchSeq = manifest.batches.filter((b) => b.stage === 'enrichment').length;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const pending = programs.filter(isUnenriched);
    if (pending.length === 0) break;

    const batches: EnrichmentBatch[] = sliceByCountry(pending, batchSize).map((group) => {
      const country = group[0]!.identity.country;
      const batchId = `enrich-${country}-${String(++batchSeq).padStart(3, '0')}`;
      return {
        runId,
        batchId,
        country,
        targets: group.map((program) => ({
          program,
          officialUrl: officialUrlById.get(program.institution_id) ?? '',
        })),
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
        progressed += await applyBatch(
          outcome,
          manifest,
          programs,
          indexById,
          startTimes,
          store,
          manifestPath,
          catalogPath,
          runId,
        );
      },
    );

    if (progressed === 0) {
      logger.warn('enrichment: a pass made no progress — stopping; re-run to resume');
      break;
    }
  }

  const remaining = programs.filter(isUnenriched).length;
  const complete = remaining === 0;

  // The scholarship pass runs only once every program is enriched, so a resume
  // never re-gathers scholarships it already has.
  let scholarshipsFound = await countScholarships(store, scholarshipsPath);
  if (complete) {
    scholarshipsFound = await runScholarshipPass(
      runId,
      runDir,
      manifest,
      store,
      scholarshipWorker,
      nationality,
      concurrency,
      scholarshipsPath,
    );
  }

  const now = new Date().toISOString();
  manifest.stage_status.enrichment = complete ? 'complete' : 'in-progress';
  manifest.updated = now;
  manifest.log.push(
    `${now} enrichment ${complete ? 'complete' : 'partial'} — ` +
      `${programs.filter(isEnriched).length}/${programs.length} programs enriched, ` +
      `${scholarshipsFound} scholarship(s); ${remaining} program(s) still pending`,
  );
  await store.writeJson(manifestPath, manifest, RunManifestSchema);

  return {
    runId,
    skipped: false,
    complete,
    catalogPath,
    scholarshipsPath,
    totalPrograms: programs.length,
    enrichedPrograms: programs.filter(isEnriched).length,
    remainingPrograms: remaining,
    scholarshipsFound,
    countries: summarize(programs),
  };
}

/** Apply one settled enrichment batch to disk state. Returns programs enriched. */
async function applyBatch(
  outcome: PoolOutcome<EnrichmentBatch, EnrichmentWorkerResult>,
  manifest: RunManifest,
  programs: ProgramRecord[],
  indexById: Map<string, number>,
  startTimes: Map<string, string>,
  store: Store,
  manifestPath: string,
  catalogPath: string,
  runId: string,
): Promise<number> {
  const now = new Date().toISOString();
  const batch = outcome.item;
  const started = startTimes.get(batch.batchId) ?? now;

  if (!outcome.ok) {
    logger.warn(
      `enrichment batch ${batch.batchId} failed (${describe(outcome.error)}) — ` +
        'its programs stay unenriched and will be retried',
    );
    manifest.batches.push({
      batch_id: batch.batchId,
      stage: 'enrichment',
      country: batch.country,
      institution_ids: batch.targets.map((t) => t.program.id),
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
  const shard = await store.readJson(result.shardPath, CatalogShardSchema);
  for (const record of shard.programs) {
    const index = indexById.get(record.id);
    if (index !== undefined) programs[index] = record;
  }

  manifest.batches.push({
    batch_id: result.batchId,
    stage: 'enrichment',
    country: batch.country,
    institution_ids: result.programIds,
    status: 'complete',
    tool_calls_used: result.llmCallsUsed,
    tool_call_budget: batch.llmCallBudget,
    shard_file: join(manifest.files.catalog_shards_dir, `${result.batchId}.json`),
    started,
    finished: now,
  });
  manifest.updated = now;
  manifest.log.push(
    `${now} enrichment batch ${result.batchId} — ${result.programIds.length} program(s)`,
  );
  logger.step(
    `${result.batchId}: ${result.programIds.length} program(s) enriched` +
      (result.budgetExhausted ? ' (budget reached — remainder deferred)' : ''),
  );

  await writeCatalog(store, catalogPath, runId, programs);
  await store.writeJson(manifestPath, manifest, RunManifestSchema);
  return result.programIds.length;
}

/** Gather scholarships for every destination country (+ home-country if known). */
async function runScholarshipPass(
  runId: string,
  runDir: string,
  manifest: RunManifest,
  store: Store,
  worker: ScholarshipWorker,
  nationality: string | null,
  concurrency: number,
  scholarshipsPath: string,
): Promise<number> {
  const tasks: ScholarshipTask[] = manifest.scope.countries.map((country) => ({
    runId,
    taskId: `scholarships-${country}`,
    kind: 'destination' as const,
    country,
    nationality: null,
    shardPath: join(runDir, SCHOLARSHIP_SHARDS_DIR, `scholarships-${country}.json`),
  }));
  if (nationality) {
    tasks.push({
      runId,
      taskId: 'scholarships-home',
      kind: 'home-country',
      country: null,
      nationality,
      shardPath: join(runDir, SCHOLARSHIP_SHARDS_DIR, 'scholarships-home.json'),
    });
  } else {
    logger.info('enrichment: no nationality on the profile — skipping home-country scholarships');
  }

  const shardPaths: string[] = [];
  await runPool(
    tasks,
    concurrency,
    (task) => worker.run(task),
    (outcome) => {
      if (outcome.ok) {
        shardPaths.push(outcome.result.shardPath);
        logger.step(`${outcome.result.taskId}: ${outcome.result.scholarshipsFound} scholarship(s)`);
      } else {
        logger.warn(`scholarship task ${outcome.item.taskId} failed (${describe(outcome.error)})`);
      }
    },
  );

  const merged = new Map<string, ScholarshipRecord>();
  for (const path of shardPaths) {
    const shard = await store.readJson(path, ScholarshipShardSchema);
    for (const record of shard.scholarships) {
      if (!merged.has(record.id)) merged.set(record.id, record);
    }
  }
  const scholarships = [...merged.values()];
  await store.writeJson(
    scholarshipsPath,
    {
      schema_version: '1.0' as const,
      run_id: runId,
      generated: today(),
      scholarship_count: scholarships.length,
      scholarships,
    },
    ScholarshipFileSchema,
  );
  return scholarships.length;
}

function isEnriched(program: ProgramRecord): boolean {
  return (
    program.requirements !== null &&
    program.logistics !== null &&
    program.cost_and_funding !== null &&
    program.outcomes !== null
  );
}

function isUnenriched(program: ProgramRecord): boolean {
  return !isEnriched(program);
}

/** Group programs by country, then chunk each country's list. */
function sliceByCountry(programs: ProgramRecord[], size: number): ProgramRecord[][] {
  const byCountry = new Map<CountryCode, ProgramRecord[]>();
  for (const program of programs) {
    const list = byCountry.get(program.identity.country) ?? [];
    list.push(program);
    byCountry.set(program.identity.country, list);
  }
  const batches: ProgramRecord[][] = [];
  for (const list of byCountry.values()) {
    for (let i = 0; i < list.length; i += size) {
      batches.push(list.slice(i, i + size));
    }
  }
  return batches;
}

function summarize(programs: ProgramRecord[]): CountryEnrichmentSummary[] {
  const map = new Map<CountryCode, CountryEnrichmentSummary>();
  for (const program of programs) {
    const country = program.identity.country;
    const s = map.get(country) ?? { country, programs: 0, enriched: 0 };
    s.programs += 1;
    if (isEnriched(program)) s.enriched += 1;
    map.set(country, s);
  }
  return [...map.values()];
}

async function writeCatalog(
  store: Store,
  catalogPath: string,
  runId: string,
  programs: ProgramRecord[],
): Promise<void> {
  const file: CatalogFile = {
    schema_version: '1.0',
    run_id: runId,
    generated: today(),
    program_count: programs.length,
    programs,
  };
  await store.writeJson(catalogPath, file, CatalogFileSchema);
}

async function readNationality(store: Store, profilePath: string): Promise<string | null> {
  if (!(await store.exists(profilePath))) return null;
  try {
    const profile = await store.readJson(profilePath, StudentProfileSchema);
    return profile.identity.nationality;
  } catch {
    return null;
  }
}

async function countScholarships(store: Store, scholarshipsPath: string): Promise<number> {
  if (!(await store.exists(scholarshipsPath))) return 0;
  const file = await store.readJson(scholarshipsPath, ScholarshipFileSchema);
  return file.scholarship_count;
}

async function defaultWorkers(
  store: Store,
): Promise<{ worker: EnrichmentWorker; scholarshipWorker: ScholarshipWorker }> {
  const config = await new FileConfigStore().load();
  if (config.roles.worker.length === 0) {
    throw new ConfigError('no LLM model is configured for the "worker" role', {
      hint: 'run `finder setup` to configure a provider and model',
    });
  }
  const llm = new RoutedLlmClient(config);
  const fetcher = new HttpFetcher();
  const search = new HttpSearchClient(fetcher);
  return {
    worker: new LlmEnrichmentWorker({ llm, fetcher, search, store }),
    scholarshipWorker: new LlmScholarshipWorker({ llm, fetcher, search, store }),
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
