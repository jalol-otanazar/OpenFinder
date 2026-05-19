import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseCsvRegistry } from './csv-registry.js';

/**
 * The Hochschulkompass (HRK) publishes a tab-separated, Latin-1-encoded list
 * of every recognised German HE institution at the URL below — override with
 * FINDER_DE_REGISTRY_URL if it moves. Columns: `Hs-Nr.`, `Hochschulkurzname`,
 * `Hochschulname`, `Adressname der Hochschule`, `Hochschultyp`, `Trägerschaft`,
 * `Bundesland`, `Anzahl Studierende`.
 */
const DEFAULT_DE_URL = 'https://hs-kompass.de/kompass/xml/download/hs_liste.txt';
const DE_ENV = 'FINDER_DE_REGISTRY_URL';

/** Germany registry — Hochschulkompass list of recognised HE institutions. */
export class GermanyHochschulkompassProvider implements RegistryProvider {
  readonly country = 'Germany' as const;
  readonly sourceLabel = 'Hochschulkompass (HRK)';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[DE_ENV] ?? DEFAULT_DE_URL;
    ctx.logger.step('Germany: fetching Hochschulkompass institution list…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000 });
    if (!res.ok) {
      throw new RegistryError(`Hochschulkompass download failed (HTTP ${res.status})`, {
        hint: `set ${DE_ENV} to the current Hochschulkompass list URL`,
      });
    }

    // The hs_liste.txt file is tab-separated and Latin-1 encoded — decode the
    // raw bytes so German umlauts (ä ö ü ß) survive into the institution names.
    const text = res.bytes.toString('latin1');

    const institutions = parseCsvRegistry(text, {
      country: 'Germany',
      registrySource: 'Hochschulkompass',
      delimiter: '\t',
      columns: {
        name: ['Hochschulname', 'Hochschule', 'name'],
        region: ['Bundesland'],
        id: ['Hs-Nr.', 'Hs-Nr', 'HsNr'],
      },
    });

    if (institutions.length === 0) {
      throw new RegistryError('Hochschulkompass parse produced zero institutions', {
        hint: 'the Hochschulkompass file format may have changed — inspect the header row',
      });
    }

    const source: RegistrySource = {
      name: 'Hochschulkompass (HRK)',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'All recognised higher-education institutions',
    };
  }
}
