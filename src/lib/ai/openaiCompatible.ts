import {
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

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
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

function buildCompletionBody(opts: {
  settings: AiEndpointSettings;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  stream: boolean;
}): Record<string, unknown> {
  const { settings, messages, tools, toolChoice, temperature, stream } = opts;
  if (!settings.model.trim()) {
    throw new Error('모델명이 비어 있습니다.');
  }
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: temperature ?? 0.4,
    stream,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? 'auto';
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
};

function applyToolCallDelta(
  acc: Map<number, ToolCallAcc>,
  delta: {
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  },
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
}

/**
 * OpenAI-compatible chat.completions with `stream: true` (SSE).
 * Falls back to non-streaming if the body is not an event stream.
 */
export async function createChatCompletion(opts: {
  settings: AiEndpointSettings;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  signal?: AbortSignal;
  onDelta?: ChatStreamDeltaHandler;
}): Promise<ChatCompletionResult> {
  const body = buildCompletionBody({ ...opts, stream: true });
  const res = await fetch(chatCompletionsUrl(opts.settings.baseUrl), {
    method: 'POST',
    headers: buildCompletionHeaders(opts.settings),
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw parseErrorPayload(res.status, text);
  }

  if (!res.body) {
    throw new Error('AI 스트림 본문이 비어 있습니다.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
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
              tool_calls?: Array<{
                index?: number;
                id?: string;
                type?: string;
                function?: { name?: string; arguments?: string };
              }>;
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
          return {
            message: choice.message,
            finishReason: choice.finish_reason ?? finishReason,
          };
        }

        const delta = choice.delta;
        if (!delta) continue;

        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          opts.onDelta?.({ content: delta.content });
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
  } finally {
    reader.releaseLock();
    buffer += decoder.decode();
  }

  if (mode === 'json' || (mode === 'unknown' && buffer.trimStart().startsWith('{'))) {
    return parseNonStreamCompletion(buffer);
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
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
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
