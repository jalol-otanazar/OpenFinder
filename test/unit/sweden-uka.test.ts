import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../src/core/logger.js';
import { SwedenUkaProvider } from '../../src/registry/providers/sweden-uka.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const STUB_URL = 'stub://se';

const HTML =
  '<ul>' +
  '<li><a href="https://lu.se">Lund University</a></li>' +
  '<li><a href="https://uu.se">Uppsala University</a></li>' +
  '<li><a href="/about">About</a></li>' + // chrome, no keyword
  '</ul>';

describe('SwedenUkaProvider', () => {
  const saved = process.env.FINDER_SE_REGISTRY_URL;
  beforeEach(() => {
    process.env.FINDER_SE_REGISTRY_URL = STUB_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.FINDER_SE_REGISTRY_URL;
    else process.env.FINDER_SE_REGISTRY_URL = saved;
  });

  it('parses the Swedish HE listing, ignoring chrome links', async () => {
    const fetcher = new StubFetcher({
      [STUB_URL]: { body: HTML, contentType: 'text/html' },
    });
    const result = await new SwedenUkaProvider().fetch({ fetcher, logger });
    expect(result.institutions).toHaveLength(2);
    expect(result.institutions.map((i) => i.name).sort()).toEqual([
      'Lund University',
      'Uppsala University',
    ]);
    expect(result.lowerConfidence).toBe(true);
  });
});
