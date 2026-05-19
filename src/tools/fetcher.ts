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
const USER_AGENT = 'FInder/0.1 (+https://github.com/finder; graduate-program advisor)';

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
        headers: { 'user-agent': USER_AGENT, ...req.headers },
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
