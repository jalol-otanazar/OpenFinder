import type { CompletionRequest, CompletionResult, LlmAdapter, ModelInfo } from '../adapter.js';
import { LlmError } from '../adapter.js';
import { llmRequest } from './http.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicOptions {
  baseUrl: string;
  apiKey: string;
}

/** Adapter for the Anthropic Messages API. */
export class AnthropicAdapter implements LlmAdapter {
  readonly family = 'anthropic' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: AnthropicOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Anthropic carries system prompts in a top-level field, not the message list.
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
    };
    if (system.length > 0) body['system'] = system;
    if (req.temperature !== undefined) body['temperature'] = req.temperature;

    const json = (await llmRequest(
      'POST',
      `${this.baseUrl}/v1/messages`,
      this.headers(),
      body,
    )) as {
      content?: Array<{ type?: string; text?: string }>;
      stop_reason?: string;
    };
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const result: CompletionResult = { text, model: req.model };
    if (json.stop_reason) result.finishReason = json.stop_reason;
    return result;
  }

  async listModels(): Promise<ModelInfo[]> {
    const json = (await llmRequest('GET', `${this.baseUrl}/v1/models`, this.headers())) as {
      data?: Array<{ id?: string }>;
    };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string');
    if (models.length === 0) {
      throw new LlmError('bad-request', 'Anthropic model list was empty');
    }
    return models.map((id) => ({ id }));
  }
}
