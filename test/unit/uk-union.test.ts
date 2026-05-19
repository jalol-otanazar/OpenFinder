import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../src/core/logger.js';
import { UkUnionProvider } from '../../src/registry/providers/uk-union.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const HESA_URL = 'stub://hesa';
const OFS_URL = 'stub://ofs';

const HESA_CSV =
  'HE Provider,Website,Region,UKPRN\n' +
  'University of Leeds,https://leeds.ac.uk,Yorkshire,10007795\n' +
  'University of Glasgow,https://gla.ac.uk,Scotland,10007785\n';

const OFS_CSV =
  'Provider name,Website,UKPRN\n' +
  'University of Southampton,https://southampton.ac.uk,10007774\n';

describe('UkUnionProvider', () => {
  const saved = {
    hesa: process.env.FINDER_UK_HESA_URL,
    ofs: process.env.FINDER_UK_OFS_URL,
  };

  beforeEach(() => {
    process.env.FINDER_UK_HESA_URL = HESA_URL;
    process.env.FINDER_UK_OFS_URL = OFS_URL;
  });
  afterEach(() => {
    restore('FINDER_UK_HESA_URL', saved.hesa);
    restore('FINDER_UK_OFS_URL', saved.ofs);
  });

  it('unions the sub-sources that succeed and degrades the rest', async () => {
    // HESA + OfS are routed; SFC / Wales / NI default URLs are not → they fail.
    const fetcher = new StubFetcher({
      [HESA_URL]: { body: HESA_CSV },
      [OFS_URL]: { body: OFS_CSV },
    });
    const result = await new UkUnionProvider().fetch({ fetcher, logger });

    expect(result.institutions).toHaveLength(3); // 2 from HESA + 1 from OfS
    expect(result.sources).toHaveLength(5); // every sub-source is recorded
    const degraded = result.sources.filter((s) => s.note.length > 0);
    expect(degraded).toHaveLength(3); // SFC, Wales, NI failed
    expect(result.lowerConfidence).toBe(true); // not all sources succeeded
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
