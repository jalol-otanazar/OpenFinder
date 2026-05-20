import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * UKÄ (Universitetskanslersämbetet — the Swedish Higher Education Authority)
 * publishes the list of state, independent, and private HE institutions
 * authorised to award degrees in Sweden. Override with FINDER_SE_REGISTRY_URL.
 */
const DEFAULT_SE_URL = 'https://english.uka.se/about-us/higher-education-in-sweden/swedish-higher-education-institutions.html';

const SE_ENV = 'FINDER_SE_REGISTRY_URL';

/** Sweden registry — UKÄ list of Swedish HE institutions. */
export class SwedenUkaProvider implements RegistryProvider {
  readonly country = 'Sweden' as const;
  readonly sourceLabel = 'UKÄ — Swedish higher-education institutions';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[SE_ENV] ?? DEFAULT_SE_URL;
    ctx.logger.step('Sweden: fetching UKÄ list of HE institutions…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`UKÄ Sweden fetch failed (HTTP ${res.status})`, {
        hint: `set ${SE_ENV} to the current UKÄ institutions URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Sweden',
      registrySource: 'UKÄ',
      keywords: [
        'university',
        'university college',
        'högskola',
        'hogskola',
        'universitet',
        'institute',
      ],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('UKÄ Sweden parse produced zero institutions', {
        hint: 'the UKÄ page structure may have changed',
      });
    }

    const source: RegistrySource = {
      name: 'UKÄ — Swedish HE institutions',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'State, independent, and private degree-awarding HE institutions',
      lowerConfidence: true,
    };
  }
}
