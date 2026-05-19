import type { AdapterFamily, ProviderId } from '../core/types/config.js';

/** Static description of a supported LLM provider. */
export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  family: AdapterFamily;
  /** Default API endpoint; null when the user must supply one. */
  defaultBaseUrl: string | null;
  /** True for local/custom providers — the wizard prompts for a base URL. */
  requiresBaseUrl: boolean;
  /** False for local runtimes that need no key. */
  requiresApiKey: boolean;
  /** Where to obtain a key — shown in the setup wizard. */
  signupUrl?: string;
  /** Whether the provider is commonly available on a free tier. */
  freeTier: boolean;
}

const DESCRIPTORS: Record<ProviderId, ProviderDescriptor> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    family: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    requiresBaseUrl: false,
    requiresApiKey: true,
    signupUrl: 'https://console.anthropic.com/',
    freeTier: false,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    family: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresBaseUrl: false,
    requiresApiKey: true,
    signupUrl: 'https://platform.openai.com/',
    freeTier: false,
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    family: 'google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    requiresBaseUrl: false,
    requiresApiKey: true,
    signupUrl: 'https://aistudio.google.com/apikey',
    freeTier: true,
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    family: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresBaseUrl: false,
    requiresApiKey: true,
    signupUrl: 'https://console.groq.com/keys',
    freeTier: true,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    family: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresBaseUrl: false,
    requiresApiKey: true,
    signupUrl: 'https://openrouter.ai/keys',
    freeTier: true,
  },
  together: {
    id: 'together',
    label: 'Together AI',
    family: 'openai-compatible',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    requiresBaseUrl: false,
    requiresApiKey: true,
    signupUrl: 'https://api.together.xyz/settings/api-keys',
    freeTier: true,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    family: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:11434/v1',
    requiresBaseUrl: true,
    requiresApiKey: false,
    freeTier: true,
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    family: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:1234/v1',
    requiresBaseUrl: true,
    requiresApiKey: false,
    freeTier: true,
  },
  custom: {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    family: 'openai-compatible',
    defaultBaseUrl: null,
    requiresBaseUrl: true,
    requiresApiKey: true,
    freeTier: false,
  },
};

export function getProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return DESCRIPTORS[id];
}

export function allProviderDescriptors(): ProviderDescriptor[] {
  return Object.values(DESCRIPTORS);
}
