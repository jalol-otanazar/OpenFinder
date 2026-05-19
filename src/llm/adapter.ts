import type { AdapterFamily } from '../core/types/config.js';

/** A single chat message. */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  model: string;
  finishReason?: string;
}

export interface ModelInfo {
  id: string;
}

/**
 * The LLM Adapter (architecture component 9). One implementation per wire
 * protocol — concrete adapters are vendor-agnostic behind this interface.
 * The `universe` skill never calls this: the institution list is fetched, not
 * recalled. It is first consumed by `catalog`.
 */
export interface LlmAdapter {
  readonly family: AdapterFamily;
  /** A single completion. Throws {@link LlmError} on any provider failure. */
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** Live model list — also doubles as a credential-validation probe. */
  listModels(): Promise<ModelInfo[]>;
}

/**
 * How an LLM call failed — drives the routed client's failover decision:
 * - `rate-limit` / `auth` → fail over to the next chain entry immediately.
 * - `server` / `network`  → retry on the same entry, then fail over.
 * - `bad-request`         → a request bug, not a credential problem; do not fail over.
 */
export type LlmErrorKind = 'rate-limit' | 'auth' | 'server' | 'bad-request' | 'network';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | undefined;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
  }
}

/** Map an HTTP status to an {@link LlmErrorKind}. */
export function classifyHttpStatus(status: number): LlmErrorKind {
  if (status === 429) return 'rate-limit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'bad-request';
}
