import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIntake } from '../../src/intake/build-intake.js';
import { buildUniverse, type UniverseRegistry } from '../../src/universe/build-universe.js';
import type { Snapshot } from '../../src/core/types/registry.js';
import { RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { UniverseFileSchema } from '../../src/core/types/universe.js';
import { FileStore } from '../../src/storage/store.js';
import { StubLlm } from '../helpers/catalog-stubs.js';

const EXTRACTION = {
  identity: { nationality: 'Uzbek' },
  preferences: { target_countries: ['US'], fields: ['Computer Science'], target_intake: 'Fall 2027' },
  real_goal: { scoring_profile: 'program-as-vehicle' },
  financial: { funding_need: 'fully_funded' },
};

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
    { name: 'Alpha University', country: 'US', region: 'CA', official_url: 'https://alpha.edu', registry_source: 'NCES IPEDS', raw_id: '1' },
    { name: 'Beta University', country: 'US', region: 'NY', official_url: 'https://beta.edu', registry_source: 'NCES IPEDS', raw_id: '2' },
  ],
};

const registry: UniverseRegistry = {
  hasSnapshot: () => Promise.resolve(true),
  getSnapshot: () => Promise.resolve(US_SNAPSHOT),
  sourceLabel: () => 'NCES IPEDS',
};

describe('intake pipeline (intake → universe, offline)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-intake-pipeline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('intake writes a manifest that universe consumes end to end', async () => {
    const store = new FileStore(join(dir, 'runs'));

    const intake = await runIntake(
      'run-2026',
      { prompt: 'Uzbek CS student, want a funded masters in the US to relocate into tech.' },
      { store, llm: new StubLlm(() => JSON.stringify(EXTRACTION)) },
    );
    expect(intake.fields).toEqual(['Computer Science']);
    expect(intake.countries).toEqual(['US']);

    const runDir = store.resolveRunDir('run-2026');
    const seeded = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(seeded.stage_status.intake).toBe('complete');
    expect(seeded.stage_status.universe).toBe('pending');

    const built = await buildUniverse('run-2026', {}, { store, registry });
    expect(built.skipped).toBe(false);
    expect(built.totalInstitutions).toBe(2);

    const universe = await store.readJson(join(runDir, 'universe.json'), UniverseFileSchema);
    expect(universe.institutions).toHaveLength(2);
    expect(universe.institutions.every((e) => e.status === 'unchecked')).toBe(true);

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    expect(updated.stage_status.universe).toBe('complete');
    expect(updated.coverage['US']?.total).toBe(2);
  });
});
