import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseHtmlList } from './html-list.js';

/**
 * BMBWF (Bundesministerium für Bildung, Wissenschaft und Forschung) maintains
 * the list of recognised Austrian higher-education institutions — public
 * universities, universities of applied sciences (Fachhochschulen), university
 * colleges of teacher education, and private universities. Override with
 * FINDER_AT_REGISTRY_URL if the page moves.
 */
const DEFAULT_AT_URL = 'https://www.bmbwf.gv.at/Themen/HS-Uni/Hochschulsystem.html';

const AT_ENV = 'FINDER_AT_REGISTRY_URL';

/** Austria registry — BMBWF recognised HE institutions. */
export class AustriaBmbwfProvider implements RegistryProvider {
  readonly country = 'Austria' as const;
  readonly sourceLabel = 'BMBWF — recognised Austrian HE institutions';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[AT_ENV] ?? DEFAULT_AT_URL;
    ctx.logger.step('Austria: fetching BMBWF list of HE institutions…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`BMBWF Austria fetch failed (HTTP ${res.status})`, {
        hint: `set ${AT_ENV} to the current BMBWF Hochschulsystem URL`,
      });
    }

    const institutions = parseHtmlList(res.text(), {
      country: 'Austria',
      registrySource: 'BMBWF',
      keywords: [
        'universität',
        'universitaet',
        'university',
        'fachhochschule',
        'hochschule',
        'akademie',
      ],
      pageUrl: url,
    });

    if (institutions.length === 0) {
      throw new RegistryError('BMBWF Austria parse produced zero institutions', {
        hint: 'the BMBWF page structure may have changed — inspect the HTML',
      });
    }

    const source: RegistrySource = {
      name: 'BMBWF — Hochschulsystem',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Universitäten, Fachhochschulen, pädagogische Hochschulen, Akademien',
      lowerConfidence: true,
    };
  }
}
