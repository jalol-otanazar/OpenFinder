import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * OS user-config directory for FInder. The API-key config file lives here —
 * never in the repo, never in run artifacts. `FINDER_CONFIG_DIR` overrides it
 * (used by tests and scripted setups).
 */
export function configDir(): string {
  const override = process.env.FINDER_CONFIG_DIR;
  if (override && override.length > 0) return override;

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'finder');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'finder');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), '.config'), 'finder');
}

export function configFilePath(): string {
  return join(configDir(), 'config.json');
}
