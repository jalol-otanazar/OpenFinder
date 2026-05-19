import { describe, expect, it } from 'vitest';
import { FinderConfigSchema, emptyConfig } from '../../src/core/types/config.js';
import { RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { UniverseFileSchema } from '../../src/core/types/universe.js';

describe('UniverseFileSchema', () => {
  const valid = {
    schema_version: '1.0',
    run_id: 'r1',
    generated: '2026-05-19',
    registry_sources: { US: 'NCES IPEDS' },
    institutions: [
      {
        id: 'us_mit',
        name: 'MIT',
        country: 'US',
        region: 'MA',
        registry_source: 'NCES IPEDS',
        official_url: 'https://mit.edu',
        status: 'unchecked',
        programs_found: null,
        last_checked: null,
        checked_by_batch: null,
        notes: '',
      },
    ],
  };

  it('accepts a well-formed universe file', () => {
    expect(UniverseFileSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const bad = { ...valid, institutions: [{ ...valid.institutions[0], status: 'maybe' }] };
    expect(UniverseFileSchema.safeParse(bad).success).toBe(false);
  });
});

describe('RunManifestSchema', () => {
  it('round-trips a bootstrapped manifest', () => {
    const manifest = {
      schema_version: '1.0',
      run_id: 'r1',
      created: '2026-05-19T00:00:00Z',
      updated: '2026-05-19T00:00:00Z',
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
    const parsed = RunManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown country in scope', () => {
    const bad = RunManifestSchema.safeParse({
      schema_version: '1.0',
      run_id: 'r1',
      created: 'x',
      updated: 'x',
      scope: { fields: ['CS'], countries: ['Atlantis'], intake: '', profile_ref: 'p' },
      files: {
        universe: 'u',
        catalog_shards_dir: 'c',
        catalog_merged: 'c',
        scholarships: 's',
        results_scored: 'r',
      },
      stage_status: {
        intake: 'pending',
        universe: 'pending',
        catalog: 'pending',
        enrichment: 'pending',
        scoring: 'pending',
        reporting: 'pending',
      },
      concurrency: { max_parallel_workers: 2, default_batch_size: 8 },
    });
    expect(bad.success).toBe(false);
  });
});

describe('FinderConfigSchema', () => {
  it('accepts the empty config', () => {
    expect(FinderConfigSchema.safeParse(emptyConfig()).success).toBe(true);
  });

  it('round-trips profiles and role chains', () => {
    const config = {
      schema_version: '1.0',
      profiles: {
        groq: { provider: 'groq', label: 'Groq', api_key: 'gsk_x', base_url: null },
      },
      roles: {
        orchestrator: [{ profile: 'groq', model: 'llama-3.3-70b' }],
        worker: [{ profile: 'groq', model: 'llama-3.3-70b' }],
      },
    };
    expect(FinderConfigSchema.safeParse(config).success).toBe(true);
  });
});
