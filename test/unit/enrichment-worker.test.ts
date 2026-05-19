import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmEnrichmentWorker, type EnrichmentBatch } from '../../src/enrichment/worker.js';
import { CatalogShardSchema, type ProgramRecord } from '../../src/core/types/program-record.js';
import { FileStore } from '../../src/storage/store.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const HOMEPAGE = `<html><body><h1>Alpha University</h1>
  <a href="/admissions">Graduate admissions</a>
  <a href="/fees">Tuition & fees</a></body></html>`;
const PAGE = `<html><body><p>Admissions, fees and funding detail.</p></body></html>`;

const DETAIL = {
  requirements: {
    min_gpa: { raw: '3.0 / 4.0', us_4_0_equivalent: 3.0 },
    required_background: 'Computer Science',
    prerequisites: ['programming'],
    gre: 'not required',
    english_tests: { ielts: '6.5', toefl: '90', duolingo: null, pte: null },
    english_waiver: { available: true, basis: 'English-medium instruction' },
    reference_letters: 2,
    other_documents: ['CV', 'statement of purpose'],
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
    scholarships_for_internationals: ["Dean's Award"],
    funding_likelihood: 'partial',
    fully_funded: false,
  },
  outcomes: {
    field_ranking: 'Top 30 US (CS)',
    post_study_work_rights: 'F-1 OPT / STEM OPT',
    placement_info: null,
  },
  conflict_notes: '',
};

function responder(detail: unknown): (system: string) => string {
  return (system: string) => {
    if (system.includes('identify which')) {
      return JSON.stringify(['https://alpha.edu/admissions', 'https://alpha.edu/fees']);
    }
    return JSON.stringify(detail);
  };
}

function stubProgram(id: string): ProgramRecord {
  return {
    schema_version: '1.0',
    id,
    institution_id: 'us_alpha_university',
    identity: {
      university: 'Alpha University',
      program: 'MSc Artificial Intelligence',
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
      source_urls: ['https://alpha.edu/programs/ai'],
      last_verified: '2026-05-01',
      source_confidence: 'web-verified',
      verification_notes: 'catalog stub',
    },
  };
}

describe('LlmEnrichmentWorker', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-enrich-worker-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function batch(
    targets: { program: ProgramRecord; officialUrl: string }[],
    budget = 25,
  ): EnrichmentBatch {
    return {
      runId: 'r1',
      batchId: 'enrich-US-001',
      country: 'US',
      targets,
      fields: ['Computer Science'],
      intake: 'Fall 2027',
      llmCallBudget: budget,
      shardPath: join(dir, 'catalog', 'enrich-US-001.json'),
    };
  }

  function fullFetcher(): StubFetcher {
    return new StubFetcher({
      'https://alpha.edu': { body: HOMEPAGE },
      'https://alpha.edu/admissions': { body: PAGE },
      'https://alpha.edu/fees': { body: PAGE },
      'https://alpha.edu/programs/ai': { body: PAGE },
    });
  }

  it('fills all four sections from fetched pages and stamps web-verified provenance', async () => {
    const worker = new LlmEnrichmentWorker({
      llm: new StubLlm(responder(DETAIL)),
      fetcher: fullFetcher(),
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(
      batch([{ program: stubProgram('us_alpha_university_msc_ai'), officialUrl: 'https://alpha.edu' }]),
    );

    expect(result.programIds).toEqual(['us_alpha_university_msc_ai']);
    expect(result.llmCallsUsed).toBe(2);
    expect(result.budgetExhausted).toBe(false);

    const shard = await store.readJson(result.shardPath, CatalogShardSchema);
    const record = shard.programs[0]!;
    expect(record.requirements?.english_tests?.ielts).toBe('6.5');
    expect(record.requirements?.english_tests?.duolingo).toBeNull();
    expect(record.requirements?.reference_letters).toBe(2);
    expect(record.logistics?.intake_terms).toEqual(['Fall']);
    expect(record.cost_and_funding?.tuition_international?.amount).toBe(40000);
    expect(record.cost_and_funding?.funding_likelihood).toBe('partial');
    expect(record.outcomes?.post_study_work_rights).toBe('F-1 OPT / STEM OPT');
    expect(record.provenance.source_confidence).toBe('web-verified');
    expect(record.provenance.source_urls).toContain('https://alpha.edu/programs/ai');
    expect(record.provenance.source_urls).toContain('https://alpha.edu/admissions');
  });

  it('writes sparse but valid sections and flags model-knowledge when nothing is reachable', async () => {
    const worker = new LlmEnrichmentWorker({
      llm: new StubLlm(responder(DETAIL)),
      fetcher: new StubFetcher({}),
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(
      batch([{ program: stubProgram('us_alpha_university_msc_ai'), officialUrl: 'https://alpha.edu' }]),
    );
    expect(result.llmCallsUsed).toBe(0);

    const shard = await store.readJson(result.shardPath, CatalogShardSchema);
    const record = shard.programs[0]!;
    expect(record.requirements).not.toBeNull();
    expect(record.logistics).not.toBeNull();
    expect(record.cost_and_funding).not.toBeNull();
    expect(record.outcomes).not.toBeNull();
    expect(record.cost_and_funding?.funding_likelihood).toBe('unknown');
    expect(record.provenance.source_confidence).toBe('model-knowledge');
    expect(record.provenance.verification_notes).toContain('unreachable');
  });

  it('coerces a messy / partial extraction object into valid sections', async () => {
    const worker = new LlmEnrichmentWorker({
      llm: new StubLlm(responder({ requirements: { gre: 'optional', reference_letters: 'three' } })),
      fetcher: fullFetcher(),
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(
      batch([{ program: stubProgram('us_alpha_university_msc_ai'), officialUrl: 'https://alpha.edu' }]),
    );
    const shard = await store.readJson(result.shardPath, CatalogShardSchema);
    const record = shard.programs[0]!;
    expect(record.requirements?.gre).toBe('optional');
    expect(record.requirements?.reference_letters).toBeNull(); // "three" is not an int
    expect(record.logistics).not.toBeNull();
  });

  it('stops at the LLM-call budget and defers the rest of the batch', async () => {
    const worker = new LlmEnrichmentWorker({
      llm: new StubLlm(responder(DETAIL)),
      fetcher: fullFetcher(),
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(
      batch(
        [
          { program: stubProgram('us_alpha_university_msc_ai'), officialUrl: 'https://alpha.edu' },
          { program: stubProgram('us_alpha_university_msc_ml'), officialUrl: 'https://alpha.edu' },
        ],
        2,
      ),
    );
    expect(result.programIds).toHaveLength(1);
    expect(result.budgetExhausted).toBe(true);
  });
});
