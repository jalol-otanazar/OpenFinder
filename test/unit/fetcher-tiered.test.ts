import { describe, expect, it, vi } from 'vitest';
import type { FetchRequest, FetchResult, Fetcher } from '../../src/tools/fetcher.js';
import { TieredFetcher } from '../../src/tools/fetcher.js';

/**
 * Stub HTTP fetcher returning a predetermined result. The harness here exercises
 * `TieredFetcher`'s escalation logic without launching a real headless browser:
 * the escalation path is intercepted by replacing the lazy headless instance.
 */
class StubHttpFetcher implements Fetcher {
  constructor(private readonly responses: Record<string, FetchResult | Error>) {}

  fetch(req: FetchRequest): Promise<FetchResult> {
    const value = this.responses[req.url];
    if (!value) {
      return Promise.reject(new Error(`StubHttpFetcher: no route for ${req.url}`));
    }
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value);
  }
}

class FakeHeadlessFetcher {
  constructor(private readonly body: string) {}
  fetch(req: FetchRequest): Promise<FetchResult> {
    const bytes = Buffer.from(this.body, 'utf-8');
    return Promise.resolve({
      url: req.url,
      status: 200,
      ok: true,
      tierUsed: 'headless',
      contentType: 'text/html',
      bytes,
      text: () => bytes.toString('utf-8'),
    });
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

function httpOk(url: string, body: string): FetchResult {
  const bytes = Buffer.from(body, 'utf-8');
  return {
    url,
    status: 200,
    ok: true,
    tierUsed: 'http',
    contentType: 'text/html',
    bytes,
    text: () => bytes.toString('utf-8'),
  };
}

function http(url: string, status: number, body = ''): FetchResult {
  const bytes = Buffer.from(body, 'utf-8');
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    tierUsed: 'http',
    contentType: 'text/html',
    bytes,
    text: () => bytes.toString('utf-8'),
  };
}

describe('TieredFetcher', () => {
  it('never escalates when maxTier is the default (http)', async () => {
    const http = new StubHttpFetcher({ 'https://x/': httpOk('https://x/', 'ok') });
    const tiered = new TieredFetcher(http);
    const ensureHeadless = vi.spyOn(
      tiered as unknown as { ensureHeadless: () => Promise<unknown> },
      'ensureHeadless',
    );
    const res = await tiered.fetch({ url: 'https://x/' });
    expect(res.tierUsed).toBe('http');
    expect(ensureHeadless).not.toHaveBeenCalled();
  });

  it('escalates to headless on HTTP 403 when maxTier=headless', async () => {
    const httpStub = new StubHttpFetcher({ 'https://x/': http('https://x/', 403) });
    const tiered = new TieredFetcher(httpStub);
    // Inject a fake headless without touching the dynamic import.
    (tiered as unknown as { headless: FakeHeadlessFetcher }).headless = new FakeHeadlessFetcher(
      '<html>real body</html>',
    );
    const res = await tiered.fetch({ url: 'https://x/', maxTier: 'headless' });
    expect(res.tierUsed).toBe('headless');
    expect(res.text()).toContain('real body');
  });

  it('escalates to headless on a Cloudflare challenge body', async () => {
    const challenge =
      '<html><head><title>Just a moment...</title></head><body>cf_chl_opt = {};</body></html>';
    const httpStub = new StubHttpFetcher({ 'https://x/': http('https://x/', 200, challenge) });
    const tiered = new TieredFetcher(httpStub);
    (tiered as unknown as { headless: FakeHeadlessFetcher }).headless = new FakeHeadlessFetcher(
      '<html>real</html>',
    );
    const res = await tiered.fetch({ url: 'https://x/', maxTier: 'headless' });
    expect(res.tierUsed).toBe('headless');
  });

  it('falls back to the HTTP response when headless also fails', async () => {
    const httpStub = new StubHttpFetcher({
      'https://x/': http('https://x/', 503, 'service unavailable'),
    });
    const tiered = new TieredFetcher(httpStub);
    (tiered as unknown as { headless: { fetch: () => Promise<FetchResult> } }).headless = {
      fetch: () => Promise.reject(new Error('playwright not installed')),
    };
    const res = await tiered.fetch({ url: 'https://x/', maxTier: 'headless' });
    expect(res.status).toBe(503);
    expect(res.tierUsed).toBe('http');
  });
});
