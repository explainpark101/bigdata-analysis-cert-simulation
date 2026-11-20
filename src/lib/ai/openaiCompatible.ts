import {
  chatCompletionsUrl,
  type AiEndpointSettings,
} from '@/lib/aiSettings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
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
  if (!settings.apiKey.trim()) {
    throw new Error('AI API 키가 설정되지 않았습니다. 전역 설정에서 입력하세요.');
  }
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

  const res = await fetch(chatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
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
  return (result.message.content ?? '').trim() || '(empty)';
}
