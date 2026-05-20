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

// One stub URL per registry source. Union providers (UK, Belgium, Japan,
// Korea, Singapore) get two URLs each — one per sub-source.
const STUB_URLS = {
  uk: 'stub://uk-hesa',
  ca: 'stub://ca',
  au: 'stub://au',
  de: 'stub://de',
  nl: 'stub://nl',
  // Western Europe.
  fr: 'stub://fr',
  it: 'stub://it',
  es: 'stub://es',
  ch: 'stub://ch',
  at: 'stub://at',
  beVlir: 'stub://be-vlir',
  beCref: 'stub://be-cref',
  ie: 'stub://ie',
  // Nordics.
  se: 'stub://se',
  no: 'stub://no',
  dk: 'stub://dk',
  fi: 'stub://fi',
  // Asia.
  cn: 'stub://cn',
  jpMext: 'stub://jp-mext',
  jpJaup: 'stub://jp-jaup',
  krKcue: 'stub://kr-kcue',
  krKedi: 'stub://kr-kedi',
  sgMoe: 'stub://sg-moe',
  sgCpe: 'stub://sg-cpe',
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

/**
 * Wrap N anchors in a list so the html-list parser picks them all. Anchor text
 * must contain at least one of each provider's keywords — see the per-country
 * fixtures below for the matches.
 */
function htmlList(items: Array<{ name: string; href: string }>): string {
  const lis = items.map((i) => `<li><a href="${i.href}">${i.name}</a></li>`).join('');
  return `<ul>${lis}</ul>`;
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
      body: htmlList([
        { name: 'University of Toronto', href: 'https://utoronto.ca' },
        { name: 'University of British Columbia', href: 'https://ubc.ca' },
      ]),
    },
    [STUB_URLS.au]: {
      body:
        'Provider Name,Web Address,State,Provider Category\n' +
        'University of Melbourne,https://unimelb.edu.au,VIC,Australian University\n' +
        'Australian National University,https://anu.edu.au,ACT,Australian University\n',
    },
    [STUB_URLS.de]: {
      body:
        'Hs-Nr.\tHochschulkurzname\tHochschulname\tBundesland\n' +
        '01\tTU Berlin\tTechnische Universitaet Berlin\tBerlin\n' +
        '02\tUni HD\tUniversitaet Heidelberg\tBaden-Wuerttemberg\n',
    },
    [STUB_URLS.nl]: {
      body:
        'INSTELLINGSNAAM,INTERNETADRES,PROVINCIE,SOORT HO\n' +
        'Universiteit van Amsterdam,https://uva.nl,Noord-Holland,wo\n' +
        'Technische Universiteit Delft,https://tudelft.nl,Zuid-Holland,wo\n',
    },
    [STUB_URLS.fr]: {
      body:
        'uo_lib;url;reg_nom;uai;type_d_etablissement\n' +
        'Sorbonne Université;https://sorbonne-universite.fr;Île-de-France;0751717J;Université\n' +
        'École normale supérieure de Lyon;https://ens-lyon.fr;Auvergne-Rhône-Alpes;0691775E;École\n',
    },
    [STUB_URLS.it]: {
      body:
        'CodiceAteneo;NomeAteneo;Sito;Regione\n' +
        '01;Università di Bologna;https://unibo.it;Emilia-Romagna\n' +
        '02;Politecnico di Milano;https://polimi.it;Lombardia\n',
    },
    [STUB_URLS.es]: {
      body: htmlList([
        { name: 'Universidad Complutense de Madrid', href: 'https://ucm.es' },
        { name: 'Universidad de Barcelona', href: 'https://ub.edu' },
      ]),
    },
    [STUB_URLS.ch]: {
      body: htmlList([
        { name: 'ETH Zürich', href: 'https://ethz.ch' },
        { name: 'Université de Genève', href: 'https://unige.ch' },
      ]),
    },
    [STUB_URLS.at]: {
      body: htmlList([
        { name: 'Universität Wien', href: 'https://univie.ac.at' },
        { name: 'Technische Universität Graz', href: 'https://tugraz.at' },
      ]),
    },
    [STUB_URLS.beVlir]: {
      body: htmlList([{ name: 'KU Leuven Universiteit', href: 'https://kuleuven.be' }]),
    },
    [STUB_URLS.beCref]: {
      body: htmlList([{ name: 'Université libre de Bruxelles', href: 'https://ulb.be' }]),
    },
    [STUB_URLS.ie]: {
      body: htmlList([
        { name: 'Trinity College Dublin', href: 'https://tcd.ie' },
        { name: 'University College Cork', href: 'https://ucc.ie' },
      ]),
    },
    [STUB_URLS.se]: {
      body: htmlList([
        { name: 'Lund University', href: 'https://lu.se' },
        { name: 'Uppsala University', href: 'https://uu.se' },
      ]),
    },
    [STUB_URLS.no]: {
      body: htmlList([
        { name: 'University of Oslo', href: 'https://uio.no' },
        { name: 'Norwegian University of Science and Technology', href: 'https://ntnu.no' },
      ]),
    },
    [STUB_URLS.dk]: {
      body: htmlList([
        { name: 'University of Copenhagen', href: 'https://ku.dk' },
        { name: 'Aarhus University', href: 'https://au.dk' },
      ]),
    },
    [STUB_URLS.fi]: {
      body: htmlList([
        { name: 'University of Helsinki', href: 'https://helsinki.fi' },
        { name: 'Aalto University', href: 'https://aalto.fi' },
      ]),
    },
    [STUB_URLS.cn]: {
      body: htmlList([
        { name: 'Tsinghua University', href: 'https://tsinghua.edu.cn' },
        { name: 'Peking University', href: 'https://pku.edu.cn' },
      ]),
    },
    [STUB_URLS.jpMext]: {
      body: htmlList([{ name: 'University of Tokyo', href: 'https://u-tokyo.ac.jp' }]),
    },
    [STUB_URLS.jpJaup]: {
      body: htmlList([{ name: 'Waseda University', href: 'https://waseda.jp' }]),
    },
    [STUB_URLS.krKcue]: {
      body: htmlList([{ name: 'Seoul National University', href: 'https://snu.ac.kr' }]),
    },
    [STUB_URLS.krKedi]: {
      body: htmlList([{ name: 'KAIST Institute of Science and Technology', href: 'https://kaist.ac.kr' }]),
    },
    [STUB_URLS.sgMoe]: {
      body: htmlList([{ name: 'National University of Singapore', href: 'https://nus.edu.sg' }]),
    },
    [STUB_URLS.sgCpe]: {
      body: htmlList([{ name: 'Singapore Institute of Management', href: 'https://sim.edu.sg' }]),
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

describe(`universe pipeline (${ALL_COUNTRIES.length} countries, offline)`, () => {
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV = {
    FINDER_UK_HESA_URL: STUB_URLS.uk,
    FINDER_CA_REGISTRY_URL: STUB_URLS.ca,
    FINDER_AU_REGISTRY_URL: STUB_URLS.au,
    FINDER_DE_REGISTRY_URL: STUB_URLS.de,
    FINDER_NL_REGISTRY_URL: STUB_URLS.nl,
    FINDER_FR_REGISTRY_URL: STUB_URLS.fr,
    FINDER_IT_REGISTRY_URL: STUB_URLS.it,
    FINDER_ES_REGISTRY_URL: STUB_URLS.es,
    FINDER_CH_REGISTRY_URL: STUB_URLS.ch,
    FINDER_AT_REGISTRY_URL: STUB_URLS.at,
    FINDER_BE_VLIR_URL: STUB_URLS.beVlir,
    FINDER_BE_CREF_URL: STUB_URLS.beCref,
    FINDER_IE_REGISTRY_URL: STUB_URLS.ie,
    FINDER_SE_REGISTRY_URL: STUB_URLS.se,
    FINDER_NO_REGISTRY_URL: STUB_URLS.no,
    FINDER_DK_REGISTRY_URL: STUB_URLS.dk,
    FINDER_FI_REGISTRY_URL: STUB_URLS.fi,
    FINDER_CN_REGISTRY_URL: STUB_URLS.cn,
    FINDER_JP_MEXT_URL: STUB_URLS.jpMext,
    FINDER_JP_JAUP_URL: STUB_URLS.jpJaup,
    FINDER_KR_KCUE_URL: STUB_URLS.krKcue,
    FINDER_KR_KEDI_URL: STUB_URLS.krKedi,
    FINDER_SG_MOE_URL: STUB_URLS.sgMoe,
    FINDER_SG_CPE_URL: STUB_URLS.sgCpe,
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

  it('refreshes every registry and builds a complete universe', async () => {
    const service = new RegistryService(new SnapshotStore(join(dir, 'cache')), fixtureFetcher());
    const store = new FileStore(join(dir, 'runs'));

    // refresh every country (the `universe refresh` step). Each fixture is
    // engineered to land 2 institutions per country after dedupe so the
    // total-count assertions stay simple to read.
    for (const country of ALL_COUNTRIES) {
      const snapshot = await service.refresh(country);
      expect(snapshot.institutions.length, `${country} snapshot size`).toBe(2);
    }

    const runDir = store.resolveRunDir('run-2026');
    await store.writeJson(
      join(runDir, 'run-manifest.json'),
      manifest('run-2026'),
      RunManifestSchema,
    );
    const result = await buildUniverse('run-2026', {}, { store, registry: service });

    const expectedTotal = 2 * ALL_COUNTRIES.length;
    expect(result.totalInstitutions).toBe(expectedTotal);
    expect(result.skipped).toBe(false);

    const universe = await store.readJson(join(runDir, 'universe.json'), UniverseFileSchema);
    expect(universe.institutions.every((e) => e.status === 'unchecked')).toBe(true);
    expect(new Set(universe.institutions.map((e) => e.id)).size).toBe(expectedTotal);
    expect(Object.keys(universe.registry_sources).sort()).toEqual([...ALL_COUNTRIES].sort());

    const updated = await store.readJson(join(runDir, 'run-manifest.json'), RunManifestSchema);
    for (const country of ALL_COUNTRIES) {
      expect(updated.coverage[country]?.total, `${country} coverage total`).toBe(2);
    }
    expect(updated.stage_status.universe).toBe('complete');

    // re-building is idempotent
    const again = await buildUniverse('run-2026', {}, { store, registry: service });
    expect(again.skipped).toBe(true);
  });
});
