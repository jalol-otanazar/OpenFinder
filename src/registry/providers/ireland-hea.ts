import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * The Higher Education Authority (HEA) lists every designated HE institution
 * in Ireland (universities, technological universities, institutes of
 * technology, colleges of education). Override with FINDER_IE_REGISTRY_URL.
 */
const DEFAULT_IE_URL = 'https://hea.ie/higher-education-institutions/';

const IE_ENV = 'FINDER_IE_REGISTRY_URL';

/** Ireland registry — HEA designated institutions. */
export class IrelandHeaProvider implements RegistryProvider {
  readonly country = 'Ireland' as const;
  readonly sourceLabel = 'HEA — Higher Education Institutions';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[IE_ENV] ?? DEFAULT_IE_URL;
    ctx.logger.step('Ireland: fetching HEA designated institutions list…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`HEA Ireland fetch failed (HTTP ${res.status})`, {
        hint: `set ${IE_ENV} to the current HEA institutions URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Ireland',
      registrySource: 'HEA',
      keywords: [
        'university',
        'college',
        'institute of technology',
        'technological university',
        'trinity',
        'royal college',
      ],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('HEA Ireland parse produced zero institutions', {
        hint: 'the HEA page structure may have changed',
      });
    }

    const source: RegistrySource = {
      name: 'HEA — Higher Education Institutions',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'HEA-designated higher-education institutions',
      lowerConfidence: true,
    };
  }
}
