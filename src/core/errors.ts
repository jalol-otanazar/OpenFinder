/**
 * Base error for all expected, user-facing failures. The CLI catches these,
 * prints `message` (+ optional `hint`), and exits non-zero — without a stack trace.
 * Anything that is NOT a FinderError is an unexpected bug and bubbles up raw.
 */
export class FinderError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, options: { hint?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.hint = options.hint;
  }
}

/**
 * A condition that halts the pipeline and must be surfaced to the user — never
 * worked around. The canonical case: a registry could not be fetched, which is
 * NOT permission to enumerate institutions from model memory (rules/01 §1.2).
 */
export class BlockingError extends FinderError {}

/** Configuration / credential problems (missing profile, malformed config). */
export class ConfigError extends FinderError {}

/** A registry source could not be fetched or parsed. */
export class RegistryError extends FinderError {}

/** On-disk state failed to load or validate against its schema. */
export class StateError extends FinderError {}
