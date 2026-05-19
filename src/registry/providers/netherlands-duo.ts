import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseCsvRegistry } from './csv-registry.js';

/**
 * The DUO Open Onderwijsdata `adressen_ho` resource — addresses of recognised
 * Dutch HE institutions, served as a comma-delimited CSV. Override with
 * FINDER_NL_REGISTRY_URL if DUO rotates the resource id.
 */
const DEFAULT_NL_URL =
  'https://onderwijsdata.duo.nl/dataset/37051cda-b681-43eb-a385-efa18e99cdd2/resource/bf1da9c6-c688-4873-91b1-b12c9ac2c132/download/instellingenho.csv';

const NL_ENV = 'FINDER_NL_REGISTRY_URL';

/** Netherlands registry — DUO/RIO recognised higher-education institutions. */
export class NetherlandsDuoProvider implements RegistryProvider {
  readonly country = 'Netherlands' as const;
  readonly sourceLabel = 'DUO/RIO register of recognised institutions';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[NL_ENV] ?? DEFAULT_NL_URL;
    ctx.logger.step('Netherlands: fetching DUO/RIO institution register…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000 });
    if (!res.ok) {
      throw new RegistryError(`DUO registry download failed (HTTP ${res.status})`, {
        hint: `set ${NL_ENV} to the current DUO/RIO export URL`,
      });
    }

    const institutions = parseCsvRegistry(res.text(), {
      country: 'Netherlands',
      registrySource: 'DUO/RIO',
      columns: {
        name: ['INSTELLINGSNAAM', 'naam instelling', 'instellingsnaam', 'naam'],
        url: ['INTERNETADRES', 'website', 'internetadres', 'url'],
        region: ['PROVINCIE', 'provincie', 'gemeente', 'plaats'],
        id: ['INSTELLINGSCODE', 'BRIN', 'instellingscode', 'onderwijsnummer'],
        type: ['SOORT HO', 'SOORT INSTELLING', 'soort', 'onderwijssector', 'type'],
      },
      keepTypes: ['hbo', 'wo', 'universiteit', 'hogeschool', 'university'],
    });

    if (institutions.length === 0) {
      throw new RegistryError('DUO registry parse produced zero institutions', {
        hint: 'the DUO export columns may have changed — inspect the CSV header',
      });
    }

    const source: RegistrySource = {
      name: 'DUO/RIO recognised institutions',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Recognised degree-granting institutions (universiteit / hogeschool)',
    };
  }
}
