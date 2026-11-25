import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Save, Wand2 } from 'lucide-react';
import { loadAiSettings } from '@/lib/aiSettings';
import { runAuthorAgentTurn } from '@/lib/ai/authorAgent';
import {
  appendCsvMountNote,
  ensureProblemHasCsv,
  linkedCsvAssetIds,
} from '@/lib/ai/ensureProblemCsv';
import {
  chatContentToText,
  isAbortError,
  sleepAbortable,
  stripThinkingFromHistory,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';
import {
  clearModifySession,
  emptyModifyDraft,
  loadModifySession,
  normalizeModifyDraft,
  saveModifySession,
  type ModifyDraft,
} from '@/lib/ai/modifyChatStore';
import type { AuthoringProject, BankProblem, ProjectAsset } from '@/types/project';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { ChatComposer } from '@/components/ui/ChatComposer';
import { CopyButton } from '@/components/ui/CopyButton';

interface ModifyChatDockProps {
  problem: BankProblem;
  project: AuthoringProject;
  width: number;
  onWidthChange: (w: number) => void;
  maxWidth: number;
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
  /** Persist CSV link (+ optional markdown note) onto the bank problem. */
  onLinkCsv: (patch: {
    assetIds: string[];
    markdown?: string;
  }) => void;
  onApply: (partial: Partial<BankProblem>) => BankProblem;
  onApplied: (problem: BankProblem) => void;
}

function buildUserMessage(text: string): ChatMessage {
  return { role: 'user', content: text.trim() || '(empty)' };
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

export function ModifyChatDock({
  problem,
  project,
  width,
  onWidthChange,
  maxWidth,
  addProjectAssets,
  onLinkCsv,
  onApply,
  onApplied,
}: ModifyChatDockProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<ModifyDraft>(() => emptyModifyDraft(problem));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [csvNote, setCsvNote] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const messagesRef = useRef(messages);
  const bodyIdPrefix = useId();
  draftRef.current = draft;
  messagesRef.current = messages;

  const linkedCsvKey = linkedCsvAssetIds(project, problem.assetIds).join(',');

  // Force-link CSV when the selected problem has none.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ensured = await ensureProblemHasCsv({
        project,
        problem,
        addProjectAssets,
      });
      if (cancelled) return;
      if (!ensured.changed) {
        setCsvNote(
          ensured.csvNames.length ? `CSV ${ensured.csvNames.join(', ')}` : '',
        );
        return;
      }
      const markdown = appendCsvMountNote(problem.markdown, ensured.csvNames);
      onLinkCsv({ assetIds: ensured.assetIds, markdown });
      setCsvNote(
        `CSV 자동 생성·연결: ${ensured.csvNames.map((n) => `data/${n}`).join(', ')}`,
      );
      setDraft((prev) => ({
        ...prev,
        assetIds: ensured.assetIds,
        markdown: appendCsvMountNote(prev.markdown, ensured.csvNames),
      }));
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when switching problems or when CSV links disappear.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- problem.id + linkedCsvKey
  }, [problem.id, linkedCsvKey]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void (async () => {
      const stored = await loadModifySession(problem.id);
      if (cancelled) return;
      if (stored) {
        setMessages(stripThinkingFromHistory(stored.messages));
        setDraft(normalizeModifyDraft(stored.draft));
      } else {
        setMessages([]);
        setDraft(emptyModifyDraft(problem));
      }
      setError('');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [problem.id]);

  useEffect(() => {
    if (!ready) return;
    void saveModifySession({
      problemId: problem.id,
      messages,
      draft,
      updatedAt: new Date().toISOString(),
    });
  }, [ready, problem.id, messages, draft]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const peerReferenceIds = useMemo(
    () =>
      project.bank
        .filter((b) => b.id !== problem.id && b.taskType === problem.taskType)
        .slice(0, 12)
        .map((b) => b.id),
    [project.bank, problem.id, problem.taskType],
  );

  const hint = useMemo(() => {
    const csvCount = linkedCsvAssetIds(project, draft.assetIds).length;
    const base =
      problem.taskType === 2
        ? '제작 페이지와 동일한 도구로 채점·데이터를 수정합니다.'
        : '제작 페이지와 동일한 도구로 본문·정답·CSV를 수정합니다.';
    return `${base} · CSV ${csvCount}개 연결`;
  }, [problem.taskType, project, draft.assetIds]);

  const reloadFromProblem = () => {
    if (busy) return;
    setDraft(emptyModifyDraft(problem));
    setError('');
  };

  const send = async (opts?: { text?: string; clearComposer?: boolean }) => {
    const clearComposer = opts?.clearComposer ?? opts?.text == null;
    const trimmed = (opts?.text ?? input).trim();
    if (!trimmed || busy) return;

    const historyBefore = messagesRef.current;
    const userMsg = buildUserMessage(trimmed);
    setMessages([...historyBefore, userMsg]);
    if (clearComposer) setInput('');
    setBusy(true);
    setError('');

    let attempt = 0;
    try {
      while (true) {
        try {
          // Re-ensure CSV before the agent turn (covers race after library edits).
          let workingDraft = draftRef.current;
          const ensured = await ensureProblemHasCsv({
            project,
            problem: {
              ...problem,
              assetIds: workingDraft.assetIds,
              markdown: workingDraft.markdown,
              taskType: workingDraft.taskType,
            },
            addProjectAssets,
          });
          if (ensured.changed) {
            const markdown = appendCsvMountNote(
              workingDraft.markdown,
              ensured.csvNames,
            );
            workingDraft = {
              ...workingDraft,
              assetIds: ensured.assetIds,
              markdown,
            };
            setDraft(workingDraft);
            onLinkCsv({ assetIds: ensured.assetIds, markdown });
            setCsvNote(
              `CSV 자동 생성·연결: ${ensured.csvNames.map((n) => `data/${n}`).join(', ')}`,
            );
          }

          const settings = await loadAiSettings();
          const result = await runAuthorAgentTurn({
            ctx: {
              settings,
              project,
              draft: workingDraft,
              referenceIds: peerReferenceIds,
              addProjectAssets,
              mode: 'modify',
              targetProblem: problem,
            },
            history: historyBefore,
            userText: trimmed,
            onDraft: setDraft,
            onSave: onApply,
          });
          setMessages(result.messages);
          setDraft(result.draft);
          setError('');
          if (result.savedProblem) {
            onApplied(result.savedProblem);
          }
          break;
        } catch (err) {
          if (isAbortError(err)) throw err;
          attempt += 1;
          const msg = err instanceof Error ? err.message : String(err);
          setError(
            `실패 재시도 중… (${attempt})${msg ? ` · ${msg.slice(0, 80)}` : ''}`,
          );
          await sleepAbortable(Math.min(20_000, 800 * Math.min(attempt, 12)));
        }
      }
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="variant-dock" style={{ width }} aria-label="문제 수정 AI">
      <div className="variant-dock__inner">
        <header className="variant-dock__head">
          <div>
            <strong className="variant-dock__title">
              <Wand2 size={14} aria-hidden />
              문제 수정 AI
            </strong>
            <p className="variant-dock__sub">{hint}</p>
            {csvNote ? (
              <p className="variant-dock__sub" role="status">
                {csvNote}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            disabled={busy}
            onClick={reloadFromProblem}
            title="좌측 편집 내용을 초안으로 다시 불러오기"
          >
            <RefreshCw size={14} />
            동기화
          </button>
        </header>

        <div className="variant-dock__draft">
          <div className="variant-dock__draft-title">{draft.title}</div>
          <div className="variant-dock__draft-meta">
            제{draft.taskType}유형 · assets {draft.assetIds.length}
            {draft.taskType !== 2
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
              예: &quot;본문을 다듬고 정답 코드를 다시 돌려줘&quot; / &quot;CSV를
              변형한 뒤 단답을 맞춰줘&quot;
            </p>
          ) : (
            messages
              .filter(
                (m) =>
                  m.role === 'user' ||
                  m.role === 'assistant' ||
                  m.role === 'tool',
              )
              .map((m, i) => {
                const bodyId = `${bodyIdPrefix}-body-${i}`;
                return (
                  <div
                    key={`${m.role}-${i}`}
                    className={`variant-msg variant-msg--${m.role}`}
                  >
                    <div className="variant-msg__top">
                      <span className="variant-msg__role">
                        {m.role === 'user'
                          ? '나'
                          : m.role === 'assistant'
                            ? 'Agent'
                            : 'Tool'}
                      </span>
                      {m.role === 'user' ? (
                        <div
                          className="variant-msg__actions"
                          role="group"
                          aria-label="메시지 작업"
                        >
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
                          <CopyButton
                            targetId={bodyId}
                            label="메시지 내용 복사"
                            className="variant-msg__copy"
                          />
                        </div>
                      ) : null}
                    </div>
                    <pre id={bodyId} className="variant-msg__body">
                      {visibleContent(m)}
                    </pre>
                  </div>
                );
              })
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
            onSubmit={() => void send()}
            disabled={busy}
            allowImages={false}
            placeholder="수정 요청 · Enter 전송 · Shift+Enter 줄바꿈"
          />
          <div className="variant-dock__actions">
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={busy}
              onClick={() =>
                void clearModifySession(problem.id).then(() => {
                  setMessages([]);
                  setDraft(emptyModifyDraft(problem));
                  setError('');
                })
              }
            >
              대화 초기화
            </button>
            <button
              type="button"
              className="primary-btn btn-with-icon"
              disabled={busy}
              onClick={() =>
                void send({
                  text: '초안을 검토하고 apply_changes(confirm=true)로 이 문제에 반영해 주세요. CSV가 없으면 생성·연결한 뒤 적용하세요.',
                  clearComposer: false,
                })
              }
            >
              <Save size={14} />
              적용 요청
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
        label="문제 수정 AI Dock 너비 조절"
      />
    </aside>
  );
}
