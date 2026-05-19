import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildScoring } from '../../src/scoring/build-scoring.js';
import type {
  ScoringBatch,
  ScoringWorker,
  ScoringWorkerResult,
} from '../../src/scoring/worker.js';
import { BlockingError } from '../../src/core/errors.js';
import { CatalogFileSchema, type ProgramRecord } from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema, type StageStatus } from '../../src/core/types/run-manifest.js';
import { ResultsScoredFileSchema, ScoringShardSchema, type ScoredProgram } from '../../src/core/types/scored-program.js';
import { StudentProfileSchema, emptyStudentProfile, type StudentProfile } from '../../src/core/types/student-profile.js';
import { FileStore, type Store } from '../../src/storage/store.js';
import { StubLlm } from '../helpers/catalog-stubs.js';

const NOW = '2026-05-19T00:00:00.000Z';

function manifest(runId: string, enrichment: StageStatus = 'complete'): RunManifest {
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
      universe: 'complete',
      catalog: 'complete',
      enrichment,
      scoring: 'pending',
      reporting: 'pending',
    },
    coverage: {},
    batches: [],
    concurrency: { max_parallel_workers: 2, default_batch_size: 10 },
    log: [],
  };
}

function program(n: number): ProgramRecord {
  return {
    schema_version: '1.0',
    id: `us_inst_${n}_program`,
    institution_id: `us_inst_${n}`,
    identity: {
      university: `Institution ${n}`,
      program: `Program ${n}`,
      department: null,
      country: 'US',
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
      source_urls: [],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: '',
    },
  };
}

function scoredOf(p: ProgramRecord): ScoredProgram {
  const total = Math.min(100, (Number(p.id.split('_')[2]) || 1) * 10);
  return {
    program_id: p.id,
    institution_id: p.institution_id,
    identity: {
      university: p.identity.university,
      program: p.identity.program,
      country: p.identity.country,
      degree_type: p.identity.degree_type,
    },
    eligibility: { verdict: 'PASS', reasoning: 'ok', must_confirm: [] },
    admission_chance: { bucket: 'Match', reasoning: 'ok' },
    academic_fit: { score: 3, reasoning: 'ok' },
    funding_fit: { score: 3, reasoning: 'ok' },
    location_fit: { score: 3, reasoning: 'ok' },
    visa: { score: 3, reasoning: 'ok' },
    logistics: { score: 3, reasoning: 'ok' },
    weighted_total: total,
    recommendation_tier:
      total >= 70 ? 'Priority' : total >= 50 ? 'Apply' : total >= 30 ? 'Backup' : 'Do Not Apply',
    summary: 'ok',
  };
}

class SpyScoringWorker implements ScoringWorker {
  public seenIds: string[] = [];

  constructor(
    private readonly store: Store,
    private readonly shouldScore: (p: ProgramRecord) => boolean = () => true,
  ) {}

  async run(batch: ScoringBatch): Promise<ScoringWorkerResult> {
    for (const p of batch.programs) this.seenIds.push(p.id);
    const done = batch.programs.filter((p) => this.shouldScore(p));
    await this.store.writeJson(
      batch.shardPath,
      {
        schema_version: '1.0' as const,
        run_id: batch.runId,
        batch_id: batch.batchId,
        generated: '2026-05-19',
        programs: done.map(scoredOf),
      },
      ScoringShardSchema,
    );
    return {
      batchId: batch.batchId,
      shardPath: batch.shardPath,
      programIds: done.map((p) => p.id),
      llmCallsUsed: done.length,
      budgetExhausted: done.length < batch.programs.length,
    };
  }
}

describe('buildScoring', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-scoring-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(
    runId: string,
    programs: ProgramRecord[],
    opts: { enrichment?: StageStatus; profile?: StudentProfile } = {},
  ): Promise<void> {
    const runDir = store.resolveRunDir(runId);
    await store.writeJson(
      join(runDir, 'run-manifest.json'),
      manifest(runId, opts.enrichment ?? 'complete'),
      RunManifestSchema,
    );
    await store.writeJson(
      join(runDir, 'catalog.json'),
      {
        schema_version: '1.0' as const,
        run_id: runId,
        generated: '2026-05-19',
        program_count: programs.length,
        programs,
      },
      CatalogFileSchema,
    );
    await store.writeJson(
      join(runDir, 'student-profile.json'),
      opts.profile ?? emptyStudentProfile('2026-05-19'),
      StudentProfileSchema,
    );
  }

  it('scores every program and writes a ranked results_scored.json', async () => {
    await seed('r1', [program(1), program(2), program(3)]);
    const result = await buildScoring('r1', {}, { store, worker: new SpyScoringWorker(store) });

    expect(result.complete).toBe(true);
    expect(result.scoredPrograms).toBe(3);
    expect(result.weightingProfile).toBe('balanced-default');

    const runDir = store.resolveRunDir('r1');
    const results = await store.readJson(join(runDir, 'results_scored.json'), ResultsScoredFileSchema);
    expect(results.scored_count).toBe(3);
    // Sorted by weighted_total descending.
    expect(results.programs.map((p) => p.program_id)).toEqual([
      'us_inst_3_program',
      'us_inst_2_program',
      'us_inst_1_program',
    ]);
    expect(results.profile_hash.length).toBeGreaterThan(0);

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.scoring).toBe('complete');
    expect(updated.batches.filter((b) => b.stage === 'scoring')).toHaveLength(1);
  });

  it('is idempotent — a second run is skipped unless the profile changed', async () => {
    await seed('r2', [program(1), program(2)]);
    await buildScoring('r2', {}, { store, worker: new SpyScoringWorker(store) });

    const second = await buildScoring('r2', {}, { store, worker: new SpyScoringWorker(store) });
    expect(second.skipped).toBe(true);
  });

  it('re-scores everything when the profile changed', async () => {
    await seed('r3', [program(1), program(2)]);
    await buildScoring('r3', {}, { store, worker: new SpyScoringWorker(store) });

    // Mutate the profile — its hash now differs.
    const runDir = store.resolveRunDir('r3');
    const changed = emptyStudentProfile('2026-05-19');
    changed.identity.nationality = 'Uzbek';
    await store.writeJson(join(runDir, 'student-profile.json'), changed, StudentProfileSchema);

    const worker = new SpyScoringWorker(store);
    const result = await buildScoring('r3', {}, { store, worker });
    expect(result.skipped).toBe(false);
    expect(worker.seenIds.sort()).toEqual(['us_inst_1_program', 'us_inst_2_program']);
  });

  it('resumes a budget-exhausted run', async () => {
    await seed('r4', [program(1), program(2), program(3), program(4)]);
    const isEven = (p: ProgramRecord): boolean => Number(p.id.split('_')[2]) % 2 === 0;

    const partial = await buildScoring('r4', {}, { store, worker: new SpyScoringWorker(store, isEven) });
    expect(partial.complete).toBe(false);
    expect(partial.remainingPrograms).toBe(2);

    const resumed = await buildScoring('r4', {}, { store, worker: new SpyScoringWorker(store) });
    expect(resumed.complete).toBe(true);
    expect(resumed.scoredPrograms).toBe(4);
  });

  it('derives adjusted weights from custom_notes via one LLM call', async () => {
    const profile = emptyStudentProfile('2026-05-19');
    profile.custom_notes = ['Location and funding outweigh prestige.'];
    await seed('r5', [program(1)], { profile });

    const llm = new StubLlm(() =>
      JSON.stringify({
        funding: 45,
        location: 35,
        admission: 10,
        visa: 5,
        logistics: 5,
        academic: 0,
        rationale: 'Up-weighted location and funding per the student note.',
      }),
    );
    await buildScoring('r5', {}, { store, worker: new SpyScoringWorker(store), llm });

    const runDir = store.resolveRunDir('r5');
    const results = await store.readJson(join(runDir, 'results_scored.json'), ResultsScoredFileSchema);
    expect(results.weighting.rationale).toContain('Up-weighted');
    expect(results.weighting.weights.funding).toBeGreaterThan(results.weighting.weights.academic);
  });

  it('refuses to run before enrichment is complete', async () => {
    await seed('r6', [program(1)], { enrichment: 'in-progress' });
    await expect(
      buildScoring('r6', {}, { store, worker: new SpyScoringWorker(store) }),
    ).rejects.toThrow(BlockingError);
  });
});
