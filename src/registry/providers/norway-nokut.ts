import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * NOKUT (the Norwegian Agency for Quality Assurance in Education) publishes
 * the list of accredited Norwegian HE institutions. The Studyinfo page below
 * lists every recognised university and university college. Override with
 * FINDER_NO_REGISTRY_URL if the directory page moves.
 */
const DEFAULT_NO_URL = 'https://www.studyinnorway.no/study-in-norway/universities-and-colleges';

const NO_ENV = 'FINDER_NO_REGISTRY_URL';

/** Norway registry — NOKUT-accredited universities and university colleges. */
export class NorwayNokutProvider implements RegistryProvider {
  readonly country = 'Norway' as const;
  readonly sourceLabel = 'NOKUT / Study in Norway — accredited HE institutions';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[NO_ENV] ?? DEFAULT_NO_URL;
    ctx.logger.step('Norway: fetching list of accredited HE institutions…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`Norway registry fetch failed (HTTP ${res.status})`, {
        hint: `set ${NO_ENV} to the current Study-in-Norway institutions URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Norway',
      registrySource: 'NOKUT / Study in Norway',
      keywords: [
        'university',
        'universitet',
        'høgskole',
        'hogskole',
        'høgskolen',
        'college',
        'school of',
      ],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('Norway registry parse produced zero institutions', {
        hint: 'the source page structure may have changed',
      });
    }

    const source: RegistrySource = {
      name: 'NOKUT / Study in Norway — institutions',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'NOKUT-accredited universities and university colleges',
      lowerConfidence: true,
    };
  }
}
