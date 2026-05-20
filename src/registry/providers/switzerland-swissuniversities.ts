import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * swissuniversities.ch is the umbrella organisation of all recognised Swiss
 * higher-education institutions — the canonical national list. Override with
 * FINDER_CH_REGISTRY_URL if the directory page moves.
 */
const DEFAULT_CH_URL = 'https://www.swissuniversities.ch/en/organisation/members';

const CH_ENV = 'FINDER_CH_REGISTRY_URL';

/** Switzerland registry — swissuniversities member institutions. */
export class SwitzerlandSwissUniversitiesProvider implements RegistryProvider {
  readonly country = 'Switzerland' as const;
  readonly sourceLabel = 'swissuniversities — member institutions';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[CH_ENV] ?? DEFAULT_CH_URL;
    ctx.logger.step('Switzerland: fetching swissuniversities member list…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`swissuniversities fetch failed (HTTP ${res.status})`, {
        hint: `set ${CH_ENV} to the current member list URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Switzerland',
      registrySource: 'swissuniversities',
      keywords: [
        'universit',
        'university',
        'hochschule',
        'haute école',
        'haute ecole',
        'fachhochschule',
        'eth ',
        'epfl',
        'usi',
      ],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('swissuniversities parse produced zero institutions', {
        hint: 'the swissuniversities page structure may have changed',
      });
    }

    const source: RegistrySource = {
      name: 'swissuniversities — members',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Cantonal universities, federal institutes of technology, universities of applied sciences',
      lowerConfidence: true,
    };
  }
}
