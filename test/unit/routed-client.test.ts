import { describe, expect, it } from 'vitest';
import { BlockingError, ConfigError } from '../../src/core/errors.js';
import type { FinderConfig, ProviderProfile } from '../../src/core/types/config.js';
import type { LlmAdapter } from '../../src/llm/adapter.js';
import { LlmError } from '../../src/llm/adapter.js';
import { RoutedLlmClient } from '../../src/llm/routed-client.js';

function configWith(workerChain: Array<{ profile: string; model: string }>): FinderConfig {
  return {
    schema_version: '1.0',
    profiles: {
      p1: { provider: 'groq', label: 'P1', api_key: 'k1', base_url: null },
      p2: { provider: 'groq', label: 'P2', api_key: 'k2', base_url: null },
    },
    roles: { orchestrator: [], worker: workerChain },
  };
}

/** Adapter that rate-limits one key and succeeds for the rest. */
function factoryFailing(failKey: string) {
  return (profile: ProviderProfile): LlmAdapter => ({
    family: 'openai-compatible',
    async complete(req) {
      if (profile.api_key === failKey) {
        throw new LlmError('rate-limit', 'HTTP 429', 429);
      }
      return { text: `served by ${profile.api_key}`, model: req.model };
    },
    async listModels() {
      return [];
    },
  });
}

describe('RoutedLlmClient failover', () => {
  it('fails over to the next chain entry when the primary is rate-limited', async () => {
    const config = configWith([
      { profile: 'p1', model: 'm1' },
      { profile: 'p2', model: 'm2' },
    ]);
    const client = new RoutedLlmClient(config, factoryFailing('k1'));

    const result = await client.complete('worker', { messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('served by k2');
  });

  it('raises a BlockingError when the whole chain is exhausted', async () => {
    const config = configWith([
      { profile: 'p1', model: 'm1' },
      { profile: 'p2', model: 'm2' },
    ]);
    // both keys rate-limited
    const factory = (_profile: ProviderProfile): LlmAdapter => ({
      family: 'openai-compatible',
      async complete() {
        throw new LlmError('rate-limit', 'HTTP 429', 429);
      },
      async listModels() {
        return [];
      },
    });
    const client = new RoutedLlmClient(config, factory);
    await expect(
      client.complete('worker', { messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(BlockingError);
  });

  it('raises a ConfigError when a role has no chain', async () => {
    const client = new RoutedLlmClient(configWith([]), factoryFailing('none'));
    await expect(
      client.complete('worker', { messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});
