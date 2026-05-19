import AdmZip from 'adm-zip';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_COUNTRIES } from '../../src/core/types/registry.js';
import { type RunManifest, RunManifestSchema } from '../../src/core/types/run-manifest.js';
import { UniverseFileSchema } from '../../src/core/types/universe.js';
import { RegistryService } from '../../src/registry/registry-service.js';
import { SnapshotStore } from '../../src/registry/snapshot-store.js';
import { FileStore } from '../../src/storage/store.js';
import { buildUniverse } from '../../src/universe/build-universe.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const IPEDS_URL = 'https://nces.ed.gov/ipeds/datacenter/data/HD2023.zip';
const STUB_URLS = {
  uk: 'stub://uk-hesa',
  ca: 'stub://ca',
  au: 'stub://au',
  de: 'stub://de',
  nl: 'stub://nl',
};

function ipedsZip(): Buffer {
  const csv =
    'UNITID,INSTNM,STABBR,WEBADDR,C21BASIC\n' +
    '1,Alpha Research University,MA,www.alpha.edu,15\n' +
    '2,Beta Masters University,VT,www.beta.edu,18\n';
  const zip = new AdmZip();
  zip.addFile('hd2023.csv', Buffer.from(csv, 'latin1'));
  return zip.toBuffer();
}

function fixtureFetcher(): StubFetcher {
  return new StubFetcher({
    [IPEDS_URL]: { body: ipedsZip() },
    [STUB_URLS.uk]: {
      body:
        'HE Provider,Website,Region,UKPRN\n' +
        'University of Leeds,https://leeds.ac.uk,Yorkshire,10007795\n' +
        'University of Southampton,https://southampton.ac.uk,South East,10007774\n',
    },
    [STUB_URLS.ca]: {
      body:
        '<ul><li><a href="https://utoronto.ca">University of Toronto</a></li>' +
        '<li><a href="https://ubc.ca">University of British Columbia</a></li></ul>',
    },
    [STUB_URLS.au]: {
      body:
        'Provider Name,Web Address,State,Provider Category\n' +
        'University of Melbourne,https://unimelb.edu.au,VIC,Australian University\n' +
        'Australian National University,https://anu.edu.au,ACT,Australian University\n',
    },
    [STUB_URLS.de]: {
      body: JSON.stringify([
        {
          name: 'Technische Universität Berlin',
          website: 'https://tu.berlin',
          bundesland: 'Berlin',
        },
        {
          name: 'Universität Heidelberg',
          website: 'https://uni-heidelberg.de',
          bundesland: 'Baden-Württemberg',
        },
      ]),
    },
    [STUB_URLS.nl]: {
      body:
        'INSTELLINGSNAAM;INTERNETADRES;PROVINCIE;SOORT INSTELLING\n' +
        'Universiteit van Amsterdam;https://uva.nl;Noord-Holland;Universiteit\n' +
        'Technische Universiteit Delft;https://tudelft.nl;Zuid-Holland;Universiteit\n',
    },
  });
}

function manifest(runId: string): RunManifest {
  return {
    schema_version: '1.0',
    run_id: runId,
    created: '2026-05-19T00:00:00.000Z',
    updated: '2026-05-19T00:00:00.000Z',
    scope: {
      fields: ['Computer Science'],
      countries: [...ALL_COUNTRIES],
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

describe('universe pipeline (6 countries, offline)', () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV = {
    FINDER_UK_HESA_URL: STUB_URLS.uk,
    FINDER_CA_REGISTRY_URL: STUB_URLS.ca,
    FINDER_AU_REGISTRY_URL: STUB_URLS.au,
    FINDER_DE_REGISTRY_URL: STUB_URLS.de,
    FINDER_NL_REGISTRY_URL: STUB_URLS.nl,
  };

  beforeAll(() => {
    for (const [key, value] of Object.entries(ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    savedEnv['FINDER_IPEDS_YEAR'] = process.env['FINDER_IPEDS_YEAR'];
    delete process.env['FINDER_IPEDS_YEAR'];
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'finder-pipeline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refreshes all six registries and builds a complete universe', async () => {
    const service = new RegistryService(new SnapshotStore(join(dir, 'cache')), fixtureFetcher());
    const store = new FileStore(join(dir, 'runs'));

    // refresh every country (the `universe refresh` step)
    for (const country of ALL_COUNTRIES) {
      const snapshot = await service.refresh(country);
      expect(snapshot.institutions.length).toBe(2);
    }

    // seed the manifest (the `bootstrap` step) and build (the `universe build` step)
    const runDir = store.resolveRunDir('run-2026');
    await store.writeJson(
      join(runDir, 'run-manifest.json'),
      manifest('run-2026'),
      RunManifestSchema,
    );
    const result = await buildUniverse('run-2026', {}, { store, registry: service });

    expect(result.totalInstitutions).toBe(12); // 2 per country × 6
    expect(result.skipped).toBe(false);

    const universe = await store.readJson(join(runDir, 'universe.json'), UniverseFileSchema);
    expect(universe.institutions.every((e) => e.status === 'unchecked')).toBe(true);
    expect(new Set(universe.institutions.map((e) => e.id)).size).toBe(12);
    expect(Object.keys(universe.registry_sources).sort()).toEqual([...ALL_COUNTRIES].sort());

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    for (const country of ALL_COUNTRIES) {
      expect(updated.coverage[country]?.total).toBe(2);
    }
    expect(updated.stage_status.universe).toBe('complete');

    // re-building is idempotent
    const again = await buildUniverse('run-2026', {}, { store, registry: service });
    expect(again.skipped).toBe(true);
  });
});
