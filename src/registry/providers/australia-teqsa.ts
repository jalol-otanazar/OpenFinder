import { RegistryError } from '../../core/errors.js';
import type { RegistrySource } from '../../core/types/registry.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';
import { parseCsvRegistry } from './csv-registry.js';

/**
 * Best-effort default for the TEQSA National Register CSV export. Override with
 * FINDER_AU_REGISTRY_URL if TEQSA republishes it.
 */
const DEFAULT_AU_URL = 'https://www.teqsa.gov.au/national-register/export?format=csv';

const AU_ENV = 'FINDER_AU_REGISTRY_URL';

/**
 * Provider categories kept — those that grant degrees (and so plausibly offer
 * graduate programs). Sub-degree / vocational provider categories are excluded.
 */
const DEGREE_GRANTING_CATEGORIES = [
  'university',
  'university college',
  'institute of higher education',
];

/** Australia registry — TEQSA National Register of higher-education providers. */
export class AustraliaTeqsaProvider implements RegistryProvider {
  readonly country = 'Australia' as const;
  readonly sourceLabel = 'TEQSA National Register of higher education providers';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[AU_ENV] ?? DEFAULT_AU_URL;
    ctx.logger.step('Australia: fetching TEQSA National Register…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`TEQSA registry download failed (HTTP ${res.status})`, {
        hint: `set ${AU_ENV} to the current TEQSA National Register export URL`,
      });
    }

    const institutions = parseCsvRegistry(res.text(), {
      country: 'Australia',
      registrySource: 'TEQSA National Register',
      columns: {
        name: ['Provider Name', 'InstitutionName', 'Provider legal name', 'name'],
        url: ['Web Address', 'Website', 'url'],
        region: ['State', 'state', 'Provider State'],
        id: ['Provider ID', 'TEQSA ID', 'ProviderID', 'id'],
        type: ['Provider Category', 'category', 'Provider type'],
      },
      keepTypes: DEGREE_GRANTING_CATEGORIES,
    });

    if (institutions.length === 0) {
      throw new RegistryError('TEQSA registry parse produced zero providers', {
        hint: 'the TEQSA export columns may have changed — inspect the CSV header',
      });
    }

    const source: RegistrySource = {
      name: 'TEQSA National Register',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: `Provider categories: ${DEGREE_GRANTING_CATEGORIES.join(', ')}`,
    };
  }
}
