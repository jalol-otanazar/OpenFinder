import type { FetchRequest, FetchResult, Fetcher } from '../../src/tools/fetcher.js';

export interface StubRoute {
  body: string | Buffer;
  status?: number;
  contentType?: string;
}

/**
 * In-memory Fetcher for offline tests — maps exact URLs to canned payloads.
 * An unrouted URL throws, simulating a network failure (exercises degraded
 * paths such as the UK union's `Promise.allSettled`).
 */
export class StubFetcher implements Fetcher {
  constructor(private readonly routes: Record<string, StubRoute>) {}

  fetch(req: FetchRequest): Promise<FetchResult> {
    const route = this.routes[req.url];
    if (!route) {
      return Promise.reject(new Error(`StubFetcher: no route for ${req.url}`));
    }
    const status = route.status ?? 200;
    const bytes = Buffer.isBuffer(route.body) ? route.body : Buffer.from(route.body, 'utf-8');
    return Promise.resolve({
      url: req.url,
      status,
      ok: status >= 200 && status < 300,
      tierUsed: 'http',
      contentType: route.contentType ?? '',
      bytes,
      text: () => bytes.toString('utf-8'),
    });
  }
}
