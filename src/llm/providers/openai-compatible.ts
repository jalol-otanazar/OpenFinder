import type { CompletionRequest, CompletionResult, LlmAdapter, ModelInfo } from '../adapter.js';
import { LlmError } from '../adapter.js';
import { llmRequest } from './http.js';

export interface OpenAiCompatibleOptions {
  /** Base URL including the API version segment, e.g. `https://api.groq.com/openai/v1`. */
  baseUrl: string;
  /** May be empty for local runtimes (Ollama, LM Studio). */
  apiKey: string;
}

/**
 * Adapter for the OpenAI chat-completions protocol. One implementation covers
 * OpenAI, Groq, OpenRouter, Together, Ollama, LM Studio, and any custom
 * OpenAI-compatible endpoint.
 */
export class OpenAiCompatibleAdapter implements LlmAdapter {
  readonly family = 'openai-compatible' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: OpenAiCompatibleOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey.length > 0) h['authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    if (req.temperature !== undefined) body['temperature'] = req.temperature;

    const json = (await llmRequest(
      'POST',
      `${this.baseUrl}/chat/completions`,
      this.headers(),
      body,
    )) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const choice = json.choices?.[0];
    if (!choice?.message) {
      throw new LlmError('bad-request', 'OpenAI-compatible response had no choices');
    }
    const result: CompletionResult = { text: choice.message.content ?? '', model: req.model };
    if (choice.finish_reason) result.finishReason = choice.finish_reason;
    return result;
  }

  async listModels(): Promise<ModelInfo[]> {
    const json = (await llmRequest('GET', `${this.baseUrl}/models`, this.headers())) as {
      data?: Array<{ id?: string }>;
    };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => ({ id }));
  }
}
