/**
 * Mask a secret for display. Never print a raw key — `finder config show` and
 * all logs route secrets through here.
 */
export function maskSecret(key: string): string {
  if (key.length === 0) return '(not set)';
  if (key.length <= 10) return '••••••';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
