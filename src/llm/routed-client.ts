import { BlockingError, ConfigError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { FinderConfig, RoleId } from '../core/types/config.js';
import type { CompletionRequest, CompletionResult } from './adapter.js';
import { LlmError } from './adapter.js';
import { type AdapterFactory, createAdapter } from './providers/index.js';

/** Server/network retries on a single chain entry before failing over. */
const SAME_ENTRY_RETRIES = 2;

/**
 * Resolves a pipeline role to its failover chain and executes completions with
 * automatic failover. When a free key hits its rate limit (429) or its key is
 * rejected (401/403), the next chain entry takes over — the run continues
 * non-stop. When the whole chain is exhausted it raises a {@link BlockingError};
 * because runs are resumable, the user adds a key and resumes with no lost work.
 *
 * Same-provider vs cross-provider failover is just whether the chain's entries
 * reference one profile or several — there is no mode switch.
 */
export class RoutedLlmClient {
  constructor(
    private readonly config: FinderConfig,
    private readonly adapterFactory: AdapterFactory = createAdapter,
  ) {}

  async complete(role: RoleId, req: Omit<CompletionRequest, 'model'>): Promise<CompletionResult> {
    const chain = this.config.roles[role];
    if (chain.length === 0) {
      throw new ConfigError(`no model chain configured for role "${role}"`, {
        hint: 'run `finder setup` to pick a model for this role',
      });
    }

    const failures: string[] = [];

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i]!;
      const profile = this.config.profiles[entry.profile];
      if (!profile) {
        throw new ConfigError(
          `role "${role}" chain entry ${i + 1} references unknown profile "${entry.profile}"`,
          { hint: 'fix it with `finder config` or re-run `finder setup`' },
        );
      }

      const adapter = this.adapterFactory(profile);
      const label = `${entry.profile} (${entry.model})`;

      for (let attempt = 1; attempt <= 1 + SAME_ENTRY_RETRIES; attempt++) {
        try {
          const result = await adapter.complete({ ...req, model: entry.model });
          logger.debug(`llm: role=${role} served by ${label}`);
          return result;
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;

          // A request bug — not a credential problem. Do not fail over.
          if (err.kind === 'bad-request') {
            throw new FinderRequestError(`LLM request rejected by ${label}: ${err.message}`);
          }

          // Transient — retry the same entry before failing over.
          if ((err.kind === 'server' || err.kind === 'network') && attempt <= SAME_ENTRY_RETRIES) {
            logger.debug(`llm: ${label} ${err.kind} error, retry ${attempt}/${SAME_ENTRY_RETRIES}`);
            await backoff(attempt);
            continue;
          }

          // rate-limit / auth, or transient retries exhausted — fail over.
          failures.push(`${label}: ${err.kind}`);
          if (err.kind === 'rate-limit') {
            logger.warn(`${label} is rate-limited — failing over to the next provider`);
          } else if (err.kind === 'auth') {
            logger.warn(`${label} rejected its API key — failing over to the next provider`);
          } else {
            logger.warn(`${label} unreachable (${err.kind}) — failing over to the next provider`);
          }
          break;
        }
      }
    }

    throw new BlockingError(
      `every provider in the "${role}" failover chain is exhausted (${failures.join('; ')})`,
      {
        hint: 'add another provider with `finder setup`, then resume the run — completed work is preserved',
      },
    );
  }
}

/** A non-failover LLM failure (malformed request). */
export class FinderRequestError extends BlockingError {}

function backoff(attempt: number): Promise<void> {
  const ms = 500 * 2 ** (attempt - 1);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
