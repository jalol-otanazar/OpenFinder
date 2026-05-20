import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseCsvRegistry } from './csv-registry.js';

/**
 * Open-data export of the French Ministry of Higher Education's "Principaux
 * établissements d'enseignement supérieur" dataset — semicolon-delimited CSV.
 * If the URL drifts (data.gouv republishes datasets periodically), override
 * with FINDER_FR_REGISTRY_URL.
 */
const DEFAULT_FR_URL =
  'https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-principaux-etablissements-enseignement-superieur/exports/csv?delimiter=%3B';

const FR_ENV = 'FINDER_FR_REGISTRY_URL';

/** France registry — data.esr Principaux établissements d'enseignement supérieur. */
export class FranceDataEsrProvider implements RegistryProvider {
  readonly country = 'France' as const;
  readonly sourceLabel = "Ministère de l'ESR — Principaux établissements (data.esr)";

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[FR_ENV] ?? DEFAULT_FR_URL;
    ctx.logger.step('France: fetching data.esr Principaux établissements list…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`data.esr France registry download failed (HTTP ${res.status})`, {
        hint: `set ${FR_ENV} to the current data.esr CSV export URL`,
      });
    }

    const institutions = parseCsvRegistry(res.text(), {
      country: 'France',
      registrySource: 'data.esr',
      delimiter: ';',
      columns: {
        name: ['uo_lib', 'uo_lib_officiel', 'nom', 'libelle', 'name'],
        url: ['url', 'website', 'site_web', 'page_url'],
        region: ['reg_nom', 'aca_nom', 'dep_nom', 'region'],
        id: ['uai', 'identifiant', 'uo_uai', 'id'],
        type: ['type_d_etablissement', 'type', 'categorie'],
      },
      keepTypes: [
        'université',
        'universite',
        'grand établissement',
        'grand etablissement',
        'école',
        'ecole',
        'institut',
      ],
    });

    if (institutions.length === 0) {
      throw new RegistryError('data.esr France parse produced zero institutions', {
        hint: 'the dataset columns may have changed — inspect the CSV header',
      });
    }

    const source: RegistrySource = {
      name: 'data.esr — Principaux établissements',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Universités, grands établissements, écoles, instituts',
    };
  }
}
