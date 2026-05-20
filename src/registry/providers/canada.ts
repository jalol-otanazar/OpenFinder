import * as cheerio from 'cheerio';
import { RegistryError } from '../../core/errors.js';
import type { RegistryInstitution, RegistrySource } from '../../core/types/registry.js';
import { canonicalUrl, cleanName, normalizeHost } from '../normalize.js';
import type { RegistryFetchContext, RegistryFetchResult, RegistryProvider } from '../provider.js';

/**
 * Default for the Universities Canada members page. The page is gated by a
 * bot defence that can refuse plain HTTP clients from some IPs (HTTP 403); set
 * FINDER_CA_REGISTRY_URL to a manually saved copy if that happens.
 */
const DEFAULT_CA_URL = 'https://univcan.ca/about-universities-canada/our-members/';
const CA_ENV = 'FINDER_CA_REGISTRY_URL';
const CA_SELECTOR_ENV = 'FINDER_CA_REGISTRY_SELECTOR';

/** Keywords that mark an anchor as an institution rather than site chrome. */
const INSTITUTION_KEYWORDS = [
  'universit', // university / université
  'college',
  'collège',
  'polytechni',
  'école',
  'institute',
];

/** Canada registry — Universities Canada member institutions (HTML list). */
export class CanadaProvider implements RegistryProvider {
  readonly country = 'Canada' as const;
  readonly sourceLabel = 'Universities Canada membership';

  async fetch(ctx: RegistryFetchContext): Promise<RegistryFetchResult> {
    const url = process.env[CA_ENV] ?? DEFAULT_CA_URL;
    const selector = process.env[CA_SELECTOR_ENV] ?? 'a[href]';
    ctx.logger.step('Canada: fetching Universities Canada member list…');

    const res = await ctx.fetcher.fetch({ url, timeoutMs: 90_000, maxTier: 'headless' });
    if (!res.ok) {
      throw new RegistryError(`Universities Canada page fetch failed (HTTP ${res.status})`, {
        hint: `set ${CA_ENV} to the current member-universities page`,
      });
    }

    const $ = cheerio.load(res.text());
    const pageHost = normalizeHost(url);
    const seen = new Set<string>();
    const institutions: RegistryInstitution[] = [];

    $(selector).each((_i, el) => {
      const name = cleanName($(el).text());
      if (!isInstitutionName(name)) return;
      const key = name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const href = $(el).attr('href') ?? '';
      // univcan member links point at internal profile pages — not the
      // university's own domain — so only keep an external host.
      const host = normalizeHost(href);
      const officialUrl = host.length > 0 && host !== pageHost ? canonicalUrl(href) : '';

      institutions.push({
        name,
        country: 'Canada',
        region: '',
        official_url: officialUrl,
        registry_source: 'Universities Canada',
        raw_id: null,
      });
    });

    if (institutions.length === 0) {
      throw new RegistryError('Universities Canada parse produced zero institutions', {
        hint: `the page structure may have changed — adjust ${CA_SELECTOR_ENV}`,
      });
    }

    const source: RegistrySource = {
      name: 'Universities Canada member list',
      url,
      fetched_at: new Date().toISOString(),
      row_count: institutions.length,
      tier: res.tierUsed,
      note: '',
    };

    return {
      institutions,
      sources: [source],
      filterApplied: 'Universities Canada member institutions',
      lowerConfidence: true,
    };
  }
}

function isInstitutionName(name: string): boolean {
  if (name.length < 4 || name.length > 120) return false;
  const lower = name.toLowerCase();
  return INSTITUTION_KEYWORDS.some((kw) => lower.includes(kw));
}
