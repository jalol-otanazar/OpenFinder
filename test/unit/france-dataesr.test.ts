import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../src/core/logger.js';
import { FranceDataEsrProvider } from '../../src/registry/providers/france-dataesr.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const STUB_URL = 'stub://fr';

const CSV =
  'uo_lib;url;reg_nom;uai;type_d_etablissement\n' +
  'Sorbonne Université;https://sorbonne-universite.fr;Île-de-France;0751717J;Université\n' +
  "École normale supérieure de Lyon;https://ens-lyon.fr;Auvergne-Rhône-Alpes;0691775E;École\n" +
  // Type filter excludes vocational rows.
  'Lycée Pro;https://lycee.fr;Île-de-France;9999999X;Lycée\n';

describe('FranceDataEsrProvider', () => {
  const saved = process.env.FINDER_FR_REGISTRY_URL;
  beforeEach(() => {
    process.env.FINDER_FR_REGISTRY_URL = STUB_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.FINDER_FR_REGISTRY_URL;
    else process.env.FINDER_FR_REGISTRY_URL = saved;
  });

  it('parses the data.esr CSV and applies the type filter', async () => {
    const fetcher = new StubFetcher({
      [STUB_URL]: { body: CSV, contentType: 'text/csv' },
    });
    const result = await new FranceDataEsrProvider().fetch({ fetcher, logger });
    expect(result.institutions).toHaveLength(2);
    expect(result.institutions.map((i) => i.name)).toContain('Sorbonne Université');
    expect(result.sources).toHaveLength(1);
    expect(result.lowerConfidence).toBeFalsy();
  });
});
