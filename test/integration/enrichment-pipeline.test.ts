import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/catalog/build-catalog.js';
import { LlmCatalogWorker } from '../../src/catalog/worker.js';
import { buildEnrichment } from '../../src/enrichment/build-enrichment.js';
import { LlmEnrichmentWorker } from '../../src/enrichment/worker.js';
import { LlmScholarshipWorker } from '../../src/enrichment/scholarships.js';
import { CatalogFileSchema } from '../../src/core/types/program-record.js';
import type { Snapshot } from '../../src/core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { ScholarshipFileSchema } from '../../src/core/types/scholarship-record.js';
import { buildUniverse, type UniverseRegistry } from '../../src/universe/build-universe.js';
import { FileStore } from '../../src/storage/store.js';
import type { SearchResult } from '../../src/tools/search.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const HOMEPAGE = `<html><body><h1>Alpha University</h1>
  <a href="/graduate">Graduate programs</a>
  <a href="/admissions">Admissions</a>
  <a href="/fees">Tuition & fees</a></body></html>`;
const INFO_PAGE = `<html><body><p>Graduate study, admissions, tuition and funding detail.</p></body></html>`;

const CATALOG_PROGRAMS = [
  {
    program: 'MSc Computer Science',
    degree_type: 'MSc',
    department: 'Computer Science',
    language: 'English',
    duration_months: 12,
    city: null,
  },
];

const ENRICH_DETAIL = {
  requirements: {
    min_gpa: { raw: '3.0 / 4.0', us_4_0_equivalent: 3.0 },
    required_background: 'Computer Science',
    prerequisites: ['programming'],
    gre: 'optional',
    english_tests: { ielts: '6.5', toefl: '90', duolingo: null, pte: null },
    english_waiver: { available: true, basis: 'English-medium instruction' },
    reference_letters: 2,
    other_documents: ['CV'],
  },
  logistics: {
    application_deadlines: ['2027-01-15'],
    intake_terms: ['Fall'],
    application_fee: 'USD 75',
    application_portal: 'https://alpha.edu/apply',
    decision_timeline: '6-8 weeks',
  },
  cost_and_funding: {
    tuition_international: { amount: 40000, currency: 'USD', period: 'year' },
    living_cost_estimate: null,
    scholarships_for_internationals: ['Dean Award'],
    funding_likelihood: 'partial',
    fully_funded: false,
  },
  outcomes: { field_ranking: 'Top 30 US', post_study_work_rights: 'F-1 OPT', placement_info: null },
  conflict_notes: '',
};

const SCHOLARSHIPS = [
  {
    name: 'International Excellence Scholarship',
    funder: 'Alpha University',
    funder_type: 'university',
    type: 'partial',
    eligibility: {
      nationalities: [],
      countries_of_study: ['US'],
      degree_levels: ["Master's"],
      other_conditions: ['international applicants'],
    },
    value: { covers: ['tuition'], amount_note: 'up to USD 15,000' },
    application: { deadline: '2027-01-15', portal: 'https://alpha.edu/aid', linked_to_program_admission: true },
    source_url: 'https://funder.test/aid',
  },
];

/** Routes catalog/enrichment/scholarship LLM calls to canned answers. */
function responder(system: string, user: string): string {
  if (system.includes('scholarship and funding schemes')) return JSON.stringify(SCHOLARSHIPS);
  if (system.includes('admission, cost, funding')) return JSON.stringify(ENRICH_DETAIL);
  if (system.includes('identify which')) {
    return JSON.stringify(user.match(/https?:\/\/[^\s|]+/g) ?? []);
  }
  return JSON.stringify(CATALOG_PROGRAMS);
}

const US_SNAPSHOT: Snapshot = {
  schema_version: '1.0',
  meta: {
    country: 'US',
    fetched_at: '2026-05-19T00:00:00.000Z',
    sources: [],
    institution_count: 1,
    filter_applied: 'test',
    lower_confidence: false,
  },
  institutions: [
    {
      name: 'Alpha University',
      country: 'US',
      region: 'MA',
      official_url: 'https://alpha.edu',
      registry_source: 'NCES IPEDS',
      raw_id: '1',
    },
  ],
};

const registry: UniverseRegistry = {
  hasSnapshot: () => Promise.resolve(true),
  getSnapshot: () => Promise.resolve(US_SNAPSHOT),
  sourceLabel: () => 'NCES IPEDS',
};

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
      universe: 'pending',
      catalog: 'pending',
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

describe('enrichment pipeline (universe → catalog → enrichment, offline)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-enrich-pipeline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('chains catalog and enrichment to an enriched catalog + scholarships', async () => {
    const store = new FileStore(join(dir, 'runs'));
    const runDir = store.resolveRunDir('run-2026');
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest('run-2026'), RunManifestSchema);

    const fetcher = new StubFetcher({
      'https://alpha.edu': { body: HOMEPAGE },
      'https://alpha.edu/graduate': { body: INFO_PAGE },
      'https://alpha.edu/admissions': { body: INFO_PAGE },
      'https://alpha.edu/fees': { body: INFO_PAGE },
      'https://funder.test/aid': { body: INFO_PAGE },
    });
    const llm = new StubLlm(responder);
    const search = new StubSearch(HITS);

    await buildUniverse('run-2026', {}, { store, registry });

    const catalogResult = await buildCatalog(
      'run-2026',
      {},
      { store, worker: new LlmCatalogWorker({ llm, fetcher, search, store }) },
    );
    expect(catalogResult.complete).toBe(true);
    expect(catalogResult.totalPrograms).toBe(1);

    const enrichResult = await buildEnrichment(
      'run-2026',
      {},
      {
        store,
        worker: new LlmEnrichmentWorker({ llm, fetcher, search, store }),
        scholarshipWorker: new LlmScholarshipWorker({ llm, fetcher, search, store }),
      },
    );

    expect(enrichResult.complete).toBe(true);
    expect(enrichResult.enrichedPrograms).toBe(1);
    expect(enrichResult.scholarshipsFound).toBeGreaterThan(0);

    const catalog = await store.readJson(join(runDir, 'catalog.json'), CatalogFileSchema);
    const program = catalog.programs[0]!;
    expect(program.requirements?.english_tests?.ielts).toBe('6.5');
    expect(program.cost_and_funding?.tuition_international?.amount).toBe(40000);
    expect(program.outcomes?.post_study_work_rights).toBe('F-1 OPT');
    expect(program.provenance.source_confidence).toBe('web-verified');

    const scholarships = await store.readJson(join(runDir, 'scholarships.json'), ScholarshipFileSchema);
    expect(scholarships.scholarships[0]?.name).toBe('International Excellence Scholarship');

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.enrichment).toBe('complete');

    // Re-running enrichment is idempotent.
    const again = await buildEnrichment(
      'run-2026',
      {},
      {
        store,
        worker: new LlmEnrichmentWorker({ llm, fetcher, search, store }),
        scholarshipWorker: new LlmScholarshipWorker({ llm, fetcher, search, store }),
      },
    );
    expect(again.skipped).toBe(true);
  });
});
