import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Save, Sparkles, X } from 'lucide-react';
import { loadAiSettings } from '@/lib/aiSettings';
import { runVariantAgentTurn } from '@/lib/ai/variantAgent';
import {
  chatContentToText,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';
import {
  clearVariantSession,
  emptyVariantDraft,
  loadVariantSession,
  saveVariantSession,
  type VariantDraft,
} from '@/lib/ai/variantChatStore';
import type { AuthoringProject, BankProblem, ProjectAsset } from '@/types/project';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { ChatComposer } from '@/components/ui/ChatComposer';

interface VariantChatDockProps {
  open: boolean;
  source: BankProblem;
  project: AuthoringProject;
  width: number;
  onWidthChange: (w: number) => void;
  maxWidth: number;
  onClose: () => void;
  addProjectAssets: (assets: ProjectAsset[]) => ProjectAsset[];
  onSaveVariant: (partial: Partial<BankProblem>) => BankProblem;
  onSaved: (problem: BankProblem) => void;
}

function visibleContent(m: ChatMessage): string {
  if (m.role === 'assistant') {
    const parts: string[] = [];
    const text = chatContentToText(m.content).trim();
    if (text) parts.push(text);
    if (m.tool_calls?.length) {
      parts.push(
        `⟪tools: ${m.tool_calls.map((t) => t.function.name).join(', ')}⟫`,
      );
    }
    return parts.join('\n') || '(…)';
  }
  if (m.role === 'user') return chatContentToText(m.content);
  if (m.role === 'tool') {
    const raw = chatContentToText(m.content);
    return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
  }
  return '';
}

export function VariantChatDock({
  open,
  source,
  project,
  width,
  onWidthChange,
  maxWidth,
  onClose,
  addProjectAssets,
  onSaveVariant,
  onSaved,
}: VariantChatDockProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<VariantDraft>(() => emptyVariantDraft(source));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const stored = await loadVariantSession(source.id);
      if (cancelled) return;
      if (stored) {
        setMessages(stored.messages);
        setDraft(stored.draft);
      } else {
        setMessages([]);
        setDraft(emptyVariantDraft(source));
      }
      setError('');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, source]);

  useEffect(() => {
    if (!open || !ready) return;
    void saveVariantSession({
      sourceProblemId: source.id,
      messages,
      draft,
      updatedAt: new Date().toISOString(),
    });
  }, [open, ready, source.id, messages, draft]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const hint = useMemo(() => {
    if (source.taskType === 2) {
      return '2유형: 규칙 기반 데이터 생성 코드를 작성·실행·저장한 뒤 변형 문항을 만듭니다.';
    }
    return '1·3유형: 동일 데이터로 문항을 바꾸고, 정답은 연산 코드 실행으로 채웁니다.';
  }, [source.taskType]);

  if (!open) return null;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    setInput('');
    try {
      const settings = await loadAiSettings();
      const result = await runVariantAgentTurn({
        ctx: {
          settings,
          project,
          source,
          draft,
          addProjectAssets,
        },
        history: messages,
        userText: trimmed,
        onDraft: setDraft,
        onSave: onSaveVariant,
      });
      setMessages(result.messages);
      setDraft(result.draft);
      if (result.savedProblem) {
        onSaved(result.savedProblem);
        await clearVariantSession(source.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveNow = () => {
    void send(
      '초안을 검토하고 save_variant(confirm=true)로 문제은행에 저장해 주세요.',
    );
  };

  return (
    <aside className="variant-dock" style={{ width }} aria-label="변형 문제 AI">
      <div className="variant-dock__inner">
        <header className="variant-dock__head">
          <div>
            <strong className="variant-dock__title">
              <Sparkles size={14} aria-hidden />
              변형 만들기
            </strong>
            <p className="variant-dock__sub">{hint}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="variant-dock__draft">
          <div className="variant-dock__draft-title">{draft.title}</div>
          <div className="variant-dock__draft-meta">
            assets {draft.assetIds.length}
            {source.taskType !== 2
              ? ` · 단답 ${draft.shortAnswers.filter((s) => s.trim()).length}`
              : draft.datasetCode.trim()
                ? ' · dataset code'
                : ''}
          </div>
        </div>

        <div className="variant-dock__messages">
          {!messages.filter((m) => m.role === 'user' || m.role === 'assistant')
            .length ? (
            <p className="variant-dock__empty">
              예: &quot;중앙값 대신 평균을 묻도록 바꿔줘&quot; / &quot;시드를 42로 두고
              피처 분포를 바꾼 train·test를 생성해&quot;
            </p>
          ) : (
            messages
              .filter(
                (m) =>
                  m.role === 'user' ||
                  m.role === 'assistant' ||
                  m.role === 'tool',
              )
              .map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={`variant-msg variant-msg--${m.role}`}
                >
                  <span className="variant-msg__role">
                    {m.role === 'user'
                      ? '나'
                      : m.role === 'assistant'
                        ? 'Agent'
                        : 'Tool'}
                  </span>
                  <pre className="variant-msg__body">{visibleContent(m)}</pre>
                </div>
              ))
          )}
          {busy ? (
            <div className="variant-dock__busy">
              <Loader2 size={14} className="spin" />
              에이전트 작업 중…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? (
          <p className="variant-dock__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="variant-dock__foot">
          <ChatComposer
            value={input}
            onChange={setInput}
            attachments={[]}
            onAttachmentsChange={() => {}}
            onSubmit={() => void send(input)}
            disabled={busy}
            allowImages={false}
            placeholder="변형 요청 · Enter 전송 · Shift+Enter 줄바꿈"
          />
          <div className="variant-dock__actions">
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={busy}
              onClick={saveNow}
            >
              <Save size={14} />
              저장 요청
            </button>
          </div>
        </footer>
      </div>
      <EdgeResizeHandle
        axis="x"
        value={width}
        onChange={onWidthChange}
        min={280}
        max={maxWidth}
        invert
        label="변형 채팅 Dock 너비 조절"
      />
    </aside>
  );
}
