import { idbGet, idbSet } from '@/lib/idb';

export interface AiEndpointSettings {
  /** OpenAI-compatible API root, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_AI_SETTINGS: AiEndpointSettings = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export function normalizeAiSettings(
  raw: Partial<AiEndpointSettings> | null | undefined,
): AiEndpointSettings {
  const baseUrl = String(raw?.baseUrl ?? DEFAULT_AI_SETTINGS.baseUrl)
    .trim()
    .replace(/\/+$/, '');
  return {
    baseUrl: baseUrl || DEFAULT_AI_SETTINGS.baseUrl,
    apiKey: String(raw?.apiKey ?? ''),
    model: String(raw?.model ?? DEFAULT_AI_SETTINGS.model).trim() ||
      DEFAULT_AI_SETTINGS.model,
  };
}

export async function loadAiSettings(): Promise<AiEndpointSettings> {
  try {
    const stored = await idbGet<Partial<AiEndpointSettings>>('aiSettings');
    return normalizeAiSettings(stored);
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

export async function saveAiSettings(
  settings: AiEndpointSettings,
): Promise<void> {
  await idbSet('aiSettings', normalizeAiSettings(settings));
}

export function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return root.endsWith('/v1')
    ? `${root}/chat/completions`
    : `${root}/v1/chat/completions`;
}
