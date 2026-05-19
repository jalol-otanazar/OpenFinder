import * as cheerio from 'cheerio';
import { logger } from '../core/logger.js';
import type { Fetcher } from './fetcher.js';

/**
 * Bundled web-search client (architecture component 10). A seam, like the
 * Fetcher tiers: the `catalog` worker supplements official-site fetching with a
 * search query. The shipped `HttpSearchClient` uses a free, no-key endpoint and
 * is **best-effort** — any failure degrades to zero results, never an error, so
 * the worker simply falls back to official-site-only. A keyed search client can
 * later implement the same interface with no caller change.
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  /** Cap on returned results. Default 8. */
  maxResults?: number;
}

export interface SearchClient {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

/** No-key default endpoint; overridable for tests / a different free source. */
const DEFAULT_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const SEARCH_URL_ENV = 'FINDER_SEARCH_URL';
const DEFAULT_MAX_RESULTS = 8;

/** HTML-scraping search client over a free no-key endpoint. */
export class HttpSearchClient implements SearchClient {
  private readonly fetcher: Fetcher;
  private readonly endpoint: string;

  constructor(fetcher: Fetcher, endpoint?: string) {
    this.fetcher = fetcher;
    this.endpoint = endpoint ?? process.env[SEARCH_URL_ENV] ?? DEFAULT_SEARCH_URL;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    const url = `${this.endpoint}?q=${encodeURIComponent(query)}`;

    let html: string;
    try {
      const res = await this.fetcher.fetch({ url, timeoutMs: 20_000 });
      if (!res.ok) {
        logger.debug(`search: "${query}" → HTTP ${res.status}; degrading to no results`);
        return [];
      }
      html = res.text();
    } catch (err) {
      logger.debug(`search: "${query}" failed (${describe(err)}); degrading to no results`);
      return [];
    }

    try {
      return parseResults(html, maxResults);
    } catch (err) {
      logger.debug(`search: could not parse results for "${query}" (${describe(err)})`);
      return [];
    }
  }
}

/** Parse a DuckDuckGo-HTML-style results page into clean result rows. */
function parseResults(html: string, maxResults: number): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $('.result').each((_i, el) => {
    if (results.length >= maxResults) return false;
    const node = $(el);
    if (node.hasClass('result--ad') || node.hasClass('result--no-result')) return undefined;

    const anchor = node.find('a.result__a').first();
    const url = unwrapResultUrl(anchor.attr('href') ?? '');
    if (url.length === 0) return undefined;

    results.push({
      title: collapse(anchor.text()),
      url,
      snippet: collapse(node.find('.result__snippet').first().text()),
    });
    return undefined;
  });

  return results;
}

/**
 * Resolve a result link to its real destination. The HTML endpoint wraps every
 * hit in a redirect (`//duckduckgo.com/l/?uddg=<encoded-url>`); a direct
 * `http(s)` href is returned as-is. Anything else yields ''.
 */
function unwrapResultUrl(href: string): string {
  if (href.length === 0) return '';
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  try {
    const parsed = new URL(absolute, 'https://duckduckgo.com');
    const wrapped = parsed.searchParams.get('uddg');
    if (wrapped) return wrapped;
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
