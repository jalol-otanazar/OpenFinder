import * as cheerio from 'cheerio';

/** A resolved on-page link — used by workers to choose which pages to fetch. */
export interface PageLink {
  text: string;
  url: string;
}

/** Strip an HTML document to collapsed visible text. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const body = $('body');
  const text = body.length > 0 ? body.text() : $.root().text();
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Collect on-page links, resolved to absolute http(s) URLs, deduplicated, and
 * capped at `limit`. Link text is collapsed and trimmed to 120 chars.
 */
export function extractLinks(html: string, baseUrl: string, limit: number): PageLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: PageLink[] = [];
  for (const el of $('a[href]').toArray()) {
    if (links.length >= limit) break;
    const href = $(el).attr('href') ?? '';
    let resolved: string;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      url.hash = '';
      resolved = url.toString();
    } catch {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    links.push({ text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120), url: resolved });
  }
  return links;
}
