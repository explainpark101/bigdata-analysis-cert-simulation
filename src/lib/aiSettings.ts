import { idbGet, idbSet } from '@/lib/idb';

/** Active endpoint shape used by chat / tools callers. */
export interface AiEndpointSettings {
  /** OpenAI-compatible API root, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type AiProviderKind = 'openai' | 'openrouter' | 'compatible' | 'custom';

/** One saved provider / endpoint profile. */
export interface AiProviderProfile {
  id: string;
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Last fetched /models ids (optional cache). */
  modelOptions?: string[];
}

export interface AiSettingsState {
  activeProfileId: string;
  profiles: AiProviderProfile[];
}

export const PROVIDER_PRESETS: Array<{
  kind: AiProviderKind;
  label: string;
  baseUrl: string;
  model: string;
}> = [
  {
    kind: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  {
    kind: 'compatible',
    label: 'OpenAI Compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
  {
    kind: 'custom',
    label: 'Custom',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
];

export const DEFAULT_AI_SETTINGS: AiEndpointSettings = {
  baseUrl: PROVIDER_PRESETS[0].baseUrl,
  apiKey: '',
  model: PROVIDER_PRESETS[0].model,
};

function newId(): string {
  return `ai-${crypto.randomUUID().slice(0, 8)}`;
}

export function createProviderProfile(
  partial?: Partial<AiProviderProfile>,
): AiProviderProfile {
  const preset =
    PROVIDER_PRESETS.find((p) => p.kind === partial?.kind) ?? PROVIDER_PRESETS[0];
  return {
    id: partial?.id || newId(),
    label: partial?.label?.trim() || preset.label,
    kind: partial?.kind ?? preset.kind,
    baseUrl: (partial?.baseUrl ?? preset.baseUrl).trim().replace(/\/+$/, ''),
    apiKey: partial?.apiKey ?? '',
    model: (partial?.model ?? preset.model).trim() || preset.model,
    modelOptions: partial?.modelOptions,
  };
}

export function profileToEndpoint(
  profile: AiProviderProfile,
): AiEndpointSettings {
  return {
    baseUrl: profile.baseUrl.replace(/\/+$/, ''),
    apiKey: profile.apiKey,
    model: profile.model,
  };
}

export function normalizeAiSettings(
  raw: Partial<AiEndpointSettings> | null | undefined,
): AiEndpointSettings {
  const baseUrl = String(raw?.baseUrl ?? DEFAULT_AI_SETTINGS.baseUrl)
    .trim()
    .replace(/\/+$/, '');
  return {
    baseUrl: baseUrl || DEFAULT_AI_SETTINGS.baseUrl,
    apiKey: String(raw?.apiKey ?? ''),
    model:
      String(raw?.model ?? DEFAULT_AI_SETTINGS.model).trim() ||
      DEFAULT_AI_SETTINGS.model,
  };
}

function normalizeProfile(
  raw: Partial<AiProviderProfile> | null | undefined,
): AiProviderProfile {
  return createProviderProfile(raw ?? undefined);
}

export function normalizeAiSettingsState(
  raw: unknown,
): AiSettingsState {
  // Legacy single-endpoint shape
  if (
    raw &&
    typeof raw === 'object' &&
    !('profiles' in (raw as object)) &&
    ('baseUrl' in (raw as object) || 'model' in (raw as object))
  ) {
    const legacy = normalizeAiSettings(raw as Partial<AiEndpointSettings>);
    const profile = createProviderProfile({
      label: 'Default',
      kind: 'compatible',
      ...legacy,
    });
    return { activeProfileId: profile.id, profiles: [profile] };
  }

  const state = raw as Partial<AiSettingsState> | null | undefined;
  const profiles = Array.isArray(state?.profiles)
    ? state!.profiles.map((p) => normalizeProfile(p))
    : [];
  if (!profiles.length) {
    const profile = createProviderProfile({ label: 'OpenAI' });
    return { activeProfileId: profile.id, profiles: [profile] };
  }
  const activeProfileId =
    profiles.find((p) => p.id === state?.activeProfileId)?.id ??
    profiles[0].id;
  return { activeProfileId, profiles };
}

export async function loadAiSettingsState(): Promise<AiSettingsState> {
  try {
    const stored = await idbGet<unknown>('aiSettings');
    return normalizeAiSettingsState(stored);
  } catch {
    return normalizeAiSettingsState(null);
  }
}

/** Active endpoint (backward-compatible for agents / chat). */
export async function loadAiSettings(): Promise<AiEndpointSettings> {
  const state = await loadAiSettingsState();
  const active =
    state.profiles.find((p) => p.id === state.activeProfileId) ??
    state.profiles[0];
  return profileToEndpoint(active);
}

export async function saveAiSettingsState(
  state: AiSettingsState,
): Promise<void> {
  await idbSet('aiSettings', normalizeAiSettingsState(state));
}

/** Persist by replacing active profile fields (legacy helper). */
export async function saveAiSettings(
  settings: AiEndpointSettings,
): Promise<void> {
  const state = await loadAiSettingsState();
  const next = normalizeAiSettings(settings);
  const profiles = state.profiles.map((p) =>
    p.id === state.activeProfileId
      ? { ...p, baseUrl: next.baseUrl, apiKey: next.apiKey, model: next.model }
      : p,
  );
  await saveAiSettingsState({ ...state, profiles });
}

export function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return root.endsWith('/v1')
    ? `${root}/chat/completions`
    : `${root}/v1/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return root.endsWith('/v1') ? `${root}/models` : `${root}/v1/models`;
}
