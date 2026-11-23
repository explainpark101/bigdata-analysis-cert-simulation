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

export async function createChatCompletion(opts: {
  settings: AiEndpointSettings;
  messages: ChatMessage[];
  tools?: ChatToolDef[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
}): Promise<ChatCompletionResult> {
  const { settings, messages, tools, toolChoice, temperature } = opts;
  if (!settings.model.trim()) {
    throw new Error('모델명이 비어 있습니다.');
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature: temperature ?? 0.4,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice ?? 'auto';
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = settings.apiKey.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `AI 응답이 JSON이 아닙니다 (${res.status}): ${text.slice(0, 240)}`,
    );
  }

  if (!res.ok) {
    const errObj = json as { error?: { message?: string } };
    throw new Error(
      errObj.error?.message ||
        `AI 요청 실패 (${res.status}): ${text.slice(0, 240)}`,
    );
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
