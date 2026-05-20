import { RegistryError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { FetchRequest, FetchResult, Fetcher } from './fetcher.js';

/**
 * Minimal structural typing for the parts of the Playwright API we use. We
 * type-only-shim it so `tsc` doesn't require `playwright` to be installed —
 * it's an optionalDependency, loaded at runtime via dynamic import.
 */
interface PlaywrightBrowser {
  newContext(options: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
}
interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}
interface PlaywrightPage {
  goto(url: string, opts: Record<string, unknown>): Promise<PlaywrightResponse | null>;
  content(): Promise<string>;
  close(): Promise<void>;
}
interface PlaywrightResponse {
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
}
interface PlaywrightModule {
  chromium: {
    launch(opts: { headless: boolean }): Promise<PlaywrightBrowser>;
  };
}

/**
 * Real-browser fetch tier — used when a source bot-blocks plain HTTP (HESA
 * Cloudflare wall, Universities Canada 403, several Asian/European registries
 * that gate on JavaScript). Lazy-imports `playwright` so installs that never
 * touch this tier carry no Chromium download.
 *
 * Lifecycle: one Chromium instance per process, launched on first request,
 * reused across requests, closed via {@link HeadlessFetcher.dispose}. Pages
 * are created and disposed per request — concurrency is not attempted in v1.
 */
export class HeadlessFetcher implements Fetcher {
  private browserPromise: Promise<PlaywrightBrowser> | null = null;
  private playwright: PlaywrightModule | null = null;

  async fetch(req: FetchRequest): Promise<FetchResult> {
    const browser = await this.ensureBrowser();
    const timeoutMs = req.timeoutMs ?? 60_000;

    const context = await browser.newContext({
      userAgent: req.headers?.['user-agent'] ?? DEFAULT_UA,
      extraHTTPHeaders: stripUaHeader(req.headers),
      locale: 'en-US',
    });
    const page = await context.newPage();
    try {
      const response = await page.goto(req.url, {
        waitUntil: 'networkidle',
        timeout: timeoutMs,
      });
      const status = response?.status() ?? 0;
      // For HTML JS-challenge pages the final rendered HTML is what we want;
      // for JSON/CSV endpoints, prefer the raw response body so we don't get
      // <html><body><pre>{json}</pre></body></html> wrapping.
      const contentType = response?.headers()['content-type'] ?? '';
      const body =
        response && isMachineReadable(contentType) ? await response.text() : await page.content();
      const bytes = Buffer.from(body, 'utf-8');
      return {
        url: req.url,
        status,
        ok: status >= 200 && status < 300,
        tierUsed: 'headless',
        contentType,
        bytes,
        text: () => bytes.toString('utf-8'),
      };
    } finally {
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    if (this.browserPromise) {
      try {
        const browser = await this.browserPromise;
        await browser.close();
      } catch (err) {
        logger.debug(`headless fetcher dispose: ${describe(err)}`);
      }
      this.browserPromise = null;
    }
  }

  private async ensurePlaywright(): Promise<PlaywrightModule> {
    if (this.playwright) return this.playwright;
    try {
      // Dynamic specifier so tsc's module resolver does not require playwright
      // to be installed at build time (it's an optionalDependency).
      const specifier = 'playwright';
      const mod = (await import(specifier)) as PlaywrightModule;
      this.playwright = mod;
      return mod;
    } catch (err) {
      throw new RegistryError('headless fetch tier requires the optional `playwright` package', {
        hint: 'install with: npm install playwright && npx playwright install chromium',
        cause: err,
      });
    }
  }

  private async ensureBrowser(): Promise<PlaywrightBrowser> {
    if (!this.browserPromise) {
      const pw = await this.ensurePlaywright();
      logger.debug('launching headless Chromium for blocked registry fetch');
      this.browserPromise = pw.chromium.launch({ headless: true });
    }
    return this.browserPromise;
  }
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function stripUaHeader(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'user-agent') continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function isMachineReadable(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.includes('json') ||
    ct.includes('csv') ||
    ct.includes('xml') ||
    ct.includes('text/plain')
  );
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
