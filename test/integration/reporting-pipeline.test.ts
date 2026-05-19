import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildScoring } from '../../src/scoring/build-scoring.js';
import { LlmScoringWorker } from '../../src/scoring/worker.js';
import { buildReporting } from '../../src/reporting/build-reporting.js';
import { type CatalogFile, CatalogFileSchema, type ProgramRecord } from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { StudentProfileSchema, emptyStudentProfile } from '../../src/core/types/student-profile.js';
import { type UniverseFile, UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const SCORING_CARD = {
  eligibility: { verdict: 'PASS', reasoning: 'Meets the bar.', must_confirm: [] },
  admission_chance: { bucket: 'Match', reasoning: 'Near cohort.' },
  academic_fit: { score: 4, reasoning: 'Strong.' },
  funding_fit: { score: 3, reasoning: 'Partial.' },
  location_fit: { score: 4, reasoning: 'Good ecosystem.' },
  visa: { score: 4, reasoning: 'F-1 with STEM OPT.' },
  logistics: { score: 4, reasoning: 'Doable before the deadline.' },
  summary: 'A solid match for your goals. Apply early for funding.',
};

/** Routes the scoring call to a JSON card and reporting narratives to Markdown. */
function responder(system: string): string {
  if (system.includes('seven dimensions')) return JSON.stringify(SCORING_CARD);
  return 'A generated narrative section with detail.';
}

function manifest(runId: string): RunManifest {
  return {
    schema_version: '1.0',
    run_id: runId,
    created: '2026-05-19T00:00:00.000Z',
    updated: '2026-05-19T00:00:00.000Z',
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
      scoring: 'pending',
      reporting: 'pending',
    },
    coverage: {},
    batches: [],
    concurrency: { max_parallel_workers: 2, default_batch_size: 8 },
    log: [],
  };
}

function enrichedProgram(): ProgramRecord {
  return {
    schema_version: '1.0',
    id: 'us_alpha_university_msc_cs',
    institution_id: 'us_alpha_university',
    identity: {
      university: 'Alpha University',
      program: 'MSc Computer Science',
      department: 'CS',
      country: 'US',
      city: 'Alphatown',
      degree_type: 'MSc',
      language: 'English',
      duration_months: 12,
    },
    requirements: {
      min_gpa: { raw: '3.0', us_4_0_equivalent: 3.0 },
      required_background: 'CS',
      prerequisites: [],
      gre: 'optional',
      english_tests: { ielts: '6.5', toefl: null, duolingo: null, pte: null },
      english_waiver: null,
      reference_letters: 2,
      other_documents: [],
    },
    logistics: {
      application_deadlines: ['2027-01-15'],
      intake_terms: ['Fall'],
      application_fee: 'USD 75',
      application_portal: null,
      decision_timeline: null,
    },
    cost_and_funding: {
      tuition_international: { amount: 40000, currency: 'USD', period: 'year' },
      living_cost_estimate: null,
      scholarships_for_internationals: [],
      funding_likelihood: 'partial',
      fully_funded: false,
    },
    outcomes: { field_ranking: 'Top 30 US', post_study_work_rights: 'F-1 OPT', placement_info: null },
    provenance: { source_urls: ['https://alpha.edu'], last_verified: '2026-05-19', source_confidence: 'web-verified', verification_notes: '' },
  };
}

function catalogFile(runId: string): CatalogFile {
  return { schema_version: '1.0', run_id: runId, generated: '2026-05-19', program_count: 1, programs: [enrichedProgram()] };
}

function universe(runId: string): UniverseFile {
  return {
    schema_version: '1.0',
    run_id: runId,
    generated: '2026-05-19',
    registry_sources: { US: 'NCES IPEDS' },
    institutions: [
      {
        id: 'us_alpha_university',
        name: 'Alpha University',
        country: 'US',
        region: 'MA',
        registry_source: 'NCES IPEDS',
        official_url: 'https://alpha.edu',
        status: 'checked',
        programs_found: 1,
        last_checked: '2026-05-19',
        checked_by_batch: 'catalog-US-001',
        notes: '',
      },
    ],
  };
}

describe('reporting pipeline (scoring → reporting, offline)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-reporting-pipeline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('chains scoring and reporting to the final deliverables', async () => {
    const store = new FileStore(join(dir, 'runs'));
    const runDir = store.resolveRunDir('run-2026');
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest('run-2026'), RunManifestSchema);
    await store.writeJson(join(runDir, 'catalog.json'), catalogFile('run-2026'), CatalogFileSchema);
    await store.writeJson(join(runDir, 'universe.json'), universe('run-2026'), UniverseFileSchema);
    await store.writeJson(
      join(runDir, 'student-profile.json'),
      emptyStudentProfile('2026-05-19'),
      StudentProfileSchema,
    );

    const llm = new StubLlm(responder);

    const scored = await buildScoring('run-2026', {}, { store, worker: new LlmScoringWorker({ llm, store }) });
    expect(scored.complete).toBe(true);

    const reported = await buildReporting(
      'run-2026',
      {},
      { store, llm, fetcher: new StubFetcher({}), search: new StubSearch([]) },
    );

    expect(reported.skipped).toBe(false);
    expect(reported.programCount).toBe(1);
    expect(reported.coverageComplete).toBe(true);

    const report = await readFile(join(runDir, 'report', 'report.md'), 'utf-8');
    expect(report).toContain('# FInder report — run-2026');
    expect(report).toContain('## Ranked shortlist');
    expect(report).toContain('## Per-country briefs');
    expect(report).toContain('## Personal gap report');
    expect(report).toContain('## Deadline calendar');
    expect(report).toContain('## Coverage report');

    const csv = await readFile(join(runDir, 'report', 'spreadsheet.csv'), 'utf-8');
    expect(csv).toContain('MSc Computer Science');

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.reporting).toBe('complete');
  });
});
