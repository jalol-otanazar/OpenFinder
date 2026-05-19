import { select } from '@inquirer/prompts';
import type { Command } from 'commander';
import { FileConfigStore } from '../../config/config-store.js';
import { ConfigError } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import type { ProviderProfile } from '../../core/types/config.js';
import { validateProfile } from '../../llm/validate.js';

export function registerModelsCommand(program: Command): void {
  program
    .command('models')
    .description("List the models available for a profile's provider.")
    .option('--profile <name>', 'profile to query')
    .action(async (opts: { profile?: string }) => {
      await listModels(opts.profile);
    });
}

async function listModels(profileArg: string | undefined): Promise<void> {
  const config = await new FileConfigStore().load();
  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    throw new ConfigError('no profiles configured', { hint: 'run `finder setup` first' });
  }

  let profileName = profileArg;
  if (!profileName) {
    profileName =
      names.length === 1
        ? names[0]!
        : await select({
            message: 'Which profile?',
            choices: names.map((n) => ({ name: n, value: n })),
          });
  }

  const profile: ProviderProfile | undefined = config.profiles[profileName];
  if (!profile) {
    throw new ConfigError(`no profile named "${profileName}"`, {
      hint: 'run `finder config list` to see profiles',
    });
  }

  logger.step(`Querying ${profile.provider} for available models…`);
  const result = await validateProfile(profile);
  if (!result.ok) {
    throw new ConfigError(`could not list models: ${result.error ?? 'unknown error'}`);
  }
  logger.success(`${result.models.length} model(s) for profile "${profileName}":`);
  for (const model of result.models) logger.print(model.id);
}
