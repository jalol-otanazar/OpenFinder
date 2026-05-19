import type { RoleId } from '../../src/core/types/config.js';
import type { LlmComplete } from '../../src/llm/parse.js';
import type { CompletionRequest, CompletionResult } from '../../src/llm/adapter.js';
import type { SearchClient, SearchResult } from '../../src/tools/search.js';

/** Builds a canned completion from the system + user prompt of a worker call. */
export type LlmResponder = (system: string, user: string) => string;

/** Offline LlmComplete — routes a worker's plain-text calls to canned answers. */
export class StubLlm implements LlmComplete {
  public calls = 0;

  constructor(private readonly responder: LlmResponder) {}

  complete(_role: RoleId, req: Omit<CompletionRequest, 'model'>): Promise<CompletionResult> {
    this.calls += 1;
    const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
    const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
    return Promise.resolve({ text: this.responder(system, user), model: 'stub-model' });
  }
}

/** Offline SearchClient — returns a fixed result list (default: none). */
export class StubSearch implements SearchClient {
  constructor(private readonly results: SearchResult[] = []) {}

  search(): Promise<SearchResult[]> {
    return Promise.resolve(this.results);
  }
}
