import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LlmCatalogWorker, type CatalogBatch } from '../../src/catalog/worker.js';
import { CatalogShardSchema } from '../../src/core/types/program-record.js';
import type { UniverseEntry } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const HOMEPAGE = `<html><body>
  <h1>Alpha University</h1>
  <a href="/postgraduate">Postgraduate study</a>
  <a href="/about">About us</a>
  <a href="https://twitter.com/alpha">Social</a>
</body></html>`;

const PROGRAM_PAGE = `<html><body>
  <h2>Taught postgraduate courses</h2>
  <ul><li>MSc Artificial Intelligence</li><li>MSc Data Science</li></ul>
</body></html>`;

/** Routes the worker's two plain-text calls (select pages, extract programs). */
function responder(extracted: unknown[]): (system: string) => string {
  return (system: string) => {
    if (system.includes('identify which')) {
      return JSON.stringify(['https://alpha.edu/postgraduate']);
    }
    return JSON.stringify(extracted);
  };
}

const PROGRAMS = [
  {
    program: 'MSc Artificial Intelligence',
    degree_type: 'MSc',
    department: 'Computer Science',
    language: 'English',
    duration_months: 12,
    city: 'Alphatown',
  },
];

function entry(id: string, officialUrl: string): UniverseEntry {
  return {
    id,
    name: 'Alpha University',
    country: 'US',
    region: 'CA',
    registry_source: 'NCES IPEDS',
    official_url: officialUrl,
    status: 'unchecked',
    programs_found: null,
    last_checked: null,
    checked_by_batch: null,
    notes: '',
  };
}

describe('LlmCatalogWorker', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-worker-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function batch(institutions: UniverseEntry[], budget = 25): CatalogBatch {
    return {
      runId: 'r1',
      batchId: 'catalog-US-001',
      country: 'US',
      institutions,
      fields: ['Computer Science'],
      intake: 'Fall 2027',
      llmCallBudget: budget,
      shardPath: join(dir, 'catalog', 'catalog-US-001.json'),
    };
  }

  it('discovers programs from fetched pages and writes a provenance-stamped shard', async () => {
    const fetcher = new StubFetcher({
      'https://alpha.edu': { body: HOMEPAGE },
      'https://alpha.edu/postgraduate': { body: PROGRAM_PAGE },
    });
    const worker = new LlmCatalogWorker({
      llm: new StubLlm(responder(PROGRAMS)),
      fetcher,
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(batch([entry('us_alpha', 'https://alpha.edu')]));

    expect(result.outcomes).toEqual([{ id: 'us_alpha', status: 'checked', programsFound: 1 }]);
    expect(result.llmCallsUsed).toBe(2);
    expect(result.budgetExhausted).toBe(false);

    const shard = await store.readJson(result.shardPath, CatalogShardSchema);
    expect(shard.programs).toHaveLength(1);
    const program = shard.programs[0]!;
    expect(program.institution_id).toBe('us_alpha');
    expect(program.id).toBe('us_alpha_msc_artificial_intelligence');
    expect(program.identity.program).toBe('MSc Artificial Intelligence');
    expect(program.identity.degree_type).toBe('MSc');
    expect(program.requirements).toBeNull();
    expect(program.provenance.source_confidence).toBe('web-verified');
    expect(program.provenance.source_urls).toContain('https://alpha.edu/postgraduate');
  });

  it('marks an institution no-programs when extraction finds nothing in scope', async () => {
    const fetcher = new StubFetcher({
      'https://alpha.edu': { body: HOMEPAGE },
      'https://alpha.edu/postgraduate': { body: PROGRAM_PAGE },
    });
    const worker = new LlmCatalogWorker({
      llm: new StubLlm(responder([])),
      fetcher,
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(batch([entry('us_alpha', 'https://alpha.edu')]));
    expect(result.outcomes[0]).toEqual({ id: 'us_alpha', status: 'no-programs', programsFound: 0 });

    const shard = await store.readJson(result.shardPath, CatalogShardSchema);
    expect(shard.programs).toEqual([]);
  });

  it('marks an institution unreachable when nothing can be fetched', async () => {
    const worker = new LlmCatalogWorker({
      llm: new StubLlm(responder(PROGRAMS)),
      fetcher: new StubFetcher({}),
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(batch([entry('us_alpha', '')]));
    expect(result.outcomes[0]).toEqual({ id: 'us_alpha', status: 'unreachable', programsFound: 0 });
    expect(result.llmCallsUsed).toBe(0);
  });

  it('stops at the LLM-call budget and defers the rest of the batch', async () => {
    const fetcher = new StubFetcher({
      'https://alpha.edu': { body: HOMEPAGE },
      'https://alpha.edu/postgraduate': { body: PROGRAM_PAGE },
    });
    const worker = new LlmCatalogWorker({
      llm: new StubLlm(responder(PROGRAMS)),
      fetcher,
      search: new StubSearch(),
      store,
    });

    const result = await worker.run(
      batch([entry('us_alpha', 'https://alpha.edu'), entry('us_beta', 'https://alpha.edu')], 2),
    );

    expect(result.outcomes).toHaveLength(1);
    expect(result.budgetExhausted).toBe(true);
    expect(result.llmCallsUsed).toBe(2);
  });
});
