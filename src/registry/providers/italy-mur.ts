import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseCsvRegistry } from './csv-registry.js';

/**
 * MUR (Ministero dell'Università e della Ricerca) publishes the list of
 * recognised Italian HE institutions through the "ustat" / "cercauniversita"
 * platform. The bulk export below is the closest plain CSV — override with
 * FINDER_IT_REGISTRY_URL if MUR republishes.
 */
const DEFAULT_IT_URL = 'https://ustat.mur.gov.it/opendata/atenei.csv';

const IT_ENV = 'FINDER_IT_REGISTRY_URL';

/** Italy registry — MUR ustat list of universities (atenei). */
export class ItalyMurProvider implements RegistryProvider {
  readonly country = 'Italy' as const;
  readonly sourceLabel = 'MUR — ustat Atenei italiani';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[IT_ENV] ?? DEFAULT_IT_URL;
    ctx.logger.step('Italy: fetching MUR ustat list of universities…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`MUR Italy registry download failed (HTTP ${res.status})`, {
        hint: `set ${IT_ENV} to the current MUR/ustat export URL`,
      });
    }

    const institutions = parseCsvRegistry(res.text(), {
      country: 'Italy',
      registrySource: 'MUR ustat',
      delimiter: ';',
      columns: {
        name: ['NomeAteneo', 'Ateneo', 'denominazione', 'nome'],
        url: ['Sito', 'sito_web', 'website', 'url'],
        region: ['Regione', 'regione', 'Citta', 'citta'],
        id: ['CodiceAteneo', 'codice_ateneo', 'codice', 'id'],
        type: ['TipoAteneo', 'tipo', 'tipologia'],
      },
    });

    if (institutions.length === 0) {
      throw new RegistryError('MUR Italy parse produced zero institutions', {
        hint: 'the MUR export columns may have changed — inspect the CSV header',
      });
    }

    const source: RegistrySource = {
      name: 'MUR ustat — Atenei',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'All recognised Italian universities',
    };
  }
}
