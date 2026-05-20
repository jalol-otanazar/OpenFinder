import * as cheerio from 'cheerio';
import type { CountryCode, RegistryInstitution } from '../../core/types/registry.js';
import { canonicalUrl, cleanName, normalizeHost } from '../normalize.js';

export interface HtmlListOptions {
  country: CountryCode;
  registrySource: string;
  /** CSS selector picking the anchors that name institutions. Default `a[href]`. */
  selector?: string;
  /**
   * Substrings (lower-cased) that mark an anchor as an institution rather than
   * site chrome. An anchor's link text must contain at least one to be kept.
   */
  keywords: string[];
  /** Strict char-length bounds on link text — filters out chrome/navigation. */
  minLength?: number;
  maxLength?: number;
  /** Where the page lives — used to skip self-links when picking official_url. */
  pageUrl: string;
  /** Optional region label applied to every parsed row (e.g. "Flanders"). */
  region?: string;
}

/**
 * Generic "list of institutions on a single HTML page" parser — used by
 * registries with no machine-readable export. Returns deduped rows keyed by
 * lowercased name. Each row's `official_url` is set when the anchor points at
 * an external host (not the registry's own pages).
 */
export function parseHtmlList(html: string, opts: HtmlListOptions): RegistryInstitution[] {
  const $ = cheerio.load(html);
  const selector = opts.selector ?? 'a[href]';
  const pageHost = normalizeHost(opts.pageUrl);
  const seen = new Set<string>();
  const institutions: RegistryInstitution[] = [];
  const minLength = opts.minLength ?? 4;
  const maxLength = opts.maxLength ?? 140;

  $(selector).each((_i, el) => {
    const name = cleanName($(el).text());
    if (name.length < minLength || name.length > maxLength) return;
    const lower = name.toLowerCase();
    if (!opts.keywords.some((kw) => lower.includes(kw.toLowerCase()))) return;
    if (seen.has(lower)) return;
    seen.add(lower);

    const href = $(el).attr('href') ?? '';
    const host = normalizeHost(href);
    const officialUrl = host.length > 0 && host !== pageHost ? canonicalUrl(href) : '';

    institutions.push({
      name,
      country: opts.country,
      region: opts.region ?? '',
      official_url: officialUrl,
      registry_source: opts.registrySource,
      raw_id: null,
    });
  });

  return institutions;
}
