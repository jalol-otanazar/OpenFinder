import { LlmError, classifyHttpStatus } from '../adapter.js';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Shared JSON request helper for the LLM adapters. Maps every failure mode onto
 * a typed {@link LlmError} so the routed client can decide failover.
 */
export async function llmRequest(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const init: RequestInit = { method, headers, signal: controller.signal };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new LlmError('network', `network error calling ${url}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new LlmError(
      classifyHttpStatus(res.status),
      `HTTP ${res.status} from ${url}: ${truncate(text)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LlmError('bad-request', `non-JSON response from ${url}`);
  }
}

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}
