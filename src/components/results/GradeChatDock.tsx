import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, Square, X } from 'lucide-react';
import {
  askGradeCoachTurn,
  GRADE_WHY_WRONG_PROMPT,
} from '@/lib/ai/gradeCoach';
import {
  clearGradeSession,
  loadGradeSession,
  saveGradeSession,
} from '@/lib/ai/gradeChatStore';
import {
  chatContentToText,
  isAbortError,
  stripThinkingFromHistory,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';
import type { GradeItem } from '@/lib/examGrade';
import { renderMarkdown } from '@/lib/markdown';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { ChatComposer } from '@/components/ui/ChatComposer';
import { CopyButton } from '@/components/ui/CopyButton';

interface GradeChatDockProps {
  open: boolean;
  item: GradeItem;
  width: number;
  onWidthChange: (w: number) => void;
  maxWidth: number;
  onClose: () => void;
  /**
   * Incremented by the parent when the user clicks “왜 틀렸는지 묻기”.
   * Dock auto-sends once per nonce when history is empty.
   */
  askNonce: number;
}

function buildUserMessage(text: string): ChatMessage {
  return { role: 'user', content: text.trim() || '(empty)' };
}

export function GradeChatDock({
  open,
  item,
  width,
  onWidthChange,
  maxWidth,
  onClose,
  askNonce,
}: GradeChatDockProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  const handledNonceRef = useRef(0);
  const bodyIdPrefix = useId();
  messagesRef.current = messages;

  useEffect(() => {
    return () => {
      abortRef.current?.abort(
        new DOMException('Generation aborted', 'AbortError'),
      );
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    void (async () => {
      const stored = await loadGradeSession(item.quizId);
      if (cancelled) return;
      setMessages(
        stored ? stripThinkingFromHistory(stored.messages) : [],
      );
      setError('');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, item.quizId]);

  useEffect(() => {
    // Persist finished turns only — skip mid-stream token writes.
    if (!open || !ready || busy) return;
    void saveGradeSession({
      quizId: item.quizId,
      messages,
      updatedAt: new Date().toISOString(),
    });
  }, [open, ready, busy, item.quizId, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (opts?: { text?: string; clearComposer?: boolean }) => {
    const clearComposer = opts?.clearComposer ?? opts?.text == null;
    const trimmed = (opts?.text ?? input).trim();
    if (!trimmed || busy) return;

    const historyBefore = messagesRef.current.filter(
      (m) => !(m.role === 'assistant' && !chatContentToText(m.content).trim()),
    );
    const userMsg = buildUserMessage(trimmed);
    const assistantPlaceholder: ChatMessage = {
      role: 'assistant',
      content: '',
    };
    setMessages([...historyBefore, userMsg, assistantPlaceholder]);
    if (clearComposer) setInput('');
    setBusy(true);
    setError('');

    abortRef.current?.abort(
      new DOMException('Superseded by new request', 'AbortError'),
    );
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const result = await askGradeCoachTurn({
        item,
        history: historyBefore,
        userText: trimmed,
        signal: ac.signal,
        onDelta: (accumulated) => {
          setMessages([
            ...historyBefore,
            userMsg,
            { role: 'assistant', content: accumulated },
          ]);
        },
      });
      setMessages(result.messages);
      setError('');
    } catch (err) {
      if (isAbortError(err)) {
        // Keep partial streamed assistant text if any arrived.
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (
            last?.role === 'assistant' &&
            !chatContentToText(last.content).trim()
          ) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      } else {
        setError(err instanceof Error ? err.message : String(err));
        // Drop empty placeholder; keep user message for retry.
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (
            last?.role === 'assistant' &&
            !chatContentToText(last.content).trim()
          ) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
    }
  };

  // Kick off the default why-wrong turn once per askNonce (empty history only).
  useEffect(() => {
    if (!open || !ready) return;
    if (!askNonce || askNonce <= handledNonceRef.current) return;
    handledNonceRef.current = askNonce;
    if (messagesRef.current.length > 0) return;
    void send({ text: GRADE_WHY_WRONG_PROMPT, clearComposer: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick once per nonce
  }, [open, ready, askNonce, item.quizId]);

  const abort = () => {
    abortRef.current?.abort(
      new DOMException('Generation aborted', 'AbortError'),
    );
    abortRef.current = null;
    setBusy(false);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (
        last?.role === 'assistant' &&
        !chatContentToText(last.content).trim()
      ) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  };

  const resetChat = async () => {
    if (busy) return;
    await clearGradeSession(item.quizId);
    setMessages([]);
    setError('');
    setInput('');
  };

  if (!open) return null;

  const visible = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  );

  return (
    <aside
      className="variant-dock grade-coach-dock"
      style={{ width }}
      aria-label="채점 코치 AI 채팅"
    >
      <div className="variant-dock__inner">
        <header className="variant-dock__head">
          <div>
            <strong className="variant-dock__title">
              <Sparkles size={14} aria-hidden />
              채점 코치
            </strong>
            <p className="variant-dock__sub">{item.title}</p>
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

        <div className="variant-dock__messages">
          {!visible.length && !busy ? (
            <p className="variant-dock__empty">
              채점 결과·작성 코드를 바탕으로 틀린 이유를 설명합니다. 이어서
              질문할 수 있습니다.
            </p>
          ) : (
            visible.map((m, i) => {
              const bodyId = `${bodyIdPrefix}-body-${i}`;
              const raw = chatContentToText(m.content);
              const streaming =
                busy &&
                m.role === 'assistant' &&
                i === visible.length - 1;
              const text = streaming
                ? raw
                : raw.trim() || '(…)';
              return (
                <div
                  key={`${m.role}-${i}`}
                  className={`variant-msg variant-msg--${m.role}${streaming ? ' variant-msg--streaming' : ''}`}
                >
                  <div className="variant-msg__top">
                    <span className="variant-msg__role">
                      {m.role === 'user' ? '나' : '코치'}
                    </span>
                    <div
                      className="variant-msg__actions"
                      role="group"
                      aria-label="메시지 작업"
                    >
                      {m.role === 'user' ? (
                        <button
                          type="button"
                          className="variant-msg__action"
                          aria-label="메시지 재전송"
                          disabled={busy}
                          onClick={() =>
                            void send({
                              text: chatContentToText(m.content),
                              clearComposer: false,
                            })
                          }
                        >
                          <RefreshCw size={14} aria-hidden />
                        </button>
                      ) : null}
                      {!streaming ? (
                        <CopyButton
                          targetId={bodyId}
                          text={raw}
                          label="메시지 내용 복사"
                          className="variant-msg__copy"
                        />
                      ) : null}
                    </div>
                  </div>
                  {m.role === 'assistant' ? (
                    <div
                      id={bodyId}
                      className={`variant-msg__body md-content grade-coach-dock__md${streaming ? ' grade-coach-dock__md--streaming' : ''}`}
                      aria-live={streaming ? 'polite' : undefined}
                      dangerouslySetInnerHTML={{
                        __html:
                          renderMarkdown(text) +
                          (streaming
                            ? '<span class="variant-dock__caret" aria-hidden="true">▍</span>'
                            : ''),
                      }}
                    />
                  ) : (
                    <pre id={bodyId} className="variant-msg__body">
                      {text}
                    </pre>
                  )}
                </div>
              );
            })
          )}
          {busy ? (
            <div className="variant-dock__busy-row">
              <div className="variant-dock__busy">
                <Loader2 size={14} className="spin" />
                응답 생성 중…
              </div>
              <button
                type="button"
                className="variant-dock__abort"
                onClick={abort}
                aria-label="생성 중지"
              >
                <span className="variant-dock__abort-icon" aria-hidden>
                  <Square size={10} fill="currentColor" strokeWidth={0} />
                </span>
                중지
              </button>
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
            onSubmit={() => void send()}
            disabled={busy || !ready}
            allowImages={false}
            placeholder="추가 질문 · Enter 전송 · Shift+Enter 줄바꿈"
          />
          <div className="variant-dock__actions">
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={busy || !ready}
              onClick={() =>
                void send({
                  text: GRADE_WHY_WRONG_PROMPT,
                  clearComposer: false,
                })
              }
            >
              <Sparkles size={14} />
              왜 틀렸는지 다시 묻기
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !messages.length}
              onClick={() => void resetChat()}
            >
              대화 초기화
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
        label="채점 코치 Dock 너비 조절"
      />
    </aside>
  );
}
