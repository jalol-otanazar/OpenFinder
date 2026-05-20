import type { HeadlessFetcher } from './fetcher-headless.js';
import { logger } from '../core/logger.js';

/**
 * Tiered fetch strategy (docs/architecture.md). Phase 1 ships only the `http`
 * tier; `headless` / `real-browser` are named here so providers can request a
 * tier and a later TieredFetcher slots in with zero provider changes.
 */
export type FetchTier = 'http' | 'headless' | 'real-browser';

export interface FetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  /** Highest tier the caller permits. Default `http`. */
  maxTier?: FetchTier;
  /** Per-request timeout. Default 30s. */
  timeoutMs?: number;
}

export interface FetchResult {
  url: string;
  status: number;
  ok: boolean;
  tierUsed: FetchTier;
  contentType: string;
  bytes: Buffer;
  /** Decode the body as UTF-8 text. */
  text(): string;
}

export interface Fetcher {
  fetch(req: FetchRequest): Promise<FetchResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/**
 * A mainstream desktop-browser User-Agent. Many government registry and
 * university sites reject the obvious bot UA with HTTP 403; a standard browser
 * UA + Accept headers gets past that first, crude tier of bot defence.
 * Override per request via `headers` when a source needs something specific.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_HEADERS: Record<string, string> = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

/** Plain-HTTP fetcher — tier 1 of the tiered strategy. */
export class HttpFetcher implements Fetcher {
  async fetch(req: FetchRequest): Promise<FetchResult> {
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const init: RequestInit = {
        method: req.method ?? 'GET',
        headers: { ...DEFAULT_HEADERS, ...req.headers },
        signal: controller.signal,
      };
      if (req.body !== undefined) init.body = req.body;
      try {
        const res = await fetch(req.url, init);
        const arrayBuf = await res.arrayBuffer();
        const bytes = Buffer.from(arrayBuf);

        // Retry transient server errors; surface client errors to the caller.
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          lastError = new Error(`HTTP ${res.status} from ${req.url}`);
          await backoff(attempt);
          continue;
        }

        return {
          url: req.url,
          status: res.status,
          ok: res.ok,
          tierUsed: 'http',
          contentType: res.headers.get('content-type') ?? '',
          bytes,
          text: () => bytes.toString('utf-8'),
        };
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          logger.debug(`fetch attempt ${attempt} failed for ${req.url}: ${describe(err)}`);
          await backoff(attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(
      `fetch failed for ${req.url} after ${MAX_RETRIES} attempts: ${describe(lastError)}`,
    );
  }
}

function backoff(attempt: number): Promise<void> {
  const ms = 500 * 2 ** (attempt - 1);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Composite fetcher that starts at the HTTP tier and escalates to the headless
 * tier on signals that a plain HTTP fetch was bot-blocked. Escalation only
 * happens when the caller permits it with `maxTier: 'headless'`.
 *
 * The headless implementation is lazy-loaded so a process that never escalates
 * never imports `playwright`.
 */
export class TieredFetcher implements Fetcher {
  private headless: HeadlessFetcher | null = null;

  constructor(private readonly http: Fetcher = new HttpFetcher()) {}

  async fetch(req: FetchRequest): Promise<FetchResult> {
    const tier = req.maxTier ?? 'http';
    if (tier === 'http') {
      return this.http.fetch(req);
    }

    let httpResult: FetchResult | null = null;
    let httpError: unknown;
    try {
      httpResult = await this.http.fetch(req);
      if (!shouldEscalate(httpResult)) return httpResult;
      logger.debug(
        `tiered-fetch: HTTP returned ${httpResult.status} for ${req.url} — escalating to headless`,
      );
    } catch (err) {
      httpError = err;
      logger.debug(`tiered-fetch: HTTP threw for ${req.url} — escalating to headless`);
    }

    try {
      const headless = await this.ensureHeadless();
      return await headless.fetch(req);
    } catch (err) {
      // Headless escalation failed too. If HTTP at least returned a response,
      // surface that — its body/status carries diagnostic value (e.g. the
      // Cloudflare "Just a moment..." page) and lets providers degrade.
      if (httpResult) return httpResult;
      throw err instanceof Error
        ? err
        : new Error(`fetch failed for ${req.url}: ${describe(httpError ?? err)}`);
    }
  }

  async dispose(): Promise<void> {
    if (this.headless) {
      await this.headless.dispose();
      this.headless = null;
    }
  }

  private async ensureHeadless(): Promise<HeadlessFetcher> {
    if (!this.headless) {
      const mod = await import('./fetcher-headless.js');
      this.headless = new mod.HeadlessFetcher();
    }
    return this.headless;
  }
}

/** The shared, lazily-headless fetcher used by registry providers. */
export function defaultTieredFetcher(): TieredFetcher {
  return new TieredFetcher();
}

/**
 * Heuristic for "this HTTP response was bot-blocked, the headless tier might
 * actually succeed." Conservative — false positives waste a browser launch
 * but never hide a working response.
 */
function shouldEscalate(res: FetchResult): boolean {
  if (res.status === 403 || res.status === 503 || res.status === 429) return true;
  if (res.status >= 200 && res.status < 300) {
    const sample = res.bytes.length > 0 ? res.bytes.subarray(0, 4096).toString('utf-8') : '';
    if (sample.length === 0) return true;
    if (looksLikeCloudflareChallenge(sample)) return true;
  }
  return false;
}

function looksLikeCloudflareChallenge(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('__cf_chl_jschl_tk__') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('cf_chl_opt') ||
    lower.includes('<title>just a moment') ||
    lower.includes('attention required! | cloudflare') ||
    lower.includes('checking your browser before accessing')
  );
}
