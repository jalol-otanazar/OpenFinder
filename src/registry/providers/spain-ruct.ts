import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import { canonicalUrl, cleanName } from '../normalize.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * RUCT (Registro de Universidades, Centros y Títulos) — the official Spanish
 * national register, run by the Ministerio de Universidades. There is no
 * unauthenticated bulk CSV; the public listing page exposes every recognised
 * university by name and link. Override with FINDER_ES_REGISTRY_URL.
 */
const DEFAULT_ES_URL =
  'https://www.universidades.gob.es/universidades-y-centros-universitarios/';

const ES_ENV = 'FINDER_ES_REGISTRY_URL';

/** Spain registry — RUCT recognised universities (public listing). */
export class SpainRuctProvider implements RegistryProvider {
  readonly country = 'Spain' as const;
  readonly sourceLabel = 'Ministerio de Universidades — RUCT';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[ES_ENV] ?? DEFAULT_ES_URL;
    ctx.logger.step('Spain: fetching Ministerio de Universidades RUCT listing…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`RUCT Spain registry fetch failed (HTTP ${res.status})`, {
        hint: `set ${ES_ENV} to the current RUCT listing URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Spain',
      registrySource: 'RUCT',
      keywords: ['universidad', 'university', 'mondragon', 'iese', 'esade'],
      pageUrl: url,
    }).map((row) => ({ ...row, name: cleanName(row.name), official_url: canonicalUrl(row.official_url) }));

    if (institutions.length === 0) {
      throw new RegistryError('RUCT Spain parse produced zero institutions', {
        hint: 'the RUCT page structure may have changed — inspect the HTML',
      });
    }

    const source: RegistrySource = {
      name: 'RUCT — Universidades',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Universidades recognised in RUCT',
      lowerConfidence: true,
    };
  }
}
