import {createGemini} from './gemini';
import {createClaude, ModelError, type AskModel} from './model';
import {createChatGpt} from './openai';

export const providerIds = ['claude', 'chatgpt', 'gemini'] as const;
export type ProviderId = (typeof providerIds)[number];

export type ProviderInfo = {id: ProviderId; label: string; keyVar: string; available: boolean};

const providers: Record<ProviderId, {label: string; keyVar: string; create: () => AskModel}> = {
  claude: {label: 'Claude', keyVar: 'ANTHROPIC_API_KEY', create: createClaude},
  chatgpt: {label: 'ChatGPT', keyVar: 'OPENAI_API_KEY', create: createChatGpt},
  gemini: {label: 'Gemini', keyVar: 'GEMINI_API_KEY', create: createGemini},
};

export const listProviders = (): ProviderInfo[] =>
  providerIds.map(id => ({id, label: providers[id].label, keyVar: providers[id].keyVar, available: Boolean(process.env[providers[id].keyVar])}));

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (providerIds as readonly string[]).includes(value);
}

export function createProvider(id: ProviderId): AskModel {
  const {label, keyVar, create} = providers[id];
  if (!process.env[keyVar]) {
    throw new ModelError(`${label} isn't set up. Add ${keyVar} to .env.local and restart the dev server.`);
  }

  return create();
}
