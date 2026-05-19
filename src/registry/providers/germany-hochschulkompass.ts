import { RegistryError } from '../../core/errors.js';
import type { RegistryInstitution, RegistrySource } from '../../core/types/registry.js';
import { canonicalUrl, cleanName } from '../normalize.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';

/**
 * Best-effort default for the Hochschulkompass (HRK) institution list. Override
 * with FINDER_DE_REGISTRY_URL. NOTE: if the real source paginates, the URL must
 * return the full list — a partial page would reproduce the Stage A failure.
 */
const DEFAULT_DE_URL = 'https://www.hochschulkompass.de/api/hochschulen.json';

const DE_ENV = 'FINDER_DE_REGISTRY_URL';

const NAME_FIELDS = ['name', 'hochschulname', 'nameDe', 'displayName', 'bezeichnung'];
const URL_FIELDS = ['url', 'website', 'homepage', 'www', 'internet'];
const REGION_FIELDS = ['bundesland', 'state', 'land', 'region'];
const ID_FIELDS = ['id', 'hsId', 'uid', 'hochschulId'];

/** Germany registry — Hochschulkompass (German Rectors' Conference). */
export class GermanyHochschulkompassProvider implements RegistryProvider {
  readonly country = 'Germany' as const;
  readonly sourceLabel = 'Hochschulkompass (HRK)';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[DE_ENV] ?? DEFAULT_DE_URL;
    ctx.logger.step('Germany: fetching Hochschulkompass institution list…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000 });
    if (!res.ok) {
      throw new RegistryError(`Hochschulkompass download failed (HTTP ${res.status})`, {
        hint: `set ${DE_ENV} to the current Hochschulkompass data URL`,
      });
    }

    let json: unknown;
    try {
      json = JSON.parse(res.text());
    } catch (err) {
      throw new RegistryError('Hochschulkompass response was not valid JSON', { cause: err });
    }

    const items = asList(json);
    const institutions: RegistryInstitution[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name = cleanName(pickField(record, NAME_FIELDS));
      if (name.length === 0) continue;
      const rawId = pickField(record, ID_FIELDS).trim();
      institutions.push({
        name,
        country: 'Germany',
        region: cleanName(pickField(record, REGION_FIELDS)),
        official_url: canonicalUrl(pickField(record, URL_FIELDS)),
        registry_source: 'Hochschulkompass',
        raw_id: rawId.length > 0 ? rawId : null,
      });
    }

    if (institutions.length === 0) {
      throw new RegistryError('Hochschulkompass parse produced zero institutions', {
        hint: 'the Hochschulkompass response shape may have changed',
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

function asList(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    for (const key of ['hochschulen', 'results', 'data', 'items', 'institutions']) {
      const value = (json as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  throw new RegistryError('Hochschulkompass response was not a recognizable list');
}

function pickField(record: Record<string, unknown>, candidates: string[]): string {
  for (const candidate of candidates) {
    for (const key of Object.keys(record)) {
      if (key.toLowerCase() === candidate.toLowerCase()) {
        const value = record[key];
        if (value !== null && value !== undefined) return String(value);
      }
    }
  }
  return '';
}
