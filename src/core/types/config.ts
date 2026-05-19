import { z } from 'zod';

/** Known LLM providers a user can configure a profile for. */
export const ProviderIdSchema = z.enum([
  'anthropic',
  'openai',
  'google',
  'groq',
  'openrouter',
  'together',
  'ollama',
  'lmstudio',
  'custom',
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * Adapter family — the wire protocol. Most providers speak the OpenAI-compatible
 * protocol, so one adapter covers Groq / OpenRouter / Together / Ollama / LM Studio
 * / any custom base URL. Anthropic and Google have their own.
 */
export const AdapterFamilySchema = z.enum(['anthropic', 'google', 'openai-compatible']);
export type AdapterFamily = z.infer<typeof AdapterFamilySchema>;

/** Pipeline roles that select a model. */
export const RoleIdSchema = z.enum(['orchestrator', 'worker']);
export type RoleId = z.infer<typeof RoleIdSchema>;

/** One named, credentialed connection to a provider. */
export const ProviderProfileSchema = z.object({
  provider: ProviderIdSchema,
  /** Human label shown in `finder config list`. */
  label: z.string().min(1),
  /** Secret. Lives only in the OS user-config file — never in repo or run artifacts. */
  api_key: z.string(),
  /** Override endpoint — required for `custom`/local providers, else null. */
  base_url: z.string().nullable().default(null),
});
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

/** One link in a role's failover chain: which profile, which model. */
export const RoleChainEntrySchema = z.object({
  profile: z.string().min(1),
  model: z.string().min(1),
});
export type RoleChainEntry = z.infer<typeof RoleChainEntrySchema>;

/**
 * Per-role ordered failover chains. Entry 0 is primary; the rest are tried on
 * rate-limit / quota / auth failure. Same-provider vs cross-provider is simply
 * whether the chain entries reference one profile or several — no mode flag.
 */
export const RolesSchema = z
  .object({
    orchestrator: z.array(RoleChainEntrySchema).default([]),
    worker: z.array(RoleChainEntrySchema).default([]),
  })
  .default({ orchestrator: [], worker: [] });
export type Roles = z.infer<typeof RolesSchema>;

/** The whole `config.json` (OS user-config dir). */
export const FinderConfigSchema = z.object({
  schema_version: z.literal('1.0'),
  profiles: z.record(z.string(), ProviderProfileSchema).default({}),
  roles: RolesSchema,
});
export type FinderConfig = z.infer<typeof FinderConfigSchema>;

/** A fresh, empty config. */
export function emptyConfig(): FinderConfig {
  return {
    schema_version: '1.0',
    profiles: {},
    roles: { orchestrator: [], worker: [] },
  };
}
