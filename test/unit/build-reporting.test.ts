import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReporting } from '../../src/reporting/build-reporting.js';
import { BlockingError } from '../../src/core/errors.js';
import { CatalogFileSchema, type ProgramRecord } from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema, type StageStatus } from '../../src/core/types/run-manifest.js';
import { ResultsScoredFileSchema, type ScoredProgram } from '../../src/core/types/scored-program.js';
import { StudentProfileSchema, emptyStudentProfile } from '../../src/core/types/student-profile.js';
import { UniverseFileSchema, type UniverseEntry } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const NOW = '2026-05-19T00:00:00.000Z';

function manifest(runId: string, scoring: StageStatus = 'complete'): RunManifest {
  return {
    schema_version: '1.0',
    run_id: runId,
    created: NOW,
    updated: NOW,
    scope: { fields: ['Computer Science'], countries: ['US'], intake: 'Fall 2027', profile_ref: 'student-profile.json' },
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
      enrichment: 'complete',
      scoring,
      reporting: 'pending',
    },
    coverage: {},
    batches: [],
    concurrency: { max_parallel_workers: 2, default_batch_size: 8 },
    log: [],
  };
}

function scored(id: string): ScoredProgram {
  return {
    program_id: id,
    institution_id: 'us_alpha',
    identity: { university: 'Alpha University', program: `Program ${id}`, country: 'US', degree_type: 'MSc' },
    eligibility: { verdict: 'PASS', reasoning: 'ok', must_confirm: [] },
    admission_chance: { bucket: 'Match', reasoning: 'ok' },
    academic_fit: { score: 4, reasoning: 'ok' },
    funding_fit: { score: 3, reasoning: 'ok' },
    location_fit: { score: 3, reasoning: 'ok' },
    visa: { score: 4, reasoning: 'F-1 with STEM OPT.' },
    logistics: { score: 4, reasoning: 'ok' },
    weighted_total: 64,
    recommendation_tier: 'Apply',
    summary: 'A solid match for your goals.',
  };
}

function catalogProgram(id: string): ProgramRecord {
  return {
    schema_version: '1.0',
    id,
    institution_id: 'us_alpha',
    identity: {
      university: 'Alpha University',
      program: `Program ${id}`,
      department: null,
      country: 'US',
      city: null,
      degree_type: 'MSc',
      language: null,
      duration_months: null,
    },
    requirements: null,
    logistics: {
      application_deadlines: ['2027-01-15'],
      intake_terms: [],
      application_fee: null,
      application_portal: null,
      decision_timeline: null,
    },
    cost_and_funding: null,
    outcomes: null,
    provenance: { source_urls: [], last_verified: '2026-05-19', source_confidence: 'web-verified', verification_notes: '' },
  };
}

function institution(id: string): UniverseEntry {
  return {
    id,
    name: `Institution ${id}`,
    country: 'US',
    region: 'CA',
    registry_source: 'NCES IPEDS',
    official_url: `https://${id}.edu`,
    status: 'checked',
    programs_found: 1,
    last_checked: '2026-05-19',
    checked_by_batch: 'catalog-US-001',
    notes: '',
  };
}

describe('buildReporting', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-reporting-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seed(runId: string, scoring: StageStatus = 'complete'): Promise<void> {
    const runDir = store.resolveRunDir(runId);
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest(runId, scoring), RunManifestSchema);
    await store.writeJson(
      join(runDir, 'results_scored.json'),
      {
        schema_version: '1.0' as const,
        run_id: runId,
        generated: '2026-05-19',
        profile_hash: 'abc123',
        weighting: {
          profile: 'balanced-default',
          weights: { funding: 20, location: 20, admission: 20, visa: 15, logistics: 15, academic: 10 },
          rationale: 'preset',
        },
        scored_count: 1,
        programs: [scored('us_alpha_p1')],
      },
      ResultsScoredFileSchema,
    );
    await store.writeJson(
      join(runDir, 'catalog.json'),
      { schema_version: '1.0' as const, run_id: runId, generated: '2026-05-19', program_count: 1, programs: [catalogProgram('us_alpha_p1')] },
      CatalogFileSchema,
    );
    await store.writeJson(
      join(runDir, 'universe.json'),
      {
        schema_version: '1.0' as const,
        run_id: runId,
        generated: '2026-05-19',
        registry_sources: { US: 'NCES IPEDS' },
        institutions: [institution('us_alpha'), institution('us_beta')],
      },
      UniverseFileSchema,
    );
    await store.writeJson(
      join(runDir, 'student-profile.json'),
      emptyStudentProfile('2026-05-19'),
      StudentProfileSchema,
    );
  }

  function deps() {
    return {
      store,
      llm: new StubLlm(() => 'A generated narrative section.'),
      fetcher: new StubFetcher({}),
      search: new StubSearch([]),
    };
  }

  it('writes the spreadsheet and report.md and completes the pipeline', async () => {
    await seed('r1');
    const result = await buildReporting('r1', {}, deps());

    expect(result.skipped).toBe(false);
    expect(result.programCount).toBe(1);
    expect(result.coverageComplete).toBe(true);

    const runDir = store.resolveRunDir('r1');
    const csv = await readFile(join(runDir, 'report', 'spreadsheet.csv'), 'utf-8');
    expect(csv.split('\n')[0]).toContain('Program,University');

    const report = await readFile(join(runDir, 'report', 'report.md'), 'utf-8');
    expect(report).toContain('# FInder report — r1');
    expect(report).toContain('## Ranked shortlist');
    expect(report).toContain('## Per-country briefs');
    expect(report).toContain('## Personal gap report');
    expect(report).toContain('## Deadline calendar');
    expect(report).toContain('## Coverage report');

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.reporting).toBe('complete');
  });

  it('is idempotent — a second run is skipped unless forced', async () => {
    await seed('r2');
    await buildReporting('r2', {}, deps());

    const second = await buildReporting('r2', {}, deps());
    expect(second.skipped).toBe(true);

    const forced = await buildReporting('r2', { force: true }, deps());
    expect(forced.skipped).toBe(false);
  });

  it('refuses to run before scoring is complete', async () => {
    await seed('r3', 'in-progress');
    await expect(buildReporting('r3', {}, deps())).rejects.toThrow(BlockingError);
  });
});
