import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Save, Square, Wand2 } from 'lucide-react';
import { loadAiSettings } from '@/lib/aiSettings';
import {
  runAuthorAgentTurn,
  type AuthorAgentProgress,
} from '@/lib/ai/authorAgent';
import {
  chatStepBubbleTitle,
  emptyAgentLiveTrail,
  isCollapsibleChatStep,
  reduceAgentLiveTrail,
  type AgentLiveTrailState,
} from '@/lib/ai/agentLiveTrail';
import {
  getAutoReviewChat,
  subscribeAutoReviewChat,
  type AutoReviewChatSession,
} from '@/lib/ai/autoReviewChatStore';
import { applyCsvRenamesToDraftFields } from '@/lib/ai/csvAssetPersist';
import {
  appendCsvMountNote,
  ensureProblemHasCsv,
  linkedCsvAssetIds,
} from '@/lib/ai/ensureProblemCsv';
import { cancelExamAutoReview } from '@/lib/examAutoReviewQueue';
import {
  chatContentToText,
  isAbortError,
  sleepAbortable,
  stripThinkingFromHistory,
  throwIfAborted,
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
import {
  AgentStepTrail,
  ChatStepBubble,
} from '@/components/ui/AgentStepTrail';
import { ChatComposer } from '@/components/ui/ChatComposer';
import { CopyButton } from '@/components/ui/CopyButton';

interface ModifyChatDockProps {
  problem: BankProblem;
  project: AuthoringProject;
  width: number;
  onWidthChange: (w: number) => void;
  maxWidth: number;
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
  /** Persist CSV link (+ optional markdown / code path rewrites) onto the bank problem. */
  onLinkCsv: (patch: {
    assetIds: string[];
    markdown?: string;
    answerCode?: BankProblem['answerCode'];
    gradingCode?: BankProblem['gradingCode'];
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
  const [liveTrail, setLiveTrail] = useState<AgentLiveTrailState>(
    emptyAgentLiveTrail,
  );
  const [autoReview, setAutoReview] = useState<AutoReviewChatSession | null>(
    () => getAutoReviewChat(problem.id),
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  const bodyIdPrefix = useId();
  draftRef.current = draft;
  messagesRef.current = messages;
  const autoReviewBusy = Boolean(autoReview?.busy);
  const dockBusy = busy || autoReviewBusy;
  const liveStatus = liveTrail.status;

  const setLiveStatus = (text: string) => {
    setLiveTrail((prev) => ({ ...prev, status: text }));
  };

  const clearLive = () => {
    setLiveTrail(emptyAgentLiveTrail());
  };

  const handleProgress = (event: AuthorAgentProgress) => {
    setLiveTrail((prev) => reduceAgentLiveTrail(prev, event));
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort(
        new DOMException('Generation aborted', 'AbortError'),
      );
      abortRef.current = null;
    };
  }, []);

  // Mirror batch auto-review chat for this problem (live + finished session).
  useEffect(() => {
    return subscribeAutoReviewChat(problem.id, (session) => {
      setAutoReview(session);
      if (!session) return;
      setMessages(stripThinkingFromHistory(session.messages));
      setDraft(normalizeModifyDraft(session.draft));
      setLiveStatus(session.busy ? session.liveStatus : '');
      setError(session.error || '');
      setBusy(false);
      setReady(true);
    });
  }, [problem.id]);

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
      let markdown = appendCsvMountNote(problem.markdown, ensured.csvNames);
      let answerCode = problem.answerCode;
      let gradingCode = problem.gradingCode;
      if (ensured.renames.length) {
        const rewritten = applyCsvRenamesToDraftFields(
          {
            markdown,
            answerCode: answerCode ?? { python: '', r: '' },
            gradingCode: gradingCode ?? { python: '', r: '' },
          },
          ensured.renames,
        );
        markdown = rewritten.markdown;
        answerCode = rewritten.answerCode;
        gradingCode = rewritten.gradingCode;
      }
      onLinkCsv({
        assetIds: ensured.assetIds,
        markdown,
        answerCode,
        gradingCode,
      });
      setCsvNote(
        `CSV 자동 생성·연결: ${ensured.csvNames.map((n) => `data/${n}`).join(', ')}`,
      );
      setDraft((prev) => {
        const nextMd = appendCsvMountNote(prev.markdown, ensured.csvNames);
        if (!ensured.renames.length) {
          return { ...prev, assetIds: ensured.assetIds, markdown: nextMd };
        }
        return {
          ...prev,
          ...applyCsvRenamesToDraftFields(
            {
              ...prev,
              assetIds: ensured.assetIds,
              markdown: nextMd,
            },
            ensured.renames,
          ),
          assetIds: ensured.assetIds,
        };
      });
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
      const live = getAutoReviewChat(problem.id);
      if (live) {
        if (cancelled) return;
        setAutoReview(live);
        setMessages(stripThinkingFromHistory(live.messages));
        setDraft(normalizeModifyDraft(live.draft));
        setLiveStatus(live.busy ? live.liveStatus : '');
        setError(live.error || '');
        setReady(true);
        return;
      }
      const stored = await loadModifySession(problem.id);
      if (cancelled) return;
      setAutoReview(null);
      if (stored) {
        setMessages(stripThinkingFromHistory(stored.messages));
        setDraft(normalizeModifyDraft(stored.draft));
      } else {
        setMessages([]);
        setDraft(emptyModifyDraft(problem));
      }
      setError('');
      setLiveStatus('');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [problem.id]);

  useEffect(() => {
    if (!ready) return;
    // Auto-review runner persists its own session; avoid racing mid-turn.
    if (autoReviewBusy) return;
    void saveModifySession({
      problemId: problem.id,
      messages,
      draft,
      updatedAt: new Date().toISOString(),
    });
  }, [ready, problem.id, messages, draft, autoReviewBusy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, dockBusy, liveTrail]);

  const abortGeneration = () => {
    if (autoReviewBusy && autoReview) {
      setLiveStatus('일괄 검수 중지 중…');
      cancelExamAutoReview(autoReview.examId);
      return;
    }
    const ctrl = abortRef.current;
    if (!ctrl || ctrl.signal.aborted) return;
    setLiveStatus('중지 중…');
    ctrl.abort(new DOMException('Generation aborted', 'AbortError'));
  };

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
        ? '제작 페이지와 동일한 출제 도구가 이 채팅에 연결되어 있습니다.'
        : '제작 페이지와 동일한 출제 도구가 이 채팅에 연결되어 있습니다.';
    return `${base} · CSV ${csvCount}개 연결 · 도구 즉시 호출`;
  }, [problem.taskType, project, draft.assetIds]);

  const reloadFromProblem = () => {
    if (dockBusy) return;
    setDraft(emptyModifyDraft(problem));
    setError('');
  };

  const send = async (opts?: { text?: string; clearComposer?: boolean }) => {
    const clearComposer = opts?.clearComposer ?? opts?.text == null;
    const trimmed = (opts?.text ?? input).trim();
    if (!trimmed || dockBusy) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const historyBefore = messagesRef.current;
    const userMsg = buildUserMessage(trimmed);
    setMessages([...historyBefore, userMsg]);
    if (clearComposer) setInput('');
    setBusy(true);
    setError('');
    setLiveTrail({
      ...emptyAgentLiveTrail(),
      status: '요청 준비 중…',
    });

    let attempt = 0;
    try {
      while (true) {
        throwIfAborted(ctrl.signal);
        try {
          // Re-ensure CSV before the agent turn (covers race after library edits).
          let workingDraft = draftRef.current;
          setLiveStatus('CSV 확인 중…');
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
          throwIfAborted(ctrl.signal);
          if (ensured.changed) {
            let markdown = appendCsvMountNote(
              workingDraft.markdown,
              ensured.csvNames,
            );
            workingDraft = {
              ...workingDraft,
              assetIds: ensured.assetIds,
              markdown,
            };
            if (ensured.renames.length) {
              workingDraft = {
                ...workingDraft,
                ...applyCsvRenamesToDraftFields(workingDraft, ensured.renames),
                assetIds: ensured.assetIds,
              };
              markdown = workingDraft.markdown;
            }
            setDraft(workingDraft);
            onLinkCsv({
              assetIds: ensured.assetIds,
              markdown,
              answerCode: workingDraft.answerCode,
              gradingCode: workingDraft.gradingCode,
            });
            setCsvNote(
              `CSV 자동 생성·연결: ${ensured.csvNames.map((n) => `data/${n}`).join(', ')}`,
            );
          }

          setLiveStatus('에이전트 작업 중…');
          const settings = await loadAiSettings();
          throwIfAborted(ctrl.signal);
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
            onProgress: handleProgress,
            signal: ctrl.signal,
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
          setLiveStatus(`재시도 중… (${attempt})`);
          setError(
            `실패 재시도 중… (${attempt})${msg ? ` · ${msg.slice(0, 80)}` : ''}`,
          );
          await sleepAbortable(
            Math.min(20_000, 800 * Math.min(attempt, 12)),
            ctrl.signal,
          );
        }
      }
    } catch (err) {
      if (isAbortError(err)) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '(중지됨)' },
        ]);
        setError('수정을 중지했습니다.');
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      clearLive();
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
            {autoReview ? (
              <p
                className={`variant-dock__sub modify-dock__auto-review ${
                  autoReview.busy ? 'modify-dock__auto-review--live' : ''
                }`}
                role="status"
              >
                {autoReview.busy
                  ? `일괄 자동 검수 진행 중 · ${autoReview.examTitle}`
                  : `일괄 자동 검수 기록 · ${autoReview.examTitle}`}
              </p>
            ) : null}
            {csvNote ? (
              <p className="variant-dock__sub" role="status">
                {csvNote}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            disabled={dockBusy}
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
              {autoReviewBusy
                ? '일괄 자동 검수 채팅을 불러오는 중…'
                : '예: "본문을 다듬고 정답 코드를 다시 돌려줘" / "CSV를 변형한 뒤 단답을 맞춰줘". 출제 도구는 이 채팅에 이미 연결되어 있습니다.'}
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
                if (isCollapsibleChatStep(m)) {
                  const detail =
                    m.role === 'tool'
                      ? chatContentToText(m.content)
                      : visibleContent(m);
                  return (
                    <ChatStepBubble
                      key={`${m.role}-${i}`}
                      title={chatStepBubbleTitle(m)}
                      detail={detail}
                      kind={m.role === 'assistant' ? 'model' : 'tool'}
                      bodyId={bodyId}
                    />
                  );
                }
                return (
                  <div
                    key={`${m.role}-${i}`}
                    className={`variant-msg variant-msg--${m.role}`}
                  >
                    <div className="variant-msg__top">
                      <span className="variant-msg__role">
                        {m.role === 'user' ? '나' : 'Agent'}
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
                            disabled={dockBusy}
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
          {dockBusy ? (
            <div
              className="variant-dock__live"
              role="progressbar"
              aria-busy="true"
              aria-valuetext={liveStatus || '에이전트 작업 중'}
            >
              <div className="variant-dock__busy-row">
                <div className="variant-dock__busy">
                  <Loader2 size={14} className="spin" />
                  <span>
                    {liveStatus ||
                      (autoReviewBusy
                        ? '일괄 자동 검수 중…'
                        : '에이전트 작업 중…')}
                  </span>
                </div>
                <button
                  type="button"
                  className="ghost-btn btn-with-icon variant-dock__abort"
                  onClick={abortGeneration}
                  aria-label={
                    autoReviewBusy ? '일괄 검수 중지' : '수정 중지'
                  }
                >
                  <Square size={12} fill="currentColor" aria-hidden />
                  중지
                </button>
              </div>
              {!autoReviewBusy ? (
                <AgentStepTrail steps={liveTrail.steps} />
              ) : null}
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
            disabled={dockBusy}
            allowImages={false}
            placeholder={
              autoReviewBusy
                ? '일괄 자동 검수 진행 중 — 완료 후 입력 가능'
                : '수정 요청 · Enter 전송 · Shift+Enter 줄바꿈'
            }
          />
          <div className="variant-dock__actions">
            {dockBusy ? (
              <button
                type="button"
                className="ghost-btn btn-with-icon variant-dock__abort"
                onClick={abortGeneration}
                aria-label={
                  autoReviewBusy ? '일괄 검수 중지' : '수정 중지'
                }
              >
                <Square size={12} fill="currentColor" aria-hidden />
                중지
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={dockBusy}
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
              disabled={dockBusy}
              onClick={() =>
                void send({
                  text: '도구는 이미 연결되어 있습니다. 계획만 쓰지 말고 즉시 list_project_csvs/set_dataset_code 또는 set_transform_code → run_* → save_generated_assets → set_answer_code → run_answer_code → set_short_answers → apply_changes(confirm=true)를 호출해 이 문제에 반영하세요. CSV와 정답이 어긋나면 CSV를 재생성·검증한 뒤 적용하세요.',
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
