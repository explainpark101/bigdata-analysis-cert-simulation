import { useState, type SyntheticEvent } from 'react';
import { Loader2 } from 'lucide-react';
import {
  stepPreview,
  type AgentTrailStep,
} from '@/lib/ai/agentLiveTrail';

type AgentStepTrailProps = {
  steps: AgentTrailStep[];
  status?: string;
  /** Show blinking caret on the active model stream. */
  showCaret?: boolean;
  className?: string;
  'aria-label'?: string;
};

function StepDetails({
  step,
  open,
  onToggle,
  showCaret,
}: {
  step: AgentTrailStep;
  open: boolean;
  onToggle: (open: boolean) => void;
  showCaret?: boolean;
}) {
  const preview = stepPreview(step.detail);
  const summaryLabel =
    step.kind === 'model'
      ? step.active
        ? '모델 응답 생성 중'
        : preview
          ? `모델 · ${preview}`
          : '모델 응답'
      : step.active
        ? `도구 · ${step.title}`
        : preview && preview !== '완료'
          ? `${step.title} · ${preview}`
          : step.title;

  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (step.active) {
      event.currentTarget.open = true;
      return;
    }
    onToggle(event.currentTarget.open);
  };

  return (
    <details
      className={`agent-step ${
        step.kind === 'model' ? 'agent-step--model' : 'agent-step--tool'
      } ${step.active ? 'agent-step--active' : ''}`}
      open={open}
      onToggle={handleToggle}
    >
      <summary className="agent-step__bubble">
        {step.active ? (
          <Loader2 size={11} className="spin agent-step__spin" aria-hidden />
        ) : null}
        <span className="agent-step__label">{summaryLabel}</span>
      </summary>
      <pre className="agent-step__detail">
        {step.detail || (step.active ? '…' : '(내용 없음)')}
        {showCaret && step.active && step.kind === 'model' ? (
          <span className="variant-dock__caret" aria-hidden>
            ▍
          </span>
        ) : null}
      </pre>
    </details>
  );
}

/** Live / completed agent steps as compact bubbles that expand for detail. */
export function AgentStepTrail({
  steps,
  status,
  showCaret = true,
  className,
  'aria-label': ariaLabel = '에이전트 진행 단계',
}: AgentStepTrailProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!steps.length && !status) return null;

  return (
    <div
      className={['agent-step-trail', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
    >
      {status ? (
        <p className="agent-step-trail__status" role="status">
          {status}
        </p>
      ) : null}
      <div className="agent-step-trail__list">
        {steps.map((step) => (
          <StepDetails
            key={step.id}
            step={step}
            showCaret={showCaret}
            open={step.active || !!expanded[step.id]}
            onToggle={(next) =>
              setExpanded((prev) => ({ ...prev, [step.id]: next }))
            }
          />
        ))}
      </div>
    </div>
  );
}

type ChatStepBubbleProps = {
  title: string;
  detail: string;
  kind?: 'model' | 'tool';
  bodyId?: string;
};

/** Collapsed history step (assistant tool-call / tool result). */
export function ChatStepBubble({
  title,
  detail,
  kind = 'tool',
  bodyId,
}: ChatStepBubbleProps) {
  const preview = stepPreview(detail);
  return (
    <details
      className={`agent-step agent-step--history ${
        kind === 'model' ? 'agent-step--model' : 'agent-step--tool'
      }`}
    >
      <summary className="agent-step__bubble">
        <span className="agent-step__label">
          {preview ? `${title} · ${preview}` : title}
        </span>
      </summary>
      <pre id={bodyId} className="agent-step__detail">
        {detail || '(내용 없음)'}
      </pre>
    </details>
  );
}
