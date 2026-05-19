import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/catalog/build-catalog.js';
import type {
  CatalogBatch,
  CatalogWorker,
  CatalogWorkerResult,
} from '../../src/catalog/worker.js';
import { BlockingError } from '../../src/core/errors.js';
import {
  CatalogFileSchema,
  CatalogShardSchema,
  type ProgramRecord,
} from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema, type StageStatus } from '../../src/core/types/run-manifest.js';
import {
  type InstitutionStatus,
  type UniverseEntry,
  type UniverseFile,
  UniverseFileSchema,
} from '../../src/core/types/universe.js';
import { FileStore, type Store } from '../../src/storage/store.js';

const NOW = '2026-05-19T00:00:00.000Z';

function manifest(runId: string, status: { universe?: StageStatus; catalog?: StageStatus } = {}): RunManifest {
  return {
    schema_version: '1.0',
    run_id: runId,
    created: NOW,
    updated: NOW,
    scope: {
      fields: ['Computer Science'],
      countries: ['US'],
      intake: 'Fall 2027',
      profile_ref: 'student-profile.json',
    },
    files: {
      universe: 'universe.json',
      catalog_shards_dir: 'catalog/',
      catalog_merged: 'catalog.json',
      scholarships: 'scholarships.json',
      results_scored: 'results_scored.json',
    },
    stage_status: {
      intake: 'pending',
      universe: status.universe ?? 'complete',
      catalog: status.catalog ?? 'pending',
      enrichment: 'pending',
      scoring: 'pending',
      reporting: 'pending',
    },
    coverage: {},
    batches: [],
    concurrency: { max_parallel_workers: 2, default_batch_size: 10 },
    log: [],
  };
}

function inst(n: number, status: InstitutionStatus = 'unchecked'): UniverseEntry {
  return {
    id: `us_inst_${n}`,
    name: `Institution ${n}`,
    country: 'US',
    region: 'CA',
    registry_source: 'NCES IPEDS',
    official_url: `https://inst${n}.edu`,
    status,
    programs_found: status === 'unchecked' ? null : 0,
    last_checked: null,
    checked_by_batch: null,
    notes: '',
  };
}

function stubProgram(entry: UniverseEntry): ProgramRecord {
  return {
    schema_version: '1.0',
    id: `${entry.id}_program`,
    institution_id: entry.id,
    identity: {
      university: entry.name,
      program: `${entry.name} MSc`,
      department: null,
      country: entry.country,
      city: null,
      degree_type: 'MSc',
      language: null,
      duration_months: null,
    },
    requirements: null,
    logistics: null,
    cost_and_funding: null,
    outcomes: null,
    provenance: {
      source_urls: [entry.official_url],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: '',
    },
  };
}

/** Deterministic worker — writes a real shard, processes per a predicate. */
class SpyWorker implements CatalogWorker {
  public runs = 0;
  public seenIds: string[] = [];

  constructor(
    private readonly store: Store,
    private readonly shouldProcess: (entry: UniverseEntry) => boolean = () => true,
  ) {}

  async run(batch: CatalogBatch): Promise<CatalogWorkerResult> {
    this.runs += 1;
    for (const entry of batch.institutions) this.seenIds.push(entry.id);
    const done = batch.institutions.filter((e) => this.shouldProcess(e));
    const programs = done.map(stubProgram);
    await this.store.writeJson(
      batch.shardPath,
      {
        schema_version: '1.0' as const,
        run_id: batch.runId,
        batch_id: batch.batchId,
        generated: '2026-05-19',
        programs,
      },
      CatalogShardSchema,
    );
    return {
      batchId: batch.batchId,
      shardPath: batch.shardPath,
      outcomes: done.map((e) => ({ id: e.id, status: 'checked' as const, programsFound: 1 })),
      llmCallsUsed: done.length * 2,
      budgetExhausted: done.length < batch.institutions.length,
    };
  }
}

const isEven = (entry: UniverseEntry): boolean =>
  Number(entry.id.split('_').pop()) % 2 === 0;

describe('buildCatalog', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-catalog-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(runId: string, entries: UniverseEntry[], status?: { catalog?: StageStatus }): Promise<void> {
    const runDir = store.resolveRunDir(runId);
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest(runId, status), RunManifestSchema);
    const universe: UniverseFile = {
      schema_version: '1.0',
      run_id: runId,
      generated: '2026-05-19',
      registry_sources: { US: 'NCES IPEDS' },
      institutions: entries,
    };
    await store.writeJson(join(runDir, 'universe.json'), universe, UniverseFileSchema);
  }

  it('checks every institution, flips universe statuses, and merges catalog.json', async () => {
    await seed('r1', [inst(1), inst(2), inst(3), inst(4), inst(5), inst(6)]);
    const worker = new SpyWorker(store);

    const result = await buildCatalog('r1', {}, { store, worker });

    expect(result.complete).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.totalPrograms).toBe(6);
    expect(result.remainingUnchecked).toBe(0);
    expect(worker.runs).toBe(1); // batch size 10 → one batch of 6

    const runDir = store.resolveRunDir('r1');
    const universe = await store.readJson(join(runDir, 'universe.json'), UniverseFileSchema);
    expect(universe.institutions.every((e) => e.status === 'checked')).toBe(true);
    expect(universe.institutions.every((e) => e.programs_found === 1)).toBe(true);
    expect(universe.institutions.every((e) => e.checked_by_batch !== null)).toBe(true);

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.catalog).toBe('complete');
    expect(updated.coverage['US']).toEqual({ total: 6, checked: 6, ratio: 1 });
    expect(updated.batches.filter((b) => b.stage === 'catalog')).toHaveLength(1);

    const catalog = await store.readJson(join(runDir, 'catalog.json'), CatalogFileSchema);
    expect(catalog.program_count).toBe(6);
  });

  it('is idempotent — a second build is skipped unless forced', async () => {
    await seed('r2', [inst(1), inst(2)]);
    await buildCatalog('r2', {}, { store, worker: new SpyWorker(store) });

    const second = await buildCatalog('r2', {}, { store, worker: new SpyWorker(store) });
    expect(second.skipped).toBe(true);

    const forced = await buildCatalog('r2', { force: true }, { store, worker: new SpyWorker(store) });
    expect(forced.skipped).toBe(false);
    expect(forced.complete).toBe(true);
  });

  it('resumes — only `unchecked` institutions are dispatched', async () => {
    await seed('r3', [inst(1, 'checked'), inst(2, 'no-programs'), inst(3), inst(4)]);
    const worker = new SpyWorker(store);

    const result = await buildCatalog('r3', {}, { store, worker });

    expect(worker.seenIds.sort()).toEqual(['us_inst_3', 'us_inst_4']);
    expect(result.complete).toBe(true);
  });

  it('leaves a budget-exhausted run resumable, then finishes it on re-run', async () => {
    await seed('r4', [inst(1), inst(2), inst(3), inst(4), inst(5), inst(6)]);

    const partial = await buildCatalog('r4', {}, { store, worker: new SpyWorker(store, isEven) });
    expect(partial.complete).toBe(false);
    expect(partial.remainingUnchecked).toBe(3);
    expect(partial.totalPrograms).toBe(3);

    const runDir = store.resolveRunDir('r4');
    const midManifest = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(midManifest.stage_status.catalog).toBe('in-progress');

    const resumed = await buildCatalog('r4', {}, { store, worker: new SpyWorker(store) });
    expect(resumed.complete).toBe(true);
    expect(resumed.totalPrograms).toBe(6);
    expect(resumed.skipped).toBe(false);
  });

  it('refuses to run before the universe stage is complete', async () => {
    await seed('r5', [inst(1)], undefined);
    const runDir = store.resolveRunDir('r5');
    await store.writeJson(
      join(runDir, 'run-manifest.json'),
      manifest('r5', { universe: 'pending' }),
      RunManifestSchema,
    );
    await expect(buildCatalog('r5', {}, { store, worker: new SpyWorker(store) })).rejects.toThrow(
      BlockingError,
    );
  });

  it('throws a blocking error when the run manifest is missing', async () => {
    await expect(buildCatalog('nope', {}, { store, worker: new SpyWorker(store) })).rejects.toThrow(
      BlockingError,
    );
  });
});
