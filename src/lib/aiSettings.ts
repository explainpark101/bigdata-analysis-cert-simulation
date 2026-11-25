import { idbGet, idbSet } from '@/lib/idb';

/** JSON-serializable extra body fields for chat.completions. */
export type AiExtraParamValue = string | number | boolean | null;

/** Active endpoint shape used by chat / tools callers. */
export interface AiEndpointSettings {
  /** OpenAI-compatible API root, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Sampling temperature (default 0.4 when omitted by callers). */
  temperature?: number;
  /** Nucleus sampling; omit / null → not sent. */
  topP?: number | null;
  /** Top-k sampling (local gateways); omit / null → not sent. */
  topK?: number | null;
  /**
   * Extra request body keys merged into chat.completions
   * (e.g. min_p, seed). Reserved keys are ignored.
   */
  extraParams?: Record<string, AiExtraParamValue>;
}

export type AiProviderKind =
  | 'openai'
  | 'openrouter'
  | 'google'
  | 'compatible'
  | 'custom';

/** One saved provider / endpoint profile. */
export interface AiProviderProfile {
  id: string;
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  topP?: number | null;
  topK?: number | null;
  extraParams?: Record<string, AiExtraParamValue>;
  /** Last fetched /models ids (optional cache). */
  modelOptions?: string[];
}

/** Default temperature when profile / caller leaves it unset. */
export const DEFAULT_AI_TEMPERATURE = 0.4;

/** Body keys that must not be overridden via extraParams. */
export const AI_RESERVED_BODY_KEYS = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
  'temperature',
  'top_p',
  'top_k',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
]);

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
    kind: 'google',
    label: 'Google AI Studio',
    // OpenAI-compatible root (not /v1) — see chatCompletionsUrl / modelsUrl.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
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
  temperature: DEFAULT_AI_TEMPERATURE,
  topP: null,
  topK: null,
  extraParams: {},
};

function newId(): string {
  return `ai-${crypto.randomUUID().slice(0, 8)}`;
}

function clampNumber(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Parse optional numeric field; empty / null / NaN → null (omit from API). */
export function normalizeOptionalNumber(
  raw: unknown,
  min: number,
  max: number,
): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

export function normalizeExtraParams(
  raw: unknown,
): Record<string, AiExtraParamValue> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, AiExtraParamValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k || AI_RESERVED_BODY_KEYS.has(k)) continue;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      out[k] = value;
    }
  }
  return out;
}

/**
 * Parse a free-form value typed in settings (JSON when possible).
 * "true"/"false"/numbers/"null" work without quotes.
 */
export function parseExtraParamValue(raw: string): AiExtraParamValue {
  const t = raw.trim();
  if (!t) return '';
  if (t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  const asNum = Number(t);
  if (t !== '' && Number.isFinite(asNum) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
    return asNum;
  }
  try {
    const parsed = JSON.parse(t) as unknown;
    if (
      parsed === null ||
      typeof parsed === 'string' ||
      typeof parsed === 'number' ||
      typeof parsed === 'boolean'
    ) {
      if (typeof parsed === 'number' && !Number.isFinite(parsed)) return t;
      return parsed;
    }
  } catch {
    /* plain string */
  }
  return raw;
}

export function formatExtraParamValue(value: AiExtraParamValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return String(value);
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
    temperature: clampNumber(
      partial?.temperature,
      DEFAULT_AI_TEMPERATURE,
      0,
      2,
    ),
    topP: normalizeOptionalNumber(partial?.topP, 0, 1),
    topK: normalizeOptionalNumber(partial?.topK, 0, 200),
    extraParams: normalizeExtraParams(partial?.extraParams),
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
    temperature: clampNumber(
      profile.temperature,
      DEFAULT_AI_TEMPERATURE,
      0,
      2,
    ),
    topP: normalizeOptionalNumber(profile.topP, 0, 1),
    topK: normalizeOptionalNumber(profile.topK, 0, 200),
    extraParams: normalizeExtraParams(profile.extraParams),
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
    temperature: clampNumber(
      raw?.temperature,
      DEFAULT_AI_TEMPERATURE,
      0,
      2,
    ),
    topP: normalizeOptionalNumber(raw?.topP, 0, 1),
    topK: normalizeOptionalNumber(raw?.topK, 0, 200),
    extraParams: normalizeExtraParams(raw?.extraParams),
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
      ? {
          ...p,
          baseUrl: next.baseUrl,
          apiKey: next.apiKey,
          model: next.model,
          temperature: next.temperature,
          topP: next.topP,
          topK: next.topK,
          extraParams: next.extraParams,
        }
      : p,
  );
  await saveAiSettingsState({ ...state, profiles });
}

/**
 * True when `baseUrl` is already an OpenAI-compatible API root
 * (…/v1 or Google AI Studio …/openai), so we append /chat/completions|/models
 * without inserting another /v1.
 */
function isOpenAiCompatRoot(root: string): boolean {
  return /\/(v\d+|openai)$/i.test(root);
}

export function chatCompletionsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return isOpenAiCompatRoot(root)
    ? `${root}/chat/completions`
    : `${root}/v1/chat/completions`;
}

export function modelsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '');
  return isOpenAiCompatRoot(root) ? `${root}/models` : `${root}/v1/models`;
}
