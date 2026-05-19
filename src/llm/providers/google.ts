import type { CompletionRequest, CompletionResult, LlmAdapter, ModelInfo } from '../adapter.js';
import { LlmError } from '../adapter.js';
import { llmRequest } from './http.js';

export interface GoogleOptions {
  baseUrl: string;
  apiKey: string;
}

/** Adapter for the Google Gemini (Generative Language) API. */
export class GoogleAdapter implements LlmAdapter {
  readonly family = 'google' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(opts: GoogleOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const system = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const generationConfig: Record<string, unknown> = {};
    if (req.maxTokens !== undefined) generationConfig['maxOutputTokens'] = req.maxTokens;
    if (req.temperature !== undefined) generationConfig['temperature'] = req.temperature;

    const body: Record<string, unknown> = { contents };
    if (system.length > 0) body['systemInstruction'] = { parts: [{ text: system }] };
    if (Object.keys(generationConfig).length > 0) body['generationConfig'] = generationConfig;

    const model = req.model.replace(/^models\//, '');
    const url = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const json = (await llmRequest('POST', url, { 'content-type': 'application/json' }, body)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    };
    const candidate = json.candidates?.[0];
    if (!candidate) {
      throw new LlmError('bad-request', 'Gemini response had no candidates');
    }
    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
    const result: CompletionResult = { text, model: req.model };
    if (candidate.finishReason) result.finishReason = candidate.finishReason;
    return result;
  }

  async listModels(): Promise<ModelInfo[]> {
    const url = `${this.baseUrl}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`;
    const json = (await llmRequest('GET', url, { 'content-type': 'application/json' })) as {
      models?: Array<{ name?: string }>;
    };
    return (json.models ?? [])
      .map((m) => m.name)
      .filter((name): name is string => typeof name === 'string')
      .map((name) => ({ id: name.replace(/^models\//, '') }));
  }
}
