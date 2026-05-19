import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/core/types/registry.js';
import { SnapshotStore } from '../../src/registry/snapshot-store.js';

function sampleSnapshot(): Snapshot {
  return {
    schema_version: '1.0',
    meta: {
      country: 'US',
      fetched_at: '2026-05-19T10:00:00.000Z',
      sources: [
        {
          name: 'IPEDS',
          url: 'https://example.test/hd.zip',
          fetched_at: '2026-05-19T10:00:00.000Z',
          row_count: 1,
          tier: 'http',
          note: '',
        },
      ],
      institution_count: 1,
      filter_applied: 'test filter',
      lower_confidence: false,
    },
    institutions: [
      {
        name: 'MIT',
        country: 'US',
        region: 'MA',
        official_url: 'https://mit.edu',
        registry_source: 'IPEDS',
        raw_id: '166683',
      },
    ],
  };
}

describe('SnapshotStore', () => {
  let dir: string;
  let store: SnapshotStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-snap-'));
    store = new SnapshotStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when no snapshot has been cached', async () => {
    expect(await store.readLatest('US')).toBeNull();
    expect(await store.hasSnapshot('US')).toBe(false);
  });

  it('writes a dated snapshot and reads it back', async () => {
    await store.write(sampleSnapshot());
    expect(await store.hasSnapshot('US')).toBe(true);

    const loaded = await store.readLatest('US');
    expect(loaded).not.toBeNull();
    expect(loaded!.meta.institution_count).toBe(1);
    expect(loaded!.institutions[0]!.name).toBe('MIT');
  });
});
