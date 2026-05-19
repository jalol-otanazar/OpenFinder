import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildEnrichment } from '../../src/enrichment/build-enrichment.js';
import { LlmEnrichmentWorker } from '../../src/enrichment/worker.js';
import { LlmScholarshipWorker } from '../../src/enrichment/scholarships.js';
import { buildScoring } from '../../src/scoring/build-scoring.js';
import { LlmScoringWorker } from '../../src/scoring/worker.js';
import { type CatalogFile, CatalogFileSchema, type ProgramRecord } from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { ResultsScoredFileSchema } from '../../src/core/types/scored-program.js';
import { StudentProfileSchema, emptyStudentProfile } from '../../src/core/types/student-profile.js';
import { type UniverseFile, UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';
import type { SearchResult } from '../../src/tools/search.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const INFO_PAGE = '<html><body><p>Admissions, tuition, funding and scholarship detail.</p></body></html>';
const HOMEPAGE = `<html><body><h1>Alpha University</h1>
  <a href="/admissions">Admissions</a><a href="/fees">Fees</a></body></html>`;

const ENRICH_DETAIL = {
  requirements: {
    min_gpa: { raw: '3.0', us_4_0_equivalent: 3.0 },
    required_background: 'Computer Science',
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
  outcomes: { field_ranking: null, post_study_work_rights: 'F-1 OPT', placement_info: null },
  conflict_notes: '',
};

const SCHOLARSHIPS = [
  {
    name: 'International Merit Award',
    funder: 'Alpha University',
    funder_type: 'university',
    type: 'partial',
    eligibility: { nationalities: [], countries_of_study: ['US'], degree_levels: ["Master's"], other_conditions: [] },
    value: { covers: ['tuition'], amount_note: 'USD 10,000' },
    application: { deadline: null, portal: null, linked_to_program_admission: true },
    source_url: 'https://funder.test/aid',
  },
];

const SCORING_CARD = {
  eligibility: { verdict: 'PASS', reasoning: 'Meets the GPA and English bar.', must_confirm: [] },
  admission_chance: { bucket: 'Match', reasoning: 'Profile is near the typical cohort.' },
  academic_fit: { score: 4, reasoning: 'Strong CS alignment.' },
  funding_fit: { score: 3, reasoning: 'Partial scholarship available.' },
  location_fit: { score: 4, reasoning: 'Good tech ecosystem.' },
  visa: { score: 4, reasoning: 'F-1 with STEM OPT.' },
  logistics: { score: 4, reasoning: 'Documents assemblable before the deadline.' },
  summary: 'A solid match for your goals. Plan your funding application early.',
};

const WEIGHTS = {
  funding: 40,
  location: 35,
  admission: 10,
  visa: 10,
  logistics: 5,
  academic: 0,
  rationale: 'Up-weighted location and funding per the custom note.',
};

function responder(system: string, user: string): string {
  if (system.includes('scholarship and funding schemes')) return JSON.stringify(SCHOLARSHIPS);
  if (system.includes('tune graduate-program scoring weights')) return JSON.stringify(WEIGHTS);
  if (system.includes('seven dimensions')) return JSON.stringify(SCORING_CARD);
  if (system.includes('admission, cost, funding')) return JSON.stringify(ENRICH_DETAIL);
  if (system.includes('identify which')) {
    return JSON.stringify(user.match(/https?:\/\/[^\s|]+/g) ?? []);
  }
  return '[]';
}

const HITS: SearchResult[] = [
  { title: 'Funding', url: 'https://funder.test/aid', snippet: 'Scholarships for internationals.' },
];

function manifest(runId: string): RunManifest {
  return {
    schema_version: '1.0',
    run_id: runId,
    created: '2026-05-19T00:00:00.000Z',
    updated: '2026-05-19T00:00:00.000Z',
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
      enrichment: 'pending',
      scoring: 'pending',
      reporting: 'pending',
    },
    coverage: {},
    batches: [],
    concurrency: { max_parallel_workers: 2, default_batch_size: 8 },
    log: [],
  };
}

function programStub(): ProgramRecord {
  return {
    schema_version: '1.0',
    id: 'us_alpha_university_msc_computer_science',
    institution_id: 'us_alpha_university',
    identity: {
      university: 'Alpha University',
      program: 'MSc Computer Science',
      department: 'Computer Science',
      country: 'US',
      city: 'Alphatown',
      degree_type: 'MSc',
      language: 'English',
      duration_months: 12,
    },
    requirements: null,
    logistics: null,
    cost_and_funding: null,
    outcomes: null,
    provenance: {
      source_urls: ['https://alpha.edu'],
      last_verified: '2026-05-10',
      source_confidence: 'web-verified',
      verification_notes: 'catalog stub',
    },
  };
}

function catalogFile(runId: string): CatalogFile {
  return {
    schema_version: '1.0',
    run_id: runId,
    generated: '2026-05-19',
    program_count: 1,
    programs: [programStub()],
  };
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

describe('scoring pipeline (enrichment → scoring, offline)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-scoring-pipeline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('chains enrichment and scoring to a ranked results_scored.json', async () => {
    const store = new FileStore(join(dir, 'runs'));
    const runDir = store.resolveRunDir('run-2026');
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest('run-2026'), RunManifestSchema);
    await store.writeJson(join(runDir, 'catalog.json'), catalogFile('run-2026'), CatalogFileSchema);
    await store.writeJson(join(runDir, 'universe.json'), universe('run-2026'), UniverseFileSchema);

    const profile = emptyStudentProfile('2026-05-19');
    profile.identity.nationality = 'Uzbek';
    profile.custom_notes = ['Location and funding outweigh prestige.'];
    await store.writeJson(join(runDir, 'student-profile.json'), profile, StudentProfileSchema);

    const fetcher = new StubFetcher({
      'https://alpha.edu': { body: HOMEPAGE },
      'https://alpha.edu/admissions': { body: INFO_PAGE },
      'https://alpha.edu/fees': { body: INFO_PAGE },
      'https://funder.test/aid': { body: INFO_PAGE },
    });
    const llm = new StubLlm(responder);
    const search = new StubSearch(HITS);

    const enriched = await buildEnrichment(
      'run-2026',
      {},
      {
        store,
        worker: new LlmEnrichmentWorker({ llm, fetcher, search, store }),
        scholarshipWorker: new LlmScholarshipWorker({ llm, fetcher, search, store }),
      },
    );
    expect(enriched.complete).toBe(true);

    const scored = await buildScoring(
      'run-2026',
      {},
      { store, worker: new LlmScoringWorker({ llm, store }), llm },
    );

    expect(scored.complete).toBe(true);
    expect(scored.scoredPrograms).toBe(1);

    const results = await store.readJson(join(runDir, 'results_scored.json'), ResultsScoredFileSchema);
    expect(results.scored_count).toBe(1);
    expect(results.profile_hash.length).toBeGreaterThan(0);
    expect(results.weighting.rationale).toContain('Up-weighted');
    const card = results.programs[0]!;
    expect(card.eligibility.verdict).toBe('PASS');
    expect(card.recommendation_tier).not.toBe('Do Not Apply');
    expect(card.weighted_total).toBeGreaterThan(0);
    expect(card.summary.length).toBeGreaterThan(0);

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.scoring).toBe('complete');

    // Re-running scoring is idempotent.
    const again = await buildScoring(
      'run-2026',
      {},
      { store, worker: new LlmScoringWorker({ llm, store }), llm },
    );
    expect(again.skipped).toBe(true);
  });
});
