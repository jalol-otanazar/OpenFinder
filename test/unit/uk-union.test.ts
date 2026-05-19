import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../src/core/logger.js';
import { UkUnionProvider } from '../../src/registry/providers/uk-union.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const OFS_URL = 'stub://ofs';
const HESA_URL = 'stub://hesa';

const OFS_JSON = JSON.stringify([
  {
    CommonName: 'University of Test',
    LegalName: 'Test Limited',
    TradingName: 'Test',
    Ukprn: '10000001',
    Website: 'https://test.ac.uk',
    DateOfRemovalFromRegister: null,
    DateOfVoluntaryDeregistration: null,
  },
  // CommonName null → fall back to the first line of TradingName.
  {
    CommonName: null,
    LegalName: 'Lamda Limited',
    TradingName: 'LAMDA\nLondon Academy of Music and Dramatic Art',
    Ukprn: '10003758',
    Website: 'https://www.lamda.ac.uk',
  },
  // Removed providers must be skipped.
  {
    CommonName: 'Old Removed Provider',
    Ukprn: '10000999',
    Website: '',
    DateOfRemovalFromRegister: '2020-01-01',
  },
]);

const HESA_CSV =
  'HE Provider,Website,Country,UKPRN\n' +
  'University of Glasgow,https://gla.ac.uk,Scotland,10007785\n' +
  'University of Leeds,https://leeds.ac.uk,England,10007795\n';

describe('UkUnionProvider', () => {
  const saved = {
    ofs: process.env.FINDER_UK_OFS_URL,
    hesa: process.env.FINDER_UK_HESA_URL,
  };

  beforeEach(() => {
    process.env.FINDER_UK_OFS_URL = OFS_URL;
    process.env.FINDER_UK_HESA_URL = HESA_URL;
  });
  afterEach(() => {
    restore('FINDER_UK_OFS_URL', saved.ofs);
    restore('FINDER_UK_HESA_URL', saved.hesa);
  });

  it('unions the OfS register (JSON) and the HESA list (CSV)', async () => {
    const fetcher = new StubFetcher({
      [OFS_URL]: { body: OFS_JSON, contentType: 'application/json' },
      [HESA_URL]: { body: HESA_CSV, contentType: 'text/csv' },
    });
    const result = await new UkUnionProvider().fetch({ fetcher, logger });

    // 2 from OfS (the removed one is skipped) + 2 from HESA.
    expect(result.institutions).toHaveLength(4);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((s) => s.note.length === 0)).toBe(true);
    expect(result.lowerConfidence).toBe(false);

    const ofs = result.institutions.filter((i) => i.registry_source === 'OfS Register');
    expect(ofs.every((i) => i.region === 'England')).toBe(true);
    // CommonName null → first line of TradingName.
    expect(ofs.find((i) => i.raw_id === '10003758')?.name).toBe('LAMDA');

    const hesa = result.institutions.filter((i) => i.registry_source === 'HESA');
    expect(hesa).toHaveLength(2);
  });

  it('degrades when HESA is unreachable and reports lower confidence', async () => {
    // Only OfS is routed — HESA's stub URL has no route → it fails.
    const fetcher = new StubFetcher({
      [OFS_URL]: { body: OFS_JSON, contentType: 'application/json' },
    });
    const result = await new UkUnionProvider().fetch({ fetcher, logger });

    expect(result.institutions).toHaveLength(2);
    const degraded = result.sources.filter((s) => s.note.length > 0);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]?.name).toContain('HESA');
    expect(result.lowerConfidence).toBe(true);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
