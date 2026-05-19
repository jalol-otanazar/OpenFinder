import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';
import { buildUniverse, type UniverseRegistry } from '../../src/universe/build-universe.js';

function usSnapshot(): Snapshot {
  return {
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
        region: 'CA',
        official_url: 'https://alpha.edu',
        registry_source: 'NCES IPEDS',
        raw_id: '1',
      },
      {
        name: 'Beta University',
        country: 'US',
        region: 'NY',
        official_url: '',
        registry_source: 'NCES IPEDS',
        raw_id: '2',
      },
    ],
  };
}

const fakeRegistry: UniverseRegistry = {
  hasSnapshot: () => Promise.resolve(true),
  getSnapshot: () => Promise.resolve(usSnapshot()),
  sourceLabel: () => 'NCES IPEDS',
};

function manifest(runId: string): RunManifest {
  return {
    schema_version: '1.0',
    run_id: runId,
    created: '2026-05-19T00:00:00.000Z',
    updated: '2026-05-19T00:00:00.000Z',
    scope: {
      fields: ['CS'],
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

describe('buildUniverse', () => {
  let dir: string;
  let store: FileStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-universe-'));
    store = new FileStore(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('builds universe.json with every entry unchecked and records coverage', async () => {
    const runDir = store.resolveRunDir('r1');
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest('r1'), RunManifestSchema);

    const result = await buildUniverse('r1', {}, { store, registry: fakeRegistry });
    expect(result.skipped).toBe(false);
    expect(result.totalInstitutions).toBe(2);

    const universe = await store.readJson(join(runDir, 'universe.json'), UniverseFileSchema);
    expect(universe.institutions).toHaveLength(2);
    expect(universe.institutions.every((e) => e.status === 'unchecked')).toBe(true);
    expect(universe.institutions.every((e) => e.programs_found === null)).toBe(true);

    const ids = universe.institutions.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id.startsWith('us_'))).toBe(true);

    const beta = universe.institutions.find((e) => e.name === 'Beta University');
    expect(beta!.notes).toContain('official URL missing');

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.coverage['US']).toEqual({ total: 2, checked: 0, ratio: 0 });
    expect(updated.stage_status.universe).toBe('complete');
  });

  it('is idempotent — a second build is skipped unless forced', async () => {
    const runDir = store.resolveRunDir('r2');
    await store.writeJson(join(runDir, 'run-manifest.json'), manifest('r2'), RunManifestSchema);

    await buildUniverse('r2', {}, { store, registry: fakeRegistry });
    const second = await buildUniverse('r2', {}, { store, registry: fakeRegistry });
    expect(second.skipped).toBe(true);

    const forced = await buildUniverse('r2', { force: true }, { store, registry: fakeRegistry });
    expect(forced.skipped).toBe(false);
  });
});
