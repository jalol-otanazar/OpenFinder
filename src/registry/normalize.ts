import { slug } from '../core/ids.js';

/** Collapse whitespace and trim — the display form stored on a universe row. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * Accent-folded, punctuation-free key for matching two registry rows that name
 * the same institution. Built on the same slug used for ids, so name-based
 * dedupe and id generation never disagree.
 */
export function canonicalNameKey(name: string): string {
  return slug(name);
}

/** Bare hostname (lower-case, no `www.`) — a strong dedupe key. '' if unparseable. */
export function normalizeHost(rawUrl: string): string {
  const url = canonicalUrl(rawUrl);
  if (url === '') return '';
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * A canonical `https://host` URL for storage. Registries publish URLs in many
 * shapes (bare domain, http, trailing paths); this reduces them to a trusted
 * root. Returns '' when the input cannot be parsed.
 */
export function canonicalUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.length > 0 ? `https://${host}` : '';
  } catch {
    return '';
  }
}
