import {
  chatContentToText,
  type ChatMessage,
  type ToolCall,
} from '@/lib/ai/openaiCompatible';

export type AgentToolCallPreview = {
  name: string;
  arguments: string;
};

/** Progress events from author/modify agent turns (shared with docks). */
export type AgentProgressEvent =
  | { kind: 'status'; text: string }
  | { kind: 'assistant_delta'; text: string }
  /** Streaming / finished tool_call fragments inside the open model bubble. */
  | { kind: 'assistant_tools'; toolCalls: AgentToolCallPreview[] }
  /** Model stream finished — seal the open response bubble with final text. */
  | {
      kind: 'assistant_finish';
      text: string;
      toolCalls?: AgentToolCallPreview[];
    }
  | {
      kind: 'tool';
      name: string;
      phase: 'start' | 'done';
      /** Full tool request (start) or result (done). */
      detail?: string;
      arguments?: string;
    };

export type AgentTrailStep = {
  id: string;
  kind: 'model' | 'tool';
  title: string;
  /** Streaming assistant text (model steps). */
  content: string;
  /** Accumulating tool_calls preview (model) or request payload (tool). */
  toolPreview: string;
  /** Result body after tool execution. */
  result: string;
  /** Composed body shown in the bubble. */
  detail: string;
  /** Currently streaming / running — shown expanded. */
  active: boolean;
};

export type AgentLiveTrailState = {
  status: string;
  steps: AgentTrailStep[];
  /** Monotonic id counter for step keys. */
  nextId: number;
};

export function emptyAgentLiveTrail(): AgentLiveTrailState {
  return { status: '', steps: [], nextId: 1 };
}

function allocateId(state: AgentLiveTrailState, prefix: string): {
  id: string;
  nextId: number;
} {
  return { id: `${prefix}-${state.nextId}`, nextId: state.nextId + 1 };
}

export function formatToolCallsPreview(
  toolCalls: AgentToolCallPreview[],
): string {
  if (!toolCalls.length) return '';
  return toolCalls
    .map((tc, i) => {
      const name = tc.name.trim() || `(tool_${i})`;
      const args = tc.arguments.trim();
      let pretty = args;
      if (args) {
        try {
          pretty = JSON.stringify(JSON.parse(args), null, 2);
        } catch {
          pretty = args;
        }
      }
      return `⟪tool_call: ${name}⟫\n${pretty || '(arguments pending…)'}`;
    })
    .join('\n\n');
}

export function formatToolRequest(name: string, argsRaw: string): string {
  const args = String(argsRaw ?? '').trim();
  let pretty = args;
  if (args) {
    try {
      pretty = JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      pretty = args;
    }
  }
  return `요청\nname: ${name}\narguments:\n${pretty || '{}'}`;
}

function composeModelDetail(content: string, toolPreview: string): string {
  const text = content.trimEnd();
  const tools = toolPreview.trim();
  if (text && tools) return `${text}\n\n${tools}`;
  return text || tools;
}

function composeToolDetail(request: string, result: string): string {
  const req = request.trim();
  const res = result.trim();
  if (req && res) return `${req}\n\n—— 결과 ——\n${res}`;
  return req || res;
}

function sealActive(
  steps: AgentTrailStep[],
  kind?: AgentTrailStep['kind'],
): AgentTrailStep[] {
  return steps.map((step) => {
    if (!step.active) return step;
    if (kind && step.kind !== kind) return step;
    return { ...step, active: false };
  });
}

function ensureActiveModel(
  state: AgentLiveTrailState,
): { state: AgentLiveTrailState; index: number } {
  const steps = [...state.steps];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i]!.kind === 'model' && steps[i]!.active) {
      return { state: { ...state, steps }, index: i };
    }
  }
  const { id, nextId } = allocateId(state, 'model');
  steps.push({
    id,
    kind: 'model',
    title: '모델 응답',
    content: '',
    toolPreview: '',
    result: '',
    detail: '',
    active: true,
  });
  return { state: { ...state, nextId, steps }, index: steps.length - 1 };
}

function streamingStatus(prev: string): string {
  if (prev.startsWith('모델 응답') || prev.startsWith('요청')) {
    return '응답 스트리밍 중…';
  }
  return prev || '응답 스트리밍 중…';
}

/** Apply one agent progress event to the live trail (immutable). */
export function reduceAgentLiveTrail(
  state: AgentLiveTrailState,
  event: AgentProgressEvent,
): AgentLiveTrailState {
  if (event.kind === 'status') {
    return { ...state, status: event.text };
  }

  if (event.kind === 'assistant_delta') {
    const ensured = ensureActiveModel(state);
    const steps = [...ensured.state.steps];
    const cur = steps[ensured.index]!;
    const content = cur.content + event.text;
    steps[ensured.index] = {
      ...cur,
      content,
      detail: composeModelDetail(content, cur.toolPreview),
    };
    return {
      ...ensured.state,
      steps,
      status: streamingStatus(state.status),
    };
  }

  if (event.kind === 'assistant_tools') {
    const ensured = ensureActiveModel(state);
    const steps = [...ensured.state.steps];
    const cur = steps[ensured.index]!;
    const toolPreview = formatToolCallsPreview(event.toolCalls);
    steps[ensured.index] = {
      ...cur,
      toolPreview,
      detail: composeModelDetail(cur.content, toolPreview),
    };
    return {
      ...ensured.state,
      steps,
      status: event.toolCalls.some((t) => t.name)
        ? `도구 호출 수집 중… (${event.toolCalls.map((t) => t.name || '?').join(', ')})`
        : streamingStatus(state.status),
    };
  }

  if (event.kind === 'assistant_finish') {
    const ensured = ensureActiveModel(state);
    const steps = [...ensured.state.steps];
    const cur = steps[ensured.index]!;
    const content = event.text || cur.content;
    const toolPreview = event.toolCalls?.length
      ? formatToolCallsPreview(event.toolCalls)
      : cur.toolPreview;
    steps[ensured.index] = {
      ...cur,
      content,
      toolPreview,
      detail: composeModelDetail(content, toolPreview),
      active: false,
    };
    return { ...ensured.state, steps };
  }

  if (event.kind === 'tool' && event.phase === 'start') {
    let steps = sealActive(state.steps, 'model');
    steps = sealActive(steps, 'tool');
    const request =
      (event.detail && event.detail.trim()) ||
      formatToolRequest(event.name, event.arguments ?? '');
    const { id, nextId } = allocateId({ ...state, steps }, 'tool');
    steps = [
      ...steps,
      {
        id,
        kind: 'tool',
        title: event.name,
        content: '',
        toolPreview: request,
        result: '',
        detail: request,
        active: true,
      },
    ];
    return {
      ...state,
      nextId,
      steps,
      status: `도구 실행: ${event.name}`,
    };
  }

  if (event.kind === 'tool' && event.phase === 'done') {
    const steps = state.steps.map((step) => {
      if (!(step.kind === 'tool' && step.active && step.title === event.name)) {
        return step;
      }
      const result =
        (event.detail && event.detail.trim()) ||
        step.result.trim() ||
        '완료';
      return {
        ...step,
        result,
        detail: composeToolDetail(step.toolPreview, result),
        active: false,
      };
    });
    return { ...state, steps };
  }

  return state;
}

/** Active model stream text (for abort partial message). */
export function activeModelStreamText(steps: AgentTrailStep[]): string {
  const active = [...steps]
    .reverse()
    .find((s) => s.kind === 'model' && s.active);
  return active?.detail.trim() ?? '';
}

export function stepPreview(detail: string, max = 48): string {
  const flat = detail.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Intermediate agent/tool turns collapse; final assistant text stays open. */
export function isCollapsibleChatStep(m: ChatMessage): boolean {
  if (m.role === 'tool') return true;
  if (m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0) return true;
  return false;
}

export function chatStepBubbleTitle(m: ChatMessage): string {
  if (m.role === 'tool') {
    return m.name?.trim() || '도구 결과';
  }
  if (m.role === 'assistant' && m.tool_calls?.length) {
    const names = m.tool_calls.map((t) => t.function.name).join(', ');
    const text = chatContentToText(m.content).trim();
    return text ? `모델 · ${names}` : `도구 호출 · ${names}`;
  }
  return 'Agent';
}

export function formatAssistantStepDetail(m: ChatMessage): string {
  const text = chatContentToText(m.content).trim();
  const tools = (m.tool_calls ?? []).map((t: ToolCall) => ({
    name: t.function.name,
    arguments: t.function.arguments,
  }));
  return composeModelDetail(text, formatToolCallsPreview(tools));
}

export function truncateToolDetail(raw: string, max = 4000): string {
  const t = raw.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
