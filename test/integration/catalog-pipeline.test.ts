import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/catalog/build-catalog.js';
import { LlmCatalogWorker } from '../../src/catalog/worker.js';
import { CatalogFileSchema } from '../../src/core/types/program-record.js';
import type { Snapshot } from '../../src/core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';
import { buildUniverse, type UniverseRegistry } from '../../src/universe/build-universe.js';
import { StubLlm, StubSearch } from '../helpers/catalog-stubs.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const HOMEPAGE = (name: string): string =>
  `<html><body><h1>${name}</h1>
   <a href="/graduate">Graduate programs</a>
   <a href="/about">About us</a></body></html>`;
const PROGRAM_PAGE = `<html><body><h2>Graduate programs</h2>
   <p>MSc Computer Science — a 12-month taught masters.</p></body></html>`;

/** Two US institutions, as a registry snapshot the `universe` skill consumes. */
const US_SNAPSHOT: Snapshot = {
  schema_version: '1.0',
  meta: {
    country: 'US',
    fetched_at: '2026-05-19T00:00:00.000Z',
    sources: [],
    institution_count: 2,
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
    {
      name: 'Beta University',
      country: 'US',
      region: 'VT',
      official_url: 'https://beta.edu',
      registry_source: 'NCES IPEDS',
      raw_id: '2',
    },
  ],
};

const registry: UniverseRegistry = {
  hasSnapshot: () => Promise.resolve(true),
  getSnapshot: () => Promise.resolve(US_SNAPSHOT),
  sourceLabel: () => 'NCES IPEDS',
};

/** Routes the worker's plain-text calls: pick the /graduate page, extract one program. */
function responder(system: string, user: string): string {
  if (system.includes('identify which')) {
    const urls = user.match(/https?:\/\/[^\s|]+/g) ?? [];
    return JSON.stringify(urls.filter((u) => u.includes('graduate')));
  }
  return JSON.stringify([
    {
      program: 'MSc Computer Science',
      degree_type: 'MSc',
      department: 'Computer Science',
      language: 'English',
      duration_months: 12,
      city: null,
    },
  ]);
}

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

describe('catalog pipeline (universe build → catalog build, offline)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-catalog-pipeline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds the universe, then catalogs every institution end to end', async () => {
    const store = new FileStore(join(dir, 'runs'));
    const runDir = store.resolveRunDir('run-2026');
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest('run-2026'), RunManifestSchema);

    // Stage 2 — universe build.
    const universeResult = await buildUniverse('run-2026', {}, { store, registry });
    expect(universeResult.totalInstitutions).toBe(2);

    // Stage 3 — catalog build, driving the real worker over stubbed tools.
    const fetcher = new StubFetcher({
      'https://alpha.edu': { body: HOMEPAGE('Alpha University') },
      'https://alpha.edu/graduate': { body: PROGRAM_PAGE },
      'https://beta.edu': { body: HOMEPAGE('Beta University') },
      'https://beta.edu/graduate': { body: PROGRAM_PAGE },
    });
    const worker = new LlmCatalogWorker({
      llm: new StubLlm(responder),
      fetcher,
      search: new StubSearch(),
      store,
    });

    const result = await buildCatalog('run-2026', {}, { store, worker });

    expect(result.complete).toBe(true);
    expect(result.totalPrograms).toBe(2);
    expect(result.remainingUnchecked).toBe(0);

    const universe = await store.readJson(join(runDir, 'universe.json'), UniverseFileSchema);
    expect(universe.institutions.every((e) => e.status === 'checked')).toBe(true);
    expect(universe.institutions.every((e) => e.programs_found === 1)).toBe(true);

    const catalog = await store.readJson(join(runDir, 'catalog.json'), CatalogFileSchema);
    expect(catalog.program_count).toBe(2);
    expect(catalog.programs.map((p) => p.institution_id).sort()).toEqual([
      'us_alpha_university',
      'us_beta_university',
    ]);
    expect(catalog.programs.every((p) => p.provenance.source_confidence === 'web-verified')).toBe(
      true,
    );

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.catalog).toBe('complete');
    expect(updated.coverage['US']).toEqual({ total: 2, checked: 2, ratio: 1 });
    expect(updated.batches.filter((b) => b.stage === 'catalog' && b.status === 'complete').length)
      .toBeGreaterThan(0);

    // Re-running catalog is idempotent.
    const again = await buildCatalog('run-2026', {}, { store, worker });
    expect(again.skipped).toBe(true);
  });
});
