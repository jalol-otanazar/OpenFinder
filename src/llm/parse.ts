import type { RoleId } from '../core/types/config.js';
import type { CompletionRequest, CompletionResult } from './adapter.js';

/**
 * The narrow slice of {@link RoutedLlmClient} a worker needs. Depending on this
 * interface (not the concrete client) keeps workers stub-testable offline.
 */
export interface LlmComplete {
  complete(role: RoleId, req: Omit<CompletionRequest, 'model'>): Promise<CompletionResult>;
}

/** Tolerant JSON-array extraction — handles models that wrap output in prose. */
export function parseJsonArray(text: string): unknown[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Tolerant JSON-object extraction — the object counterpart of parseJsonArray. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** A trimmed non-empty string, or null — for coercing loose LLM JSON fields. */
export function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A positive integer, or null — accepts a number or a numeric string. */
export function asPositiveInt(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A clean string[] from a loose LLM value — non-strings and blanks dropped. */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = asString(item);
    if (s) out.push(s);
  }
  return out;
}

/** Cap a string at `limit` characters, appending an ellipsis when truncated. */
export function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
