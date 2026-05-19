import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEnrichment } from '../../src/enrichment/build-enrichment.js';
import type {
  EnrichmentBatch,
  EnrichmentWorker,
  EnrichmentWorkerResult,
} from '../../src/enrichment/worker.js';
import type {
  ScholarshipTask,
  ScholarshipWorker,
  ScholarshipWorkerResult,
} from '../../src/enrichment/scholarships.js';
import { BlockingError } from '../../src/core/errors.js';
import {
  CatalogFileSchema,
  CatalogShardSchema,
  type ProgramRecord,
} from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema, type StageStatus } from '../../src/core/types/run-manifest.js';
import {
  ScholarshipFileSchema,
  ScholarshipShardSchema,
  type ScholarshipRecord,
} from '../../src/core/types/scholarship-record.js';
import { StudentProfileSchema, emptyStudentProfile } from '../../src/core/types/student-profile.js';
import { FileStore, type Store } from '../../src/storage/store.js';

const NOW = '2026-05-19T00:00:00.000Z';

function manifest(runId: string, catalog: StageStatus = 'complete'): RunManifest {
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
      catalog,
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

function stub(n: number): ProgramRecord {
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
      source_urls: [`https://inst${n}.edu/program`],
      last_verified: '2026-05-01',
      source_confidence: 'web-verified',
      verification_notes: 'catalog stub',
    },
  };
}

function enrich(program: ProgramRecord): ProgramRecord {
  return {
    ...program,
    requirements: {
      min_gpa: null,
      required_background: null,
      prerequisites: [],
      gre: null,
      english_tests: null,
      english_waiver: null,
      reference_letters: null,
      other_documents: [],
    },
    logistics: {
      application_deadlines: [],
      intake_terms: [],
      application_fee: null,
      application_portal: null,
      decision_timeline: null,
    },
    cost_and_funding: {
      tuition_international: null,
      living_cost_estimate: null,
      scholarships_for_internationals: [],
      funding_likelihood: 'unknown',
      fully_funded: false,
    },
    outcomes: { field_ranking: null, post_study_work_rights: null, placement_info: null },
  };
}

class SpyEnrichmentWorker implements EnrichmentWorker {
  public seenIds: string[] = [];

  constructor(
    private readonly store: Store,
    private readonly shouldProcess: (program: ProgramRecord) => boolean = () => true,
  ) {}

  async run(batch: EnrichmentBatch): Promise<EnrichmentWorkerResult> {
    for (const t of batch.targets) this.seenIds.push(t.program.id);
    const done = batch.targets.filter((t) => this.shouldProcess(t.program));
    await this.store.writeJson(
      batch.shardPath,
      {
        schema_version: '1.0' as const,
        run_id: batch.runId,
        batch_id: batch.batchId,
        generated: '2026-05-19',
        programs: done.map((t) => enrich(t.program)),
      },
      CatalogShardSchema,
    );
    return {
      batchId: batch.batchId,
      shardPath: batch.shardPath,
      programIds: done.map((t) => t.program.id),
      llmCallsUsed: done.length * 2,
      budgetExhausted: done.length < batch.targets.length,
    };
  }
}

function oneScholarship(taskId: string): ScholarshipRecord {
  return {
    schema_version: '1.0',
    id: `sch_${taskId}`,
    name: `Scholarship for ${taskId}`,
    funder: 'Test Funder',
    funder_type: 'university',
    type: 'partial',
    eligibility: { nationalities: [], countries_of_study: [], degree_levels: [], other_conditions: [] },
    value: { covers: [], amount_note: null },
    application: { deadline: null, portal: null, linked_to_program_admission: null },
    provenance: {
      source_urls: [],
      last_verified: '2026-05-19',
      source_confidence: 'web-verified',
      verification_notes: '',
    },
  };
}

class SpyScholarshipWorker implements ScholarshipWorker {
  public seenKinds: string[] = [];

  constructor(private readonly store: Store) {}

  async run(task: ScholarshipTask): Promise<ScholarshipWorkerResult> {
    this.seenKinds.push(task.kind);
    await this.store.writeJson(
      task.shardPath,
      {
        schema_version: '1.0' as const,
        run_id: task.runId,
        task_id: task.taskId,
        generated: '2026-05-19',
        scholarships: [oneScholarship(task.taskId)],
      },
      ScholarshipShardSchema,
    );
    return { taskId: task.taskId, shardPath: task.shardPath, scholarshipsFound: 1, llmCallsUsed: 1 };
  }
}

describe('buildEnrichment', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-enrichment-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(
    runId: string,
    programs: ProgramRecord[],
    opts: { catalog?: StageStatus; nationality?: string } = {},
  ): Promise<void> {
    const runDir = store.resolveRunDir(runId);
    await store.writeJson(
      join(runDir, 'run-manifest.json'),
      manifest(runId, opts.catalog ?? 'complete'),
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
    if (opts.nationality !== undefined) {
      const profile = emptyStudentProfile('2026-05-19');
      profile.identity.nationality = opts.nationality;
      await store.writeJson(join(runDir, 'student-profile.json'), profile, StudentProfileSchema);
    }
  }

  it('enriches every program, rewrites catalog.json, and gathers scholarships', async () => {
    await seed('r1', [stub(1), stub(2), stub(3)]);
    const result = await buildEnrichment(
      'r1',
      {},
      { store, worker: new SpyEnrichmentWorker(store), scholarshipWorker: new SpyScholarshipWorker(store) },
    );

    expect(result.complete).toBe(true);
    expect(result.enrichedPrograms).toBe(3);
    expect(result.scholarshipsFound).toBe(1); // one destination task (US)

    const runDir = store.resolveRunDir('r1');
    const catalog = await store.readJson(join(runDir, 'catalog.json'), CatalogFileSchema);
    expect(catalog.programs.every((p) => p.requirements !== null && p.outcomes !== null)).toBe(true);

    const scholarships = await store.readJson(join(runDir, 'scholarships.json'), ScholarshipFileSchema);
    expect(scholarships.scholarship_count).toBe(1);

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.enrichment).toBe('complete');
    expect(updated.batches.filter((b) => b.stage === 'enrichment')).toHaveLength(1);
  });

  it('adds a home-country scholarship task when the profile has a nationality', async () => {
    await seed('r2', [stub(1)], { nationality: 'Uzbek' });
    const scholarshipWorker = new SpyScholarshipWorker(store);
    const result = await buildEnrichment(
      'r2',
      {},
      { store, worker: new SpyEnrichmentWorker(store), scholarshipWorker },
    );

    expect(scholarshipWorker.seenKinds.sort()).toEqual(['destination', 'home-country']);
    expect(result.scholarshipsFound).toBe(2);
  });

  it('is idempotent — a second run is skipped unless forced', async () => {
    await seed('r3', [stub(1), stub(2)]);
    const deps = { store, worker: new SpyEnrichmentWorker(store), scholarshipWorker: new SpyScholarshipWorker(store) };
    await buildEnrichment('r3', {}, deps);

    const second = await buildEnrichment('r3', {}, deps);
    expect(second.skipped).toBe(true);

    const forced = await buildEnrichment('r3', { force: true }, deps);
    expect(forced.skipped).toBe(false);
    expect(forced.complete).toBe(true);
  });

  it('resumes — only programs with a null section are dispatched', async () => {
    await seed('r4', [enrich(stub(1)), stub(2), enrich(stub(3)), stub(4)]);
    const worker = new SpyEnrichmentWorker(store);
    await buildEnrichment('r4', {}, { store, worker, scholarshipWorker: new SpyScholarshipWorker(store) });

    expect(worker.seenIds.sort()).toEqual(['us_inst_2_program', 'us_inst_4_program']);
  });

  it('leaves a budget-exhausted run resumable and defers the scholarship pass', async () => {
    await seed('r5', [stub(1), stub(2), stub(3), stub(4)]);
    const isEven = (p: ProgramRecord): boolean => Number(p.id.split('_')[2]) % 2 === 0;

    const partial = await buildEnrichment(
      'r5',
      {},
      { store, worker: new SpyEnrichmentWorker(store, isEven), scholarshipWorker: new SpyScholarshipWorker(store) },
    );
    expect(partial.complete).toBe(false);
    expect(partial.remainingPrograms).toBe(2);
    expect(partial.scholarshipsFound).toBe(0); // scholarship pass deferred

    const resumed = await buildEnrichment(
      'r5',
      {},
      { store, worker: new SpyEnrichmentWorker(store), scholarshipWorker: new SpyScholarshipWorker(store) },
    );
    expect(resumed.complete).toBe(true);
    expect(resumed.scholarshipsFound).toBe(1);
  });

  it('refuses to run before the catalog stage is complete', async () => {
    await seed('r6', [stub(1)], { catalog: 'pending' });
    await expect(
      buildEnrichment(
        'r6',
        {},
        { store, worker: new SpyEnrichmentWorker(store), scholarshipWorker: new SpyScholarshipWorker(store) },
      ),
    ).rejects.toThrow(BlockingError);
  });
});
