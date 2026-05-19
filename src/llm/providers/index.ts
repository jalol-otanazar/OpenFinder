import { ConfigError } from '../../core/errors.js';
import type { ProviderProfile } from '../../core/types/config.js';
import type { LlmAdapter } from '../adapter.js';
import { getProviderDescriptor } from '../provider-registry.js';
import { AnthropicAdapter } from './anthropic.js';
import { GoogleAdapter } from './google.js';
import { OpenAiCompatibleAdapter } from './openai-compatible.js';

/** Construct the adapter for a configured profile. */
export function createAdapter(profile: ProviderProfile): LlmAdapter {
  const descriptor = getProviderDescriptor(profile.provider);
  const baseUrl = profile.base_url ?? descriptor.defaultBaseUrl;
  if (!baseUrl || baseUrl.length === 0) {
    throw new ConfigError(`profile "${profile.label}" has no base URL`, {
      hint: 'add one with `finder config` or re-run `finder setup`',
    });
  }
  switch (descriptor.family) {
    case 'anthropic':
      return new AnthropicAdapter({ baseUrl, apiKey: profile.api_key });
    case 'google':
      return new GoogleAdapter({ baseUrl, apiKey: profile.api_key });
    case 'openai-compatible':
      return new OpenAiCompatibleAdapter({ baseUrl, apiKey: profile.api_key });
  }
}

/** A factory the routed client uses — overridable in tests. */
export type AdapterFactory = (profile: ProviderProfile) => LlmAdapter;
