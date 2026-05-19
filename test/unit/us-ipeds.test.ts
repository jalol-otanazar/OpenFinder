import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../src/core/logger.js';
import { UsIpedsProvider } from '../../src/registry/providers/us-ipeds.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const IPEDS_URL = 'https://nces.ed.gov/ipeds/datacenter/data/HD2023.zip';

function ipedsZip(csv: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('hd2023.csv', Buffer.from(csv, 'latin1'));
  return zip.toBuffer();
}

describe('UsIpedsProvider', () => {
  const prevYear = process.env.FINDER_IPEDS_YEAR;

  beforeEach(() => {
    delete process.env.FINDER_IPEDS_YEAR;
  });
  afterEach(() => {
    if (prevYear === undefined) delete process.env.FINDER_IPEDS_YEAR;
    else process.env.FINDER_IPEDS_YEAR = prevYear;
  });

  it('keeps only Doctoral/Master’s Carnegie institutions', async () => {
    const csv =
      'UNITID,INSTNM,STABBR,WEBADDR,C21BASIC\n' +
      '1,Graduate Research University,MA,www.grad.edu,15\n' +
      '2,Masters College,VT,www.masters.edu,18\n' +
      '3,Tiny Baccalaureate College,VT,www.tiny.edu,21\n';

    const provider = new UsIpedsProvider();
    const result = await provider.fetch({
      fetcher: new StubFetcher({ [IPEDS_URL]: { body: ipedsZip(csv) } }),
      logger,
    });

    // codes 15 and 18 kept; 21 (baccalaureate) excluded
    expect(result.institutions).toHaveLength(2);
    const names = result.institutions.map((i) => i.name).sort();
    expect(names).toEqual(['Graduate Research University', 'Masters College']);
    expect(result.institutions[0]!.country).toBe('US');
    expect(result.institutions[0]!.raw_id).toBe('1');
    expect(result.sources[0]!.row_count).toBe(3);
  });
});
