import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * Uddannelses- og Forskningsministeriet (the Danish Ministry of Higher
 * Education and Science) publishes the list of recognised Danish HE
 * institutions through the "Study in Denmark" portal. Override with
 * FINDER_DK_REGISTRY_URL if the directory page moves.
 */
const DEFAULT_DK_URL =
  'https://studyindenmark.dk/study-options/danish-higher-education-institutions';

const DK_ENV = 'FINDER_DK_REGISTRY_URL';

/** Denmark registry — Ministry of HE and Science recognised institutions. */
export class DenmarkUfmProvider implements RegistryProvider {
  readonly country = 'Denmark' as const;
  readonly sourceLabel = 'UFM / Study in Denmark — recognised HE institutions';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[DK_ENV] ?? DEFAULT_DK_URL;
    ctx.logger.step('Denmark: fetching list of recognised HE institutions…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`Denmark registry fetch failed (HTTP ${res.status})`, {
        hint: `set ${DK_ENV} to the current Study-in-Denmark institutions URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Denmark',
      registrySource: 'UFM / Study in Denmark',
      keywords: [
        'university',
        'universitet',
        'business school',
        'school of',
        'academy',
        'højskole',
        'university college',
      ],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('Denmark registry parse produced zero institutions', {
        hint: 'the source page structure may have changed',
      });
    }

    const source: RegistrySource = {
      name: 'UFM / Study in Denmark — institutions',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Universities, business schools, university colleges, academies',
      lowerConfidence: true,
    };
  }
}
