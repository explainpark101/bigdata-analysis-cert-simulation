import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Save, Square, Wand2 } from 'lucide-react';
import { loadAiSettings } from '@/lib/aiSettings';
import { runAuthorAgentTurn } from '@/lib/ai/authorAgent';
import { applyCsvRenamesToDraftFields } from '@/lib/ai/csvAssetPersist';
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
  const [liveStatus, setLiveStatus] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const messagesRef = useRef(messages);
  const abortRef = useRef<AbortController | null>(null);
  const bodyIdPrefix = useId();
  draftRef.current = draft;
  messagesRef.current = messages;

  useEffect(() => {
    return () => {
      abortRef.current?.abort(
        new DOMException('Generation aborted', 'AbortError'),
      );
      abortRef.current = null;
    };
  }, []);

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
  }, [messages, busy, liveStatus]);

  const abortGeneration = () => {
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
    if (busy) return;
    setDraft(emptyModifyDraft(problem));
    setError('');
  };

  const send = async (opts?: { text?: string; clearComposer?: boolean }) => {
    const clearComposer = opts?.clearComposer ?? opts?.text == null;
    const trimmed = (opts?.text ?? input).trim();
    if (!trimmed || busy) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const historyBefore = messagesRef.current;
    const userMsg = buildUserMessage(trimmed);
    setMessages([...historyBefore, userMsg]);
    if (clearComposer) setInput('');
    setBusy(true);
    setError('');
    setLiveStatus('요청 준비 중…');

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
      setLiveStatus('');
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
              변형한 뒤 단답을 맞춰줘&quot;. 출제 도구는 이 채팅에 이미
              연결되어 있습니다.
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
            <div
              className="variant-dock__live"
              role="progressbar"
              aria-busy="true"
              aria-valuetext={liveStatus || '에이전트 작업 중'}
            >
              <div className="variant-dock__busy-row">
                <div className="variant-dock__busy">
                  <Loader2 size={14} className="spin" />
                  <span>{liveStatus || '에이전트 작업 중…'}</span>
                </div>
                <button
                  type="button"
                  className="ghost-btn btn-with-icon variant-dock__abort"
                  onClick={abortGeneration}
                  aria-label="수정 중지"
                >
                  <Square size={12} fill="currentColor" aria-hidden />
                  중지
                </button>
              </div>
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
            {busy ? (
              <button
                type="button"
                className="ghost-btn btn-with-icon variant-dock__abort"
                onClick={abortGeneration}
                aria-label="수정 중지"
              >
                <Square size={12} fill="currentColor" aria-hidden />
                중지
              </button>
            ) : null}
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
