import {
  chatContentToText,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';

/** Progress events from author/modify agent turns (shared with docks). */
export type AgentProgressEvent =
  | { kind: 'status'; text: string }
  | { kind: 'assistant_delta'; text: string }
  | { kind: 'tool'; name: string; phase: 'start' | 'done'; detail?: string };

export type AgentTrailStep = {
  id: string;
  kind: 'model' | 'tool';
  title: string;
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

function sealActive(
  steps: AgentTrailStep[],
  kind?: AgentTrailStep['kind'],
  detailOverride?: string,
): AgentTrailStep[] {
  return steps.map((step) => {
    if (!step.active) return step;
    if (kind && step.kind !== kind) return step;
    return {
      ...step,
      active: false,
      detail:
        detailOverride != null && detailOverride !== ''
          ? detailOverride
          : step.detail,
    };
  });
}

/** Apply one agent progress event to the live trail (immutable). */
export function reduceAgentLiveTrail(
  state: AgentLiveTrailState,
  event: AgentProgressEvent,
): AgentLiveTrailState {
  if (event.kind === 'status') {
    // End-of-round statuses: collapse the streaming model bubble.
    if (/정리|완료|저장/.test(event.text)) {
      return {
        ...state,
        status: event.text,
        steps: sealActive(state.steps, 'model'),
      };
    }
    return { ...state, status: event.text };
  }

  if (event.kind === 'assistant_delta') {
    const steps = [...state.steps];
    let activeIdx = -1;
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i]!.kind === 'model' && steps[i]!.active) {
        activeIdx = i;
        break;
      }
    }
    if (activeIdx >= 0) {
      const cur = steps[activeIdx]!;
      steps[activeIdx] = { ...cur, detail: cur.detail + event.text };
      const status =
        state.status.startsWith('모델 응답') || state.status.startsWith('요청')
          ? '응답 스트리밍 중…'
          : state.status;
      return { ...state, steps, status };
    }
    const { id, nextId } = allocateId(state, 'model');
    steps.push({
      id,
      kind: 'model',
      title: '모델 응답',
      detail: event.text,
      active: true,
    });
    return {
      ...state,
      nextId,
      steps,
      status:
        state.status.startsWith('모델 응답') || state.status.startsWith('요청')
          ? '응답 스트리밍 중…'
          : state.status || '응답 스트리밍 중…',
    };
  }

  if (event.kind === 'tool' && event.phase === 'start') {
    let steps = sealActive(state.steps, 'model');
    steps = sealActive(steps, 'tool');
    const { id, nextId } = allocateId({ ...state, steps }, 'tool');
    steps = [
      ...steps,
      {
        id,
        kind: 'tool',
        title: event.name,
        detail: '',
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
      const detail =
        (event.detail && event.detail.trim()) ||
        step.detail.trim() ||
        '완료';
      return { ...step, active: false, detail };
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

export function truncateToolDetail(raw: string, max = 1200): string {
  const t = raw.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
