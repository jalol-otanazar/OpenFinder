import type { ProviderProfile } from '../core/types/config.js';
import type { ModelInfo } from './adapter.js';
import { LlmError } from './adapter.js';
import { createAdapter } from './providers/index.js';

export interface ValidationResult {
  ok: boolean;
  models: ModelInfo[];
  error?: string;
}

/**
 * Validate a profile against its live provider by listing models. A successful
 * call confirms the key, the base URL, and connectivity in one step — and the
 * returned list seeds the model picker.
 */
export async function validateProfile(profile: ProviderProfile): Promise<ValidationResult> {
  try {
    const adapter = createAdapter(profile);
    const models = await adapter.listModels();
    return { ok: true, models };
  } catch (err) {
    return { ok: false, models: [], error: describeError(err) };
  }
}

function describeError(err: unknown): string {
  if (err instanceof LlmError) {
    switch (err.kind) {
      case 'auth':
        return 'the API key was rejected (HTTP 401/403) — check the key';
      case 'rate-limit':
        return 'the provider is rate-limiting (HTTP 429) — the key works but is busy; try again shortly';
      case 'network':
        return `could not reach the provider — ${err.message}`;
      case 'server':
        return 'the provider returned a server error (HTTP 5xx) — try again shortly';
      case 'bad-request':
        return `the provider rejected the request — ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
