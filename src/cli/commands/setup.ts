import { confirm, input, password, select } from '@inquirer/prompts';
import type { Command } from 'commander';
import { FileConfigStore } from '../../config/config-store.js';
import { maskSecret } from '../../config/redact.js';
import { slug } from '../../core/ids.js';
import { logger } from '../../core/logger.js';
import type {
  FinderConfig,
  ProviderProfile,
  RoleChainEntry,
  RoleId,
} from '../../core/types/config.js';
import { allProviderDescriptors, getProviderDescriptor } from '../../llm/provider-registry.js';
import { validateProfile } from '../../llm/validate.js';
import type { ModelInfo } from '../../llm/adapter.js';

const ROLES: RoleId[] = ['orchestrator', 'worker'];
const ROLE_HINT: Record<RoleId, string> = {
  orchestrator: 'plans batches and merges results — a fast, cheap model is fine',
  worker: 'does the heavy search and reasoning — prefer a capable model',
};

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Configure an LLM provider, API key, and model selection.')
    .action(runSetup);
}

async function runSetup(): Promise<void> {
  const store = new FileConfigStore();
  const config = await store.load();

  logger.info('FInder setup — add a provider profile and assign models to pipeline roles.');
  logger.info(`Config file: ${store.path()}\n`);

  const descriptorChoices = allProviderDescriptors().map((d) => ({
    name: d.freeTier ? `${d.label}  (free tier available)` : d.label,
    value: d.id,
  }));
  const providerId = await select({
    message: 'Choose an LLM provider',
    choices: descriptorChoices,
  });
  const descriptor = getProviderDescriptor(providerId);
  if (descriptor.signupUrl) logger.info(`Get a key at: ${descriptor.signupUrl}`);

  let baseUrl: string | null = null;
  if (descriptor.requiresBaseUrl) {
    const entered = await input({
      message: 'Base URL',
      default: descriptor.defaultBaseUrl ?? '',
    });
    baseUrl = entered.trim();
  }

  let apiKey = '';
  let models: ModelInfo[] = [];
  for (;;) {
    apiKey = descriptor.requiresApiKey
      ? (await password({ message: 'API key', mask: true })).trim()
      : (await input({ message: 'API key (optional for local providers)', default: '' })).trim();

    const candidate: ProviderProfile = {
      provider: providerId,
      label: descriptor.label,
      api_key: apiKey,
      base_url: baseUrl,
    };
    logger.step('Validating credentials against the provider…');
    const result = await validateProfile(candidate);
    if (result.ok) {
      models = result.models;
      logger.success(`Validated — ${models.length} model(s) available.`);
      break;
    }
    logger.error(`Validation failed: ${result.error ?? 'unknown error'}`);
    const retry = await confirm({ message: 'Try entering the key again?', default: true });
    if (!retry) {
      logger.warn('Setup cancelled — no changes were saved.');
      return;
    }
  }

  const suggestedName = uniqueProfileName(config, providerId);
  let profileName = (
    await input({
      message: 'Name this profile',
      default: suggestedName,
      validate: (v) => (slug(v).length > 0 ? true : 'enter at least one alphanumeric character'),
    })
  ).trim();
  profileName = slug(profileName);
  if (config.profiles[profileName]) {
    const overwrite = await confirm({
      message: `Profile "${profileName}" already exists — overwrite it?`,
      default: false,
    });
    if (!overwrite) profileName = uniqueProfileName(config, providerId);
  }

  const label = (
    await input({ message: 'Short label for this profile', default: descriptor.label })
  ).trim();

  config.profiles[profileName] = {
    provider: providerId,
    label: label.length > 0 ? label : descriptor.label,
    api_key: apiKey,
    base_url: baseUrl,
  };

  for (const role of ROLES) {
    await assignRole(config, role, profileName, models);
  }

  await store.save(config);

  logger.success('\nSetup complete.');
  printSummary(config);
}

async function assignRole(
  config: FinderConfig,
  role: RoleId,
  profileName: string,
  models: ModelInfo[],
): Promise<void> {
  logger.info(`\nRole "${role}" — ${ROLE_HINT[role]}.`);
  const chain = config.roles[role];

  if (chain.length > 0) {
    const action = await select({
      message: `Role "${role}" already has a model chain. What should this profile do?`,
      choices: [
        { name: 'Make it the primary (current ones become fallbacks)', value: 'primary' },
        {
          name: 'Add it as a fallback (used when earlier ones are rate-limited)',
          value: 'fallback',
        },
        { name: 'Leave the chain unchanged', value: 'skip' },
      ] as const,
    });
    if (action === 'skip') return;
    const model = await pickModel(role, models);
    const entry: RoleChainEntry = { profile: profileName, model };
    if (action === 'primary') chain.unshift(entry);
    else chain.push(entry);
    return;
  }

  const model = await pickModel(role, models);
  config.roles[role] = [{ profile: profileName, model }];
}

async function pickModel(role: RoleId, models: ModelInfo[]): Promise<string> {
  if (models.length === 0) {
    return (await input({ message: `Model id for role "${role}"` })).trim();
  }
  return select({
    message: `Pick a model for role "${role}"`,
    choices: models.map((m) => ({ name: m.id, value: m.id })),
  });
}

function uniqueProfileName(config: FinderConfig, providerId: string): string {
  const base = providerId;
  if (!config.profiles[base]) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!config.profiles[candidate]) return candidate;
  }
}

function printSummary(config: FinderConfig): void {
  logger.info('\nProfiles:');
  for (const [name, profile] of Object.entries(config.profiles)) {
    logger.info(`  ${name}  [${profile.provider}]  key ${maskSecret(profile.api_key)}`);
  }
  logger.info('Role chains:');
  for (const role of ROLES) {
    const chain = config.roles[role];
    const rendered =
      chain.length > 0 ? chain.map((e) => `${e.profile}:${e.model}`).join('  →  ') : '(none)';
    logger.info(`  ${role}: ${rendered}`);
  }
}
