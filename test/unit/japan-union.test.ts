import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logger } from '../../src/core/logger.js';
import { JapanUnionProvider } from '../../src/registry/providers/japan-union.js';
import { StubFetcher } from '../helpers/stub-fetcher.js';

const MEXT_URL = 'stub://jp-mext';
const JAUP_URL = 'stub://jp-jaup';

describe('JapanUnionProvider', () => {
  const saved = {
    mext: process.env.FINDER_JP_MEXT_URL,
    jaup: process.env.FINDER_JP_JAUP_URL,
  };
  beforeEach(() => {
    process.env.FINDER_JP_MEXT_URL = MEXT_URL;
    process.env.FINDER_JP_JAUP_URL = JAUP_URL;
  });
  afterEach(() => {
    restore('FINDER_JP_MEXT_URL', saved.mext);
    restore('FINDER_JP_JAUP_URL', saved.jaup);
  });

  it('unions MEXT + JAUP and reports lower confidence', async () => {
    const fetcher = new StubFetcher({
      [MEXT_URL]: { body: '<ul><li><a href="https://u-tokyo.ac.jp">University of Tokyo</a></li></ul>' },
      [JAUP_URL]: { body: '<ul><li><a href="https://waseda.jp">Waseda University</a></li></ul>' },
    });
    const result = await new JapanUnionProvider().fetch({ fetcher, logger });
    expect(result.institutions).toHaveLength(2);
    expect(result.sources).toHaveLength(2);
    expect(result.lowerConfidence).toBe(true);
  });

  it('degrades gracefully when one sub-source fails', async () => {
    const fetcher = new StubFetcher({
      [MEXT_URL]: { body: '<ul><li><a href="https://u-tokyo.ac.jp">University of Tokyo</a></li></ul>' },
      // JAUP_URL has no route → that sub-source throws
    });
    const result = await new JapanUnionProvider().fetch({ fetcher, logger });
    expect(result.institutions).toHaveLength(1);
    const degraded = result.sources.filter((s) => s.note.length > 0);
    expect(degraded).toHaveLength(1);
    expect(degraded[0]?.name).toContain('JAUP');
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
