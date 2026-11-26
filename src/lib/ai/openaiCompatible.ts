import {
  AI_RESERVED_BODY_KEYS,
  DEFAULT_AI_TEMPERATURE,
  chatCompletionsUrl,
  modelsUrl,
  type AiEndpointSettings,
} from '@/lib/aiSettings';

/** OpenAI-compatible multimodal content parts (vision). */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
    };

export type ChatContent = string | null | ChatContentPart[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatContent;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}

/** Flatten message content to plain text (ignores image parts). */
export function chatContentToText(content: ChatContent): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/**
 * Remove model "thinking" / chain-of-thought blocks from assistant text.
 * Keeps only the final answer portion for chat history / next-turn context.
 */
export function stripThinkingContent(text: string): string {
  let out = String(text ?? '');
  if (!out) return '';

  // Complete tagged blocks (common local / DeepSeek / Qwen / OpenAI-compat).
  out = out.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<thought\b[^>]*>[\s\S]*?<\/thought>/gi, '');
  out = out.replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '');
  out = out.replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '');
  out = out.replace(
    /<redacted_reasoning\b[^>]*>[\s\S]*?<\/redacted_reasoning>/gi,
    '',
  );

  // Closing tag without open — drop everything before it (think dump then answer).
  out = out.replace(/^[\s\S]*?<\/think>/i, '');
  out = out.replace(/^[\s\S]*?<\/thought>/i, '');
  out = out.replace(/^[\s\S]*?<\/thinking>/i, '');
  out = out.replace(/^[\s\S]*?<\/reasoning>/i, '');

  // Orphan open tags — drop trailing unfinished think.
  out = out.replace(/<think\b[^>]*>[\s\S]*$/gi, '');
  out = out.replace(/<thought\b[^>]*>[\s\S]*$/gi, '');
  out = out.replace(/<thinking\b[^>]*>[\s\S]*$/gi, '');
  out = out.replace(/<reasoning\b[^>]*>[\s\S]*$/gi, '');

  return out.replace(/^\s+|\s+$/g, '');
}

function mapChatContent(
  content: ChatContent,
  mapText: (t: string) => string,
): ChatContent {
  if (content == null) return content;
  if (typeof content === 'string') return mapText(content);
  return content.map((p) =>
    p.type === 'text' ? { ...p, text: mapText(p.text) } : p,
  );
}

/** Strip think/thought from a single chat message (assistant/user text parts). */
export function stripThinkingFromMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant' && message.role !== 'user') return message;
  return {
    ...message,
    content: mapChatContent(message.content, stripThinkingContent),
  };
}

/**
 * Prior turns keep final answers only — drop think/thought blocks from history.
 */
export function stripThinkingFromHistory(
  messages: ChatMessage[],
): ChatMessage[] {
  return messages.map(stripThinkingFromMessage);
}

/**
 * Gemini (AI Studio OpenAI-compat) attaches encrypted thought state on
 * tool_calls. Must be echoed back on the next request or Gemini 3 returns 400.
 * @see https://ai.google.dev/gemini-api/docs/thought-signatures
 */
export type ToolCallExtraContent = {
  google?: {
    thought_signature?: string;
  };
};

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  extra_content?: ToolCallExtraContent;
}

/**
 * Some models dump `{"tool_calls":[...]}` into assistant *content* (often inside
 * a ```json fence) instead of the API `tool_calls` field. Recover those so
 * agents still execute the tools.
 */
function coerceToolCallList(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  const out: ToolCall[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i] as Record<string, unknown> | null;
    if (!item || typeof item !== 'object') continue;
    const fnRaw = (item.function ?? item) as Record<string, unknown>;
    const name = String(fnRaw.name ?? item.name ?? '').trim();
    if (!name) continue;
    let args: unknown = fnRaw.arguments ?? item.arguments ?? '{}';
    if (typeof args !== 'string') {
      try {
        args = JSON.stringify(args ?? {});
      } catch {
        args = '{}';
      }
    }
    out.push({
      id: String(item.id ?? `call_embedded_${i + 1}`),
      type: 'function',
      function: { name, arguments: args as string },
    });
  }
  return out;
}

/** Brace-balanced JSON object slices in `text` (string-aware). */
function findBalancedJsonObjects(
  text: string,
): Array<{ raw: string; start: number; end: number }> {
  const results: Array<{ raw: string; start: number; end: number }> = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth += 1;
      else if (c === '}') {
        depth -= 1;
        if (depth === 0) {
          results.push({ raw: text.slice(i, j + 1), start: i, end: j + 1 });
          i = j;
          break;
        }
      }
    }
  }
  return results;
}

function toolCallsFromParsedJson(parsed: unknown): ToolCall[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.tool_calls)) {
    return coerceToolCallList(obj.tool_calls);
  }
  // Single call object: { name, arguments } or { function: { name, arguments } }
  if (
    typeof (obj as { function?: { name?: unknown } }).function?.name ===
      'string' ||
    typeof obj.name === 'string'
  ) {
    return coerceToolCallList([obj]);
  }
  return [];
}

/**
 * If assistant content embeds tool_calls JSON, return real ToolCall[] and
 * content with that JSON (and its markdown fence) removed.
 */
export function recoverEmbeddedToolCalls(content: ChatContent): {
  content: ChatContent;
  tool_calls: ToolCall[];
} {
  const text = chatContentToText(content);
  if (!text.trim()) {
    return { content, tool_calls: [] };
  }

  type Hit = {
    tool_calls: ToolCall[];
    start: number;
    end: number;
  };
  const hits: Hit[] = [];

  const fenceRe = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(text)) != null) {
    const inner = fenceMatch[1]?.trim() ?? '';
    if (!inner.includes('tool_calls') && !/"name"\s*:/.test(inner)) continue;
    try {
      const parsed = JSON.parse(inner) as unknown;
      const calls = toolCallsFromParsedJson(parsed);
      if (calls.length) {
        hits.push({
          tool_calls: calls,
          start: fenceMatch.index,
          end: fenceMatch.index + fenceMatch[0].length,
        });
      }
    } catch {
      /* ignore bad fence */
    }
  }

  if (!hits.length) {
    for (const obj of findBalancedJsonObjects(text)) {
      if (!obj.raw.includes('tool_calls') && !/"name"\s*:/.test(obj.raw)) {
        continue;
      }
      try {
        const parsed = JSON.parse(obj.raw) as unknown;
        const calls = toolCallsFromParsedJson(parsed);
        if (calls.length) {
          hits.push({
            tool_calls: calls,
            start: obj.start,
            end: obj.end,
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!hits.length) {
    return { content, tool_calls: [] };
  }

  // Prefer the hit with the most tool calls; tie-break: earliest.
  hits.sort((a, b) => {
    const byLen = b.tool_calls.length - a.tool_calls.length;
    if (byLen !== 0) return byLen;
    return a.start - b.start;
  });
  const best = hits[0];

  let cleaned = `${text.slice(0, best.start)}${text.slice(best.end)}`;
  cleaned = cleaned
    .replace(/```(?:json|JSON)?\s*```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const nextContent: ChatContent =
    typeof content === 'string' || content == null
      ? cleaned || null
      : cleaned
        ? [{ type: 'text', text: cleaned }]
        : null;

  return { content: nextContent, tool_calls: best.tool_calls };
}

/**
 * Promote content-embedded tool_calls into the message.tool_calls field.
 * Native tool_calls win; embedded JSON is still stripped from content.
 */
export function normalizeAssistantMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'assistant') return message;
  const recovered = recoverEmbeddedToolCalls(message.content);
  if (message.tool_calls?.length) {
    if (recovered.tool_calls.length === 0) return message;
    return { ...message, content: recovered.content };
  }
  if (!recovered.tool_calls.length) return message;
  return {
    ...message,
    content: recovered.content,
    tool_calls: recovered.tool_calls,
  };
}

export interface ChatToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionResult {
  message: ChatMessage;
  finishReason: string | null;
}

export type ChatStreamDeltaHandler = (delta: {
  content?: string;
  toolCallNames?: string[];
}) => void;

function buildCompletionHeaders(settings: AiEndpointSettings): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = settings.apiKey.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function isGoogleAiStudioBaseUrl(baseUrl: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl);
}

/**
 * Gemini 3 requires thought_signature on functionCall parts in the current
 * turn. Preserve any captured signatures; if history lost them entirely,
 * inject the documented escape hatch on the first tool_call of each assistant
 * message so the request is not rejected with 400.
 */
function withThoughtSignaturesForGoogle(
  messages: ChatMessage[],
  baseUrl: string,
): ChatMessage[] {
  if (!isGoogleAiStudioBaseUrl(baseUrl)) return messages;
  return messages.map((m) => {
    if (m.role !== 'assistant' || !m.tool_calls?.length) return m;
    const calls = m.tool_calls;
    const hasAnySignature = calls.some(
      (tc) => tc.extra_content?.google?.thought_signature,
    );
    if (hasAnySignature) return m;
    return {
      ...m,
      tool_calls: calls.map((tc, index) =>
        index === 0
          ? {
              ...tc,
              extra_content: {
                ...tc.extra_content,
                google: {
                  ...tc.extra_content?.google,
                  thought_signature: 'skip_thought_signature_validator',
                },
              },
            }
          : tc,
      ),
    };
  });
}

/** Defaults tuned to reduce same-phrase loops during authoring. */
export const DEFAULT_FREQUENCY_PENALTY = 0.75;
export const DEFAULT_PRESENCE_PENALTY = 0.4;
/** llama.cpp / vLLM style (>1 discourages repeats). Not sent to Google AI Studio. */
export const DEFAULT_REPETITION_PENALTY = 1.2;

export class RepetitionLoopError extends Error {
  readonly regenerate = true;
  constructor(message = 'AI 응답이 같은 문구를 반복합니다. 재생성합니다.') {
    super(message);
    this.name = 'RepetitionLoopError';
  }
}

/**
 * Detect pathological repetition (same line / phrase loop) in assistant text.
 * Used mid-stream to abort and regenerate.
 */
export function detectTextRepetitionLoop(text: string): boolean {
  const t = String(text ?? '');
  if (t.length < 96) return false;

  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 10);
  if (lines.length >= 4) {
    let run = 1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === lines[i - 1]) {
        run += 1;
        if (run >= 4) return true;
      } else {
        run = 1;
      }
    }
  }

  const window = t.slice(-1600);
  for (const n of [64, 40, 28]) {
    if (window.length < n * 3) continue;
    const needle = window.slice(-n);
    if (needle.trim().length < Math.floor(n * 0.65)) continue;
    let count = 0;
    let idx = window.length;
    while (count < 4) {
      const at = window.lastIndexOf(needle, idx - n);
      if (at < 0) break;
      // Allow small gaps between repeats (spaces/newlines).
      if (idx - (at + n) > 8 && count > 0) break;
      count += 1;
      idx = at;
      if (at === 0) break;
    }
    if (count >= 3) return true;
  }

  const chunks = window
    .split(/(?<=[.。!?？\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  if (chunks.length >= 5) {
    let run = 1;
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i] === chunks[i - 1]) {
        run += 1;
        if (run >= 4) return true;
      } else {
        run = 1;
      }
    }
  }

  return false;
}

function buildCompletionBody(opts: {
  settings: AiEndpointSettings;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  toolChoice?: ChatToolChoice;
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  stream: boolean;
}): Record<string, unknown> {
  const {
    settings,
    messages,
    tools,
    toolChoice,
    temperature,
    frequencyPenalty,
    presencePenalty,
    repetitionPenalty,
    stream,
  } = opts;
  if (!settings.model.trim()) {
    throw new Error('모델명이 비어 있습니다.');
  }
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: withThoughtSignaturesForGoogle(messages, settings.baseUrl),
    temperature:
      temperature ?? settings.temperature ?? DEFAULT_AI_TEMPERATURE,
    frequency_penalty: frequencyPenalty ?? DEFAULT_FREQUENCY_PENALTY,
    presence_penalty: presencePenalty ?? DEFAULT_PRESENCE_PENALTY,
    stream,
  };
  const topP = settings.topP;
  if (topP != null && Number.isFinite(topP)) {
    body.top_p = topP;
  }
  const topK = settings.topK;
  if (topK != null && Number.isFinite(topK)) {
    body.top_k = topK;
  }
  // OpenAI-official schema has no repetition_penalty; many local gateways do.
  if (!isGoogleAiStudioBaseUrl(settings.baseUrl)) {
    body.repetition_penalty = repetitionPenalty ?? DEFAULT_REPETITION_PENALTY;
  }
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? 'auto';
  }
  const extra = settings.extraParams;
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      const k = key.trim();
      if (!k || AI_RESERVED_BODY_KEYS.has(k)) continue;
      body[k] = value;
    }
  }
  return body;
}

function parseErrorPayload(status: number, text: string): Error {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    return new Error(
      json.error?.message || `AI 요청 실패 (${status}): ${text.slice(0, 240)}`,
    );
  } catch {
    return new Error(
      `AI 응답이 JSON이 아닙니다 (${status}): ${text.slice(0, 240)}`,
    );
  }
}

type ToolCallAcc = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  extra_content?: ToolCallExtraContent;
};

type ToolCallDelta = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: ToolCallExtraContent;
};

function applyToolCallDelta(
  acc: Map<number, ToolCallAcc>,
  delta: ToolCallDelta,
) {
  const index = delta.index ?? 0;
  let row = acc.get(index);
  if (!row) {
    row = {
      id: delta.id ?? `call_${index}`,
      type: 'function',
      function: { name: '', arguments: '' },
    };
    acc.set(index, row);
  }
  if (delta.id) row.id = delta.id;
  if (delta.function?.name) row.function.name += delta.function.name;
  if (delta.function?.arguments) {
    row.function.arguments += delta.function.arguments;
  }
  // Gemini may send thought_signature once (often with the first chunk).
  const sig = delta.extra_content?.google?.thought_signature;
  if (sig) {
    row.extra_content = {
      ...row.extra_content,
      ...delta.extra_content,
      google: {
        ...row.extra_content?.google,
        ...delta.extra_content?.google,
        thought_signature: sig,
      },
    };
  } else if (delta.extra_content && !row.extra_content) {
    row.extra_content = delta.extra_content;
  }
}

/**
 * OpenAI-compatible chat.completions with `stream: true` (SSE).
 * Falls back to non-streaming if the body is not an event stream.
 */
export type ChatToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } };

const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 20_000;

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted();
  }
  throw new DOMException('Generation aborted', 'AbortError');
}

async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Generation aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function assertNonEmptyCompletion(result: ChatCompletionResult): void {
  const text = chatContentToText(result.message.content).trim();
  const tools = result.message.tool_calls?.length ?? 0;
  if (!text && tools === 0) {
    throw new Error('AI 스트림 응답이 비어 있습니다.');
  }
}

function retryDelayMs(attempt: number): number {
  // Linear-ish backoff capped; attempt starts at 1.
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.min(attempt, 12));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * OpenAI-compatible chat.completions.
 * Retries **forever** on any failure (empty stream, HTTP errors, network, …)
 * until a usable message/tool_calls arrives or `signal` aborts.
 */
export async function createChatCompletion(opts: {
  settings: AiEndpointSettings;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  toolChoice?: ChatToolChoice;
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  signal?: AbortSignal;
  onDelta?: ChatStreamDeltaHandler;
  /** @deprecated Use onRetry */
  onEmptyStreamRetry?: (attempt: number) => void;
  /** Called before each retry (attempt starts at 1). */
  onRetry?: (attempt: number, error: unknown) => void;
}): Promise<ChatCompletionResult> {
  let attempt = 0;
  while (true) {
    throwIfAborted(opts.signal);
    try {
      const raw = await createChatCompletionOnce(opts);
      const result: ChatCompletionResult = {
        ...raw,
        message: normalizeAssistantMessage(raw.message),
      };
      assertNonEmptyCompletion(result);
      const text = chatContentToText(result.message.content);
      if (text && detectTextRepetitionLoop(text)) {
        throw new RepetitionLoopError();
      }
      // Recovered content-embedded tool_calls — surface names for UI progress.
      if (
        result.message.tool_calls?.length &&
        !(raw.message.tool_calls?.length)
      ) {
        opts.onDelta?.({
          toolCallNames: result.message.tool_calls.map((t) => t.function.name),
        });
      }
      return result;
    } catch (err) {
      if (isAbortError(err)) throw err;
      attempt += 1;
      opts.onRetry?.(attempt, err);
      opts.onEmptyStreamRetry?.(attempt);
      await sleepAbortable(retryDelayMs(attempt), opts.signal);
    }
  }
}

/** Shared abort-aware delay for agent / UI retry loops. */
export { sleepAbortable, isAbortError, throwIfAborted, errorMessage };

async function createChatCompletionOnce(opts: {
  settings: AiEndpointSettings;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  toolChoice?: ChatToolChoice;
  temperature?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  signal?: AbortSignal;
  onDelta?: ChatStreamDeltaHandler;
}): Promise<ChatCompletionResult> {
  const body = buildCompletionBody({ ...opts, stream: true });
  let stopForRepetition = false;
  const localCtrl = new AbortController();
  const onParentAbort = () => {
    localCtrl.abort(
      opts.signal?.reason ?? new DOMException('Generation aborted', 'AbortError'),
    );
  };
  opts.signal?.addEventListener('abort', onParentAbort);

  const throwIfRepetition = (text: string) => {
    if (!detectTextRepetitionLoop(text)) return;
    stopForRepetition = true;
    try {
      localCtrl.abort();
    } catch {
      /* ignore */
    }
    throw new RepetitionLoopError();
  };

  let res: Response;
  try {
    res = await fetch(chatCompletionsUrl(opts.settings.baseUrl), {
      method: 'POST',
      headers: buildCompletionHeaders(opts.settings),
      body: JSON.stringify(body),
      signal: localCtrl.signal,
    });
  } catch (err) {
    opts.signal?.removeEventListener('abort', onParentAbort);
    if (stopForRepetition) throw new RepetitionLoopError();
    throw err;
  }

  if (!res.ok) {
    opts.signal?.removeEventListener('abort', onParentAbort);
    const text = await res.text();
    throw parseErrorPayload(res.status, text);
  }

  if (!res.body) {
    opts.signal?.removeEventListener('abort', onParentAbort);
    throw new Error('AI 스트림 본문이 비어 있습니다.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let lastRepCheckLen = 0;
  const toolAcc = new Map<number, ToolCallAcc>();
  let finishReason: string | null = null;
  let mode: 'unknown' | 'sse' | 'json' = 'unknown';
  const announcedTools = new Set<string>();

  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (mode === 'unknown') {
        const peek = buffer.trimStart();
        if (!peek) continue;
        if (peek.startsWith('{')) {
          mode = 'json';
          continue;
        }
        if (peek.startsWith('data:') || peek.startsWith(':')) {
          mode = 'sse';
        } else {
          // Keep buffering until we can tell
          continue;
        }
      }

      if (mode === 'json') continue;

      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';

      for (const rawLine of parts) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let json: {
          choices?: Array<{
            delta?: {
              content?: string | null;
              tool_calls?: ToolCallDelta[];
            };
            finish_reason?: string | null;
            message?: ChatMessage;
          }>;
          error?: { message?: string };
        };
        try {
          json = JSON.parse(payload) as typeof json;
        } catch {
          continue;
        }

        if (json.error?.message) {
          throw new Error(json.error.message);
        }

        const choice = json.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        if (choice.message) {
          const earlyText = chatContentToText(choice.message.content);
          throwIfRepetition(earlyText);
          const early: ChatCompletionResult = {
            message: choice.message,
            finishReason: choice.finish_reason ?? finishReason,
          };
          assertNonEmptyCompletion(early);
          return early;
        }

        const delta = choice.delta;
        if (!delta) continue;

        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          opts.onDelta?.({ content: delta.content });
          // Check periodically to keep streaming cheap.
          if (content.length - lastRepCheckLen >= 48) {
            lastRepCheckLen = content.length;
            throwIfRepetition(content);
          }
        }

        if (delta.tool_calls?.length) {
          for (const tc of delta.tool_calls) {
            applyToolCallDelta(toolAcc, tc);
          }
          const names = [...toolAcc.values()]
            .map((t) => t.function.name)
            .filter((n) => n.length > 2);
          const fresh = names.filter((n) => !announcedTools.has(n));
          for (const n of fresh) announcedTools.add(n);
          if (fresh.length) {
            opts.onDelta?.({ toolCallNames: [...announcedTools] });
          }
        }
      }
    }
  } catch (err) {
    if (stopForRepetition || err instanceof RepetitionLoopError) {
      throw new RepetitionLoopError();
    }
    throw err;
  } finally {
    opts.signal?.removeEventListener('abort', onParentAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already locked/released after abort */
    }
    buffer += decoder.decode();
  }

  if (mode === 'json' || (mode === 'unknown' && buffer.trimStart().startsWith('{'))) {
    const parsed = parseNonStreamCompletion(buffer);
    throwIfRepetition(chatContentToText(parsed.message.content));
    return parsed;
  }

  // Flush a trailing SSE line without a final newline
  if (mode === 'sse' && buffer.trim()) {
    const line = buffer.trim();
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (payload && payload !== '[DONE]') {
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: ToolCallDelta[];
              };
              finish_reason?: string | null;
            }>;
          };
          const choice = json.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice?.delta;
          if (delta?.content) {
            content += delta.content;
            opts.onDelta?.({ content: delta.content });
          }
          if (delta?.tool_calls?.length) {
            for (const tc of delta.tool_calls) applyToolCallDelta(toolAcc, tc);
          }
        } catch {
          /* ignore trailing partial */
        }
      }
    }
  }

  const tool_calls = [...toolAcc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v)
    .filter((t) => t.function.name);

  if (!content && !tool_calls.length) {
    throw new Error('AI 스트림 응답이 비어 있습니다.');
  }

  throwIfRepetition(content);

  if (tool_calls.length) {
    opts.onDelta?.({
      toolCallNames: tool_calls.map((t) => t.function.name),
    });
  }

  return {
    message: {
      role: 'assistant',
      content: content || null,
      tool_calls: tool_calls.length ? tool_calls : undefined,
    },
    finishReason,
  };
}

function parseNonStreamCompletion(text: string): ChatCompletionResult {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`AI 응답이 JSON이 아닙니다: ${text.slice(0, 240)}`);
  }
  const choice = (json as {
    choices?: Array<{
      message?: ChatMessage;
      finish_reason?: string | null;
    }>;
  }).choices?.[0];
  if (!choice?.message) {
    throw new Error('AI 응답에 message가 없습니다.');
  }
  return {
    message: choice.message,
    finishReason: choice.finish_reason ?? null,
  };
}

/** Lightweight connectivity check. */
export async function testAiConnection(
  settings: AiEndpointSettings,
): Promise<string> {
  const result = await createChatCompletion({
    settings,
    messages: [
      { role: 'user', content: 'Reply with exactly: ok' },
    ],
    temperature: 0,
  });
  return chatContentToText(result.message.content).trim() || '(empty)';
}

/** GET /models — OpenAI-compatible model list. */
export async function listAiModels(
  settings: Pick<AiEndpointSettings, 'baseUrl' | 'apiKey'>,
): Promise<string[]> {
  const headers: Record<string, string> = {};
  const apiKey = settings.apiKey.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(modelsUrl(settings.baseUrl), {
    method: 'GET',
    headers,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `모델 목록 응답이 JSON이 아닙니다 (${res.status}): ${text.slice(0, 240)}`,
    );
  }
  if (!res.ok) {
    const errObj = json as { error?: { message?: string } };
    throw new Error(
      errObj.error?.message ||
        `모델 목록 요청 실패 (${res.status}): ${text.slice(0, 240)}`,
    );
  }
  const data = (json as { data?: Array<{ id?: string }> }).data;
  if (!Array.isArray(data)) {
    throw new Error('모델 목록 형식이 올바르지 않습니다 (data 배열 없음).');
  }
  const ids = data
    .map((m) => String(m?.id ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return [...new Set(ids)];
}
