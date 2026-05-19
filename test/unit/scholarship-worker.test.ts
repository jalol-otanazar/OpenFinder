import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmScholarshipWorker, type ScholarshipTask } from '../../src/enrichment/scholarships.js';
import { ScholarshipShardSchema } from '../../src/core/types/scholarship-record.js';
import { FileStore } from '../../src/storage/store.js';
import type { SearchResult } from '../../src/tools/search.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const PAGE = `<html><body><p>Scholarship and funding information for international students.</p></body></html>`;

const HITS: SearchResult[] = [
  { title: 'Global Excellence Award', url: 'https://funder.test/excellence', snippet: 'For internationals.' },
  { title: 'Govt Scheme', url: 'https://funder.test/govt', snippet: 'National scholarship.' },
];

const SCHOLARSHIPS = [
  {
    name: 'Global Excellence Award',
    funder: 'Alpha University',
    funder_type: 'university',
    type: 'partial',
    eligibility: {
      nationalities: [],
      countries_of_study: ['US'],
      degree_levels: ["Master's"],
      other_conditions: ['international applicants'],
    },
    value: { covers: ['tuition'], amount_note: 'up to USD 10,000' },
    application: { deadline: '2027-01-15', portal: 'https://alpha.edu/aid', linked_to_program_admission: true },
    source_url: 'https://funder.test/excellence',
  },
  {
    name: 'National Government Scholarship',
    funder: 'Department of Education',
    funder_type: 'national-government',
    type: 'full',
    eligibility: { nationalities: ['any'], countries_of_study: ['US'], degree_levels: ['PhD'], other_conditions: [] },
    value: { covers: ['tuition', 'stipend'], amount_note: null },
    application: { deadline: null, portal: null, linked_to_program_admission: false },
    source_url: 'https://funder.test/govt',
  },
];

function destinationTask(dir: string): ScholarshipTask {
  return {
    runId: 'r1',
    taskId: 'scholarships-US',
    kind: 'destination',
    country: 'US',
    nationality: null,
    shardPath: join(dir, 'scholarships', 'scholarships-US.json'),
  };
}

describe('LlmScholarshipWorker', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-scholarship-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('gathers scholarships from search results and writes a shard', async () => {
    const worker = new LlmScholarshipWorker({
      llm: new StubLlm(() => JSON.stringify(SCHOLARSHIPS)),
      fetcher: new StubFetcher({
        'https://funder.test/excellence': { body: PAGE },
        'https://funder.test/govt': { body: PAGE },
      }),
      search: new StubSearch(HITS),
      store,
    });

    const result = await worker.run(destinationTask(dir));
    expect(result.scholarshipsFound).toBe(2);
    expect(result.llmCallsUsed).toBe(1);

    const shard = await store.readJson(result.shardPath, ScholarshipShardSchema);
    expect(shard.scholarships.map((s) => s.id).sort()).toEqual([
      'global_excellence_award',
      'national_government_scholarship',
    ]);
    const govt = shard.scholarships.find((s) => s.funder_type === 'national-government');
    expect(govt?.type).toBe('full');
    expect(govt?.provenance.source_confidence).toBe('web-verified');
  });

  it('runs a home-country task keyed on nationality', async () => {
    const worker = new LlmScholarshipWorker({
      llm: new StubLlm(() => JSON.stringify([SCHOLARSHIPS[0]])),
      fetcher: new StubFetcher({ 'https://funder.test/excellence': { body: PAGE } }),
      search: new StubSearch(HITS),
      store,
    });

    const result = await worker.run({
      runId: 'r1',
      taskId: 'scholarships-home',
      kind: 'home-country',
      country: null,
      nationality: 'Uzbek',
      shardPath: join(dir, 'scholarships', 'scholarships-home.json'),
    });
    expect(result.scholarshipsFound).toBe(1);
  });

  it('degrades to an empty shard when search returns nothing', async () => {
    const worker = new LlmScholarshipWorker({
      llm: new StubLlm(() => JSON.stringify(SCHOLARSHIPS)),
      fetcher: new StubFetcher({}),
      search: new StubSearch([]),
      store,
    });

    const result = await worker.run(destinationTask(dir));
    expect(result.scholarshipsFound).toBe(0);
    expect(result.llmCallsUsed).toBe(0);

    const shard = await store.readJson(result.shardPath, ScholarshipShardSchema);
    expect(shard.scholarships).toEqual([]);
  });

  it('deduplicates scholarships reported under the same name', async () => {
    const worker = new LlmScholarshipWorker({
      llm: new StubLlm(() => JSON.stringify([SCHOLARSHIPS[0], SCHOLARSHIPS[0]])),
      fetcher: new StubFetcher({ 'https://funder.test/excellence': { body: PAGE }, 'https://funder.test/govt': { body: PAGE } }),
      search: new StubSearch(HITS),
      store,
    });

    const result = await worker.run(destinationTask(dir));
    expect(result.scholarshipsFound).toBe(1);
  });
});
