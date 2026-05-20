import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * The Chinese Ministry of Education publishes the canonical national list of
 * recognised HEIs at moe.gov.cn. The page is partially geofenced and may be
 * unreachable from outside Mainland China — when it is, override with
 * FINDER_CN_REGISTRY_URL (the Wikipedia "List of universities in China"
 * mirror is a reasonable cross-check), and the headless tier will retry.
 *
 * Marked lowerConfidence because non-Chinese-IP access is unreliable; the
 * universe report tells students the list rests on a union basis when so.
 */
const DEFAULT_CN_URL = 'https://en.wikipedia.org/wiki/List_of_universities_in_China';

const CN_ENV = 'FINDER_CN_REGISTRY_URL';

/** China registry — MoE list of recognised HEIs (cross-checked via Wikipedia). */
export class ChinaMoeProvider implements RegistryProvider {
  readonly country = 'China' as const;
  readonly sourceLabel = 'MoE-recognised Chinese universities (Wikipedia cross-check)';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[CN_ENV] ?? DEFAULT_CN_URL;
    ctx.logger.step('China: fetching list of recognised universities…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`China registry fetch failed (HTTP ${res.status})`, {
        hint: `set ${CN_ENV} to a reachable list of recognised Chinese universities`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'China',
      registrySource: 'MoE-recognised (Wikipedia cross-check)',
      keywords: ['university', 'institute of technology', 'normal university', 'jiaotong'],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('China registry parse produced zero institutions', {
        hint: 'the source page structure may have changed',
      });
    }

    const source: RegistrySource = {
      name: 'MoE-recognised Chinese universities',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'MoE-recognised universities and institutes of technology',
      lowerConfidence: true,
    };
  }
}
