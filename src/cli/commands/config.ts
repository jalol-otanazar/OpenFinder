import type { Command } from 'commander';
import { FileConfigStore } from '../../config/config-store.js';
import { maskSecret } from '../../config/redact.js';
import { ConfigError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import type { FinderConfig, RoleId } from '../../core/types/config.js';

const ROLES: RoleId[] = ['orchestrator', 'worker'];

export function registerConfigCommand(program: Command): void {
  const config = program.command('config').description('Inspect and manage provider profiles.');

  config
    .command('list')
    .description('List configured profiles and role chains.')
    .action(async () => {
      printConfig(await new FileConfigStore().load(), false);
    });

  config
    .command('show')
    .description('Show full config detail (secrets masked).')
    .action(async () => {
      const store = new FileConfigStore();
      logger.info(`Config file: ${store.path()}\n`);
      printConfig(await store.load(), true);
    });

  config
    .command('path')
    .description('Print the config file path.')
    .action(() => {
      logger.print(new FileConfigStore().path());
    });

  config
    .command('use <profile>')
    .description('Promote a profile to primary in a role chain.')
    .option('--role <role>', 'limit to one role (orchestrator|worker)')
    .action(async (profileName: string, opts: { role?: string }) => {
      await useProfile(profileName, opts.role);
    });

  config
    .command('remove <profile>')
    .description('Delete a profile and any chain entries that reference it.')
    .action(async (profileName: string) => {
      await removeProfile(profileName);
    });
}

function printConfig(config: FinderConfig, detailed: boolean): void {
  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    logger.info('No profiles configured. Run `finder setup` to add one.');
    return;
  }
  logger.info('Profiles:');
  for (const [name, profile] of Object.entries(config.profiles)) {
    logger.info(`  ${name}  [${profile.provider}]  ${profile.label}`);
    if (detailed) {
      logger.info(`      key:      ${maskSecret(profile.api_key)}`);
      logger.info(`      base_url: ${profile.base_url ?? '(provider default)'}`);
    }
  }
  logger.info('\nRole chains:');
  for (const role of ROLES) {
    const chain = config.roles[role];
    const rendered =
      chain.length > 0 ? chain.map((e) => `${e.profile}:${e.model}`).join('  →  ') : '(none)';
    logger.info(`  ${role}: ${rendered}`);
  }
}

async function useProfile(profileName: string, roleArg: string | undefined): Promise<void> {
  const store = new FileConfigStore();
  const config = await store.load();
  if (!config.profiles[profileName]) {
    throw new ConfigError(`no profile named "${profileName}"`, {
      hint: 'run `finder config list` to see profiles',
    });
  }
  const roles = roleArg ? [parseRole(roleArg)] : ROLES;

  let promoted = false;
  for (const role of roles) {
    const chain = config.roles[role];
    const idx = chain.findIndex((e) => e.profile === profileName);
    if (idx <= 0) continue; // not present, or already primary
    const [entry] = chain.splice(idx, 1);
    chain.unshift(entry!);
    promoted = true;
    logger.success(`"${profileName}" is now primary for role "${role}".`);
  }
  if (!promoted) {
    throw new ConfigError(
      `"${profileName}" is not a non-primary entry in any selected role chain`,
      { hint: 'run `finder setup` to add it to a role chain' },
    );
  }
  await store.save(config);
}

async function removeProfile(profileName: string): Promise<void> {
  const store = new FileConfigStore();
  const config = await store.load();
  if (!config.profiles[profileName]) {
    throw new ConfigError(`no profile named "${profileName}"`);
  }
  delete config.profiles[profileName];
  for (const role of ROLES) {
    const before = config.roles[role].length;
    config.roles[role] = config.roles[role].filter((e) => e.profile !== profileName);
    const removed = before - config.roles[role].length;
    if (removed > 0)
      logger.warn(`removed ${removed} "${role}" chain entry/entries using this profile`);
    if (before > 0 && config.roles[role].length === 0) {
      logger.warn(`role "${role}" now has no model chain — run \`finder setup\``);
    }
  }
  await store.save(config);
  logger.success(`Removed profile "${profileName}".`);
}

function parseRole(value: string): RoleId {
  if (value === 'orchestrator' || value === 'worker') return value;
  throw new ConfigError(`unknown role "${value}"`, { hint: 'use orchestrator or worker' });
}
