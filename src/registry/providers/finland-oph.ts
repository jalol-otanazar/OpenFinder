import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * Opetushallitus / Studyinfo — the Finnish National Agency for Education's
 * portal lists every recognised university and university of applied sciences
 * (UAS). Override with FINDER_FI_REGISTRY_URL.
 */
const DEFAULT_FI_URL = 'https://www.studyinfinland.fi/universities';

const FI_ENV = 'FINDER_FI_REGISTRY_URL';

/** Finland registry — OPH/Studyinfo list of universities + UAS. */
export class FinlandOphProvider implements RegistryProvider {
  readonly country = 'Finland' as const;
  readonly sourceLabel = 'OPH / Study in Finland — universities and UAS';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[FI_ENV] ?? DEFAULT_FI_URL;
    ctx.logger.step('Finland: fetching Study-in-Finland list of HE institutions…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`Finland registry fetch failed (HTTP ${res.status})`, {
        hint: `set ${FI_ENV} to the current Study-in-Finland universities URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Finland',
      registrySource: 'OPH / Study in Finland',
      keywords: [
        'university',
        'yliopisto',
        'ammattikorkeakoulu',
        'university of applied sciences',
        'hanken',
        'school of',
      ],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('Finland registry parse produced zero institutions', {
        hint: 'the source page structure may have changed',
      });
    }

    const source: RegistrySource = {
      name: 'OPH / Study in Finland — institutions',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Finnish universities and universities of applied sciences',
      lowerConfidence: true,
    };
  }
}
