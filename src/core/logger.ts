/**
 * Minimal dependency-free logger. Diagnostics go to stderr so that real command
 * output on stdout stays clean and pipeable.
 */

const COLOR = process.stderr.isTTY && !process.env.NO_COLOR;

const paint = (code: string, text: string): string => (COLOR ? `[${code}m${text}[0m` : text);

const debugEnabled = (): boolean =>
  process.env.FINDER_DEBUG === '1' || process.env.FINDER_DEBUG === 'true';

export const logger = {
  info(message: string): void {
    process.stderr.write(`${message}\n`);
  },
  step(message: string): void {
    process.stderr.write(`${paint('36', '›')} ${message}\n`);
  },
  success(message: string): void {
    process.stderr.write(`${paint('32', '✓')} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${paint('33', 'warning')}: ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${paint('31', 'error')}: ${message}\n`);
  },
  hint(message: string): void {
    process.stderr.write(`${paint('2', `hint: ${message}`)}\n`);
  },
  debug(message: string): void {
    if (debugEnabled()) process.stderr.write(`${paint('2', `debug: ${message}`)}\n`);
  },
  /** Real command output — goes to stdout. */
  print(message: string): void {
    process.stdout.write(`${message}\n`);
  },
};

export type Logger = typeof logger;
