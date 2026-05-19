import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCatalog } from '../../src/catalog/build-catalog.js';
import { CatalogFileSchema } from '../../src/core/types/program-record.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { type UniverseFile, UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';

/**
 * Opt-in live smoke test — real LLM + real fetch + real search for one
 * institution. Skipped unless `FINDER_LIVE_SMOKE=1`, so it never gates CI or a
 * normal `npm test`. It needs a configured `worker` role (`finder setup`) and
 * network access. It asserts the pipeline runs and produces valid state — not
 * specific program counts, which vary with the live web.
 */
const LIVE = process.env['FINDER_LIVE_SMOKE'] === '1' || process.env['FINDER_LIVE_SMOKE'] === 'true';

function manifest(runId: string): RunManifest {
  const now = '2026-05-19T00:00:00.000Z';
  return {
    schema_version: '1.0',
    run_id: runId,
    created: now,
    updated: now,
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
      catalog: 'pending',
      enrichment: 'pending',
      scoring: 'pending',
      reporting: 'pending',
    },
    coverage: { US: { total: 1, checked: 0, ratio: 0 } },
    batches: [],
    concurrency: { max_parallel_workers: 1, default_batch_size: 1 },
    log: [],
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
        id: 'us_massachusetts_institute_of_technology',
        name: 'Massachusetts Institute of Technology',
        country: 'US',
        region: 'MA',
        registry_source: 'NCES IPEDS',
        official_url: 'https://www.mit.edu',
        status: 'unchecked',
        programs_found: null,
        last_checked: null,
        checked_by_batch: null,
        notes: '',
      },
    ],
  };
}

describe.skipIf(!LIVE)('catalog live smoke', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-catalog-live-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    'catalogs a real institution with the live LLM, fetcher, and search client',
    async () => {
      const store = new FileStore(join(dir, 'runs'));
      const runDir = store.resolveRunDir('live-run');
      await store.writeJson(join(runDir, 'run-manifest.json'), manifest('live-run'), RunManifestSchema);
      await store.writeJson(join(runDir, 'universe.json'), universe('live-run'), UniverseFileSchema);

      const result = await buildCatalog('live-run');

      expect(result.skipped).toBe(false);
      expect(result.remainingUnchecked).toBe(0);

      const built = await store.readJson(join(runDir, 'universe.json'), UniverseFileSchema);
      const entry = built.institutions[0]!;
      expect(['checked', 'no-programs', 'unreachable']).toContain(entry.status);

      const catalog = await store.readJson(join(runDir, 'catalog.json'), CatalogFileSchema);
      expect(catalog.program_count).toBe(catalog.programs.length);
      for (const program of catalog.programs) {
        expect(program.institution_id).toBe('us_massachusetts_institute_of_technology');
        expect(program.identity.program.length).toBeGreaterThan(0);
      }
    },
    180_000,
  );
});
