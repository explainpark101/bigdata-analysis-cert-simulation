import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Layers, Loader2, RefreshCw, Save, Sparkles, Square } from 'lucide-react';
import { loadAiSettings } from '@/lib/aiSettings';
import {
  runAuthorAgentTurn,
  type AuthorAgentProgress,
} from '@/lib/ai/authorAgent';
import { playCompletionSound } from '@/lib/ai/completionSound';
import {
  chatContentToText,
  type ChatContentPart,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';
import {
  clearAuthorSession,
  emptyAuthorDraft,
  loadAuthorSession,
  saveAuthorSession,
  type AuthorDraft,
} from '@/lib/ai/authorChatStore';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import {
  ChatComposer,
  type ChatAttachment,
} from '@/components/ui/ChatComposer';
import { CopyButton } from '@/components/ui/CopyButton';

interface AuthorChatDockProps {
  project: AuthoringProject;
  referenceIds: string[];
  onReferenceIdsChange?: (ids: string[]) => void;
  draft: AuthorDraft;
  onDraftChange: (draft: AuthorDraft) => void;
  width: number;
  onWidthChange: (w: number) => void;
  maxWidth: number;
  addProjectAssets: (assets: ProjectAsset[]) => ProjectAsset[];
  onSaveProblem: (partial: Partial<BankProblem>) => BankProblem;
  onSaved: (
    problem: BankProblem,
    opts?: { navigate?: boolean },
  ) => void;
}

type UserImage = { dataUrl: string; name: string };

function buildUserMessage(text: string, images: UserImage[]): ChatMessage {
  const parts: ChatContentPart[] = [];
  const trimmed = text.trim();
  if (trimmed) parts.push({ type: 'text', text: trimmed });
  for (const img of images) {
    parts.push({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    });
  }
  if (!parts.length) parts.push({ type: 'text', text: '(empty)' });
  return {
    role: 'user',
    content:
      parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
  };
}

function extractUserPayload(m: ChatMessage): {
  text: string;
  images: UserImage[];
} {
  const text = chatContentToText(m.content);
  const images: UserImage[] =
    Array.isArray(m.content)
      ? m.content
          .filter(
            (p): p is Extract<ChatContentPart, { type: 'image_url' }> =>
              p.type === 'image_url',
          )
          .map((p, i) => ({
            dataUrl: p.image_url.url,
            name: `image-${i + 1}`,
          }))
      : [];
  return { text, images };
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
  if (m.role === 'user') {
    const text = chatContentToText(m.content);
    const images =
      Array.isArray(m.content)
        ? m.content.filter((p) => p.type === 'image_url').length
        : 0;
    if (images && text) return `${text}\n⟪이미지 ${images}개⟫`;
    if (images) return `⟪이미지 ${images}개⟫`;
    return text;
  }
  if (m.role === 'tool') {
    const raw = chatContentToText(m.content);
    return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
  }
  return '';
}

function autoPromptForType(taskType: TaskType, refCount: number): string {
  return [
    `선택된 참고 문제 ${refCount}개 전체를 바탕으로 작업형 ${taskType}유형 새 문항을 처음부터 작성하세요.`,
    `- update_draft로 task_type=${taskType} 를 먼저 설정하세요.`,
    '- 참고 문제는 스타일·스킬·난이도만 참고하고 문구·데이터·정답을 베끼지 마세요.',
    '- 1·3유형: set_answer_code → run_answer_code → set_short_answers 로 정답을 확정하세요.',
    '- 2유형: set_dataset_code → run_dataset_code → save_generated_assets 후 grading을 채우세요.',
    '- 초안이 완성되면 save_problem(confirm=true)로 문제은행에 저장하세요.',
    '- 이번 턴에서는 해당 유형 하나만 작업·저장하세요.',
  ].join('\n');
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

export function AuthorChatDock({
  project,
  referenceIds,
  onReferenceIdsChange,
  draft,
  onDraftChange,
  width,
  onWidthChange,
  maxWidth,
  addProjectAssets,
  onSaveProblem,
  onSaved,
}: AuthorChatDockProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [liveStatus, setLiveStatus] = useState('');
  const [liveStream, setLiveStream] = useState('');
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const messagesRef = useRef(messages);
  const liveStreamRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const bodyIdPrefix = useId();
  draftRef.current = draft;
  messagesRef.current = messages;

  const setStream = (value: string | ((prev: string) => string)) => {
    setLiveStream((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      liveStreamRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadAuthorSession(project.id);
      if (cancelled) return;
      if (stored) {
        setMessages(stored.messages);
        onDraftChange(stored.draft);
        onReferenceIdsChange?.(stored.referenceIds ?? []);
      } else {
        setMessages([]);
        onDraftChange(emptyAuthorDraft(1));
      }
      setError('');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Load once per project id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (!ready) return;
    void saveAuthorSession({
      projectId: project.id,
      referenceIds,
      messages,
      draft,
      updatedAt: new Date().toISOString(),
    });
  }, [ready, project.id, referenceIds, messages, draft]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy, liveStream, liveStatus]);

  const hint = useMemo(() => {
    const n = referenceIds.length;
    const web =
      '필요하면 웹 검색·문서 조회(web_search / fetch_url)로 자료를 가져옵니다.';
    return n
      ? `참고 문제 ${n}개 선택 · ${web}`
      : `좌측에서 참고 문제를 고르거나, 새 문항 아이디어를 말해 주세요. ${web}`;
  }, [referenceIds.length]);

  const handleProgress = (event: AuthorAgentProgress) => {
    if (event.kind === 'status') {
      setLiveStatus(event.text);
      return;
    }
    if (event.kind === 'assistant_delta') {
      setLiveStatus((s) =>
        s.startsWith('모델 응답') || s.startsWith('요청')
          ? '응답 스트리밍 중…'
          : s,
      );
      setStream((prev) => prev + event.text);
      return;
    }
    if (event.kind === 'tool' && event.phase === 'start') {
      setLiveTools((prev) =>
        prev.includes(event.name) ? prev : [...prev, event.name],
      );
      setStream('');
    }
  };

  const beginAbortable = () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    return ctrl;
  };

  const clearLive = () => {
    setLiveStatus('');
    setStream('');
    setLiveTools([]);
  };

  const handleAbortCatch = (err: unknown) => {
    if (isAbortError(err)) {
      const partial = liveStreamRef.current.trim();
      if (partial) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `${partial}\n\n(중지됨)` },
        ]);
      }
      setError('생성을 중지했습니다.');
      clearLive();
      return;
    }
    setError(err instanceof Error ? err.message : String(err));
    setLiveStatus('');
  };

  const abortGeneration = () => {
    const ctrl = abortRef.current;
    if (!ctrl || ctrl.signal.aborted) return;
    setLiveStatus('중지 중…');
    ctrl.abort(new DOMException('Generation aborted', 'AbortError'));
  };

  const runTurn = async (opts: {
    userText: string;
    images?: UserImage[];
    history: ChatMessage[];
    draftOverride?: AuthorDraft;
    signal: AbortSignal;
  }) => {
    setLiveStatus('요청 준비 중…');
    setStream('');
    setLiveTools([]);
    const settings = await loadAiSettings();
    opts.signal.throwIfAborted();
    const result = await runAuthorAgentTurn({
      ctx: {
        settings,
        project,
        draft: opts.draftOverride ?? draftRef.current,
        referenceIds,
        addProjectAssets,
      },
      history: opts.history,
      userText: opts.userText,
      userImages: opts.images ?? [],
      onDraft: onDraftChange,
      onSave: onSaveProblem,
      onProgress: handleProgress,
      signal: opts.signal,
    });
    return result;
  };

  const send = async (opts?: {
    text?: string;
    images?: UserImage[];
    clearComposer?: boolean;
    navigateOnSave?: boolean;
    draftOverride?: AuthorDraft;
  }) => {
    const clearComposer = opts?.clearComposer ?? opts?.text == null;
    const images =
      opts?.images ??
      (clearComposer
        ? attachments.map((a) => ({ dataUrl: a.dataUrl, name: a.name }))
        : []);
    const trimmed = (opts?.text ?? input).trim();
    const userText =
      trimmed || (images.length ? '첨부 이미지를 참고해 주세요.' : '');
    if ((!userText && !images.length) || busy) return;

    const historyBefore = messagesRef.current;
    const userMsg = buildUserMessage(userText, images);
    setMessages([...historyBefore, userMsg]);
    if (clearComposer) {
      setInput('');
      setAttachments([]);
    }
    const ctrl = beginAbortable();
    setBusy(true);
    setError('');

    try {
      const result = await runTurn({
        userText,
        images,
        history: historyBefore,
        draftOverride: opts?.draftOverride,
        signal: ctrl.signal,
      });
      setMessages(result.messages);
      onDraftChange(result.draft);
      clearLive();
      void playCompletionSound();
      if (result.savedProblem) {
        const navigate = opts?.navigateOnSave !== false;
        onSaved(result.savedProblem, { navigate });
        if (navigate) {
          await clearAuthorSession(project.id);
          setMessages([]);
          onDraftChange(emptyAuthorDraft(result.draft.taskType));
        } else {
          onDraftChange(emptyAuthorDraft(result.draft.taskType));
        }
      }
    } catch (err) {
      handleAbortCatch(err);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      setStream('');
      setLiveTools([]);
    }
  };

  const generateAllTypes = async () => {
    if (busy) return;
    if (!referenceIds.length) {
      setError('먼저 참고 문제를 하나 이상 선택하세요.');
      return;
    }

    const ctrl = beginAbortable();
    setBusy(true);
    setError('');
    let history = messagesRef.current;
    const savedTitles: string[] = [];

    try {
      for (const taskType of [1, 2, 3] as TaskType[]) {
        ctrl.signal.throwIfAborted();
        const prompt = autoPromptForType(taskType, referenceIds.length);
        const userMsg = buildUserMessage(prompt, []);
        const historyBefore = history;
        history = [...historyBefore, userMsg];
        setMessages(history);
        onDraftChange(emptyAuthorDraft(taskType));
        draftRef.current = emptyAuthorDraft(taskType);

        setLiveStatus(`${taskType}유형 자동 생성 중…`);
        setStream('');
        setLiveTools([]);

        const result = await runTurn({
          userText: prompt,
          history: historyBefore,
          draftOverride: emptyAuthorDraft(taskType),
          signal: ctrl.signal,
        });

        history = result.messages;
        setMessages(history);
        onDraftChange(result.draft);
        draftRef.current = result.draft;

        if (result.savedProblem) {
          savedTitles.push(result.savedProblem.title);
          onSaved(result.savedProblem, { navigate: false });
          const nextDraft = emptyAuthorDraft(
            taskType < 3 ? ((taskType + 1) as TaskType) : 1,
          );
          onDraftChange(nextDraft);
          draftRef.current = nextDraft;
        } else {
          setError(
            `${taskType}유형 저장에 실패했습니다. 에이전트가 save_problem을 호출하지 않았을 수 있습니다.`,
          );
          break;
        }
      }

      clearLive();
      void playCompletionSound();
      if (savedTitles.length) {
        history = [
          ...history,
          {
            role: 'assistant',
            content: `자동 생성 완료 (${savedTitles.length}/3):\n${savedTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
          },
        ];
        setMessages(history);
      }
    } catch (err) {
      handleAbortCatch(err);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      setStream('');
      setLiveTools([]);
    }
  };

  const resend = (m: ChatMessage) => {
    const { text, images } = extractUserPayload(m);
    void send({ text, images, clearComposer: false });
  };

  return (
    <aside
      className="variant-dock author-dock"
      style={{ width, flexBasis: width }}
      aria-label="문제 제작 AI"
    >
      <div className="variant-dock__inner">
        <header className="variant-dock__head">
          <div>
            <strong className="variant-dock__title">
              <Sparkles size={14} aria-hidden />
              문제 제작 채팅
            </strong>
            <p className="variant-dock__sub">{hint}</p>
          </div>
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
            .length && !busy ? (
            <p className="variant-dock__empty">
              예: &quot;참고 1유형처럼 결측 처리 후 중앙값을 묻는 새 문항 만들어줘&quot;
              / 이미지를 첨부해 표·그래프를 설명할 수도 있습니다.
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
                            onClick={() => resend(m)}
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
                    {m.role === 'user' && Array.isArray(m.content)
                      ? m.content
                          .filter((p) => p.type === 'image_url')
                          .map((p, j) =>
                            p.type === 'image_url' ? (
                              <img
                                key={j}
                                className="author-dock__msg-image"
                                src={p.image_url.url}
                                alt=""
                              />
                            ) : null,
                          )
                      : null}
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
                  aria-label="생성 중지"
                >
                  <Square size={12} fill="currentColor" aria-hidden />
                  중지
                </button>
              </div>
              {liveTools.length ? (
                <ul className="variant-dock__live-tools">
                  {liveTools.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : null}
              {liveStream ? (
                <pre className="variant-msg__body variant-dock__live-stream">
                  {liveStream}
                  <span className="variant-dock__caret" aria-hidden>
                    ▍
                  </span>
                </pre>
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
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSubmit={() => void send()}
            disabled={busy}
            placeholder="Enter 전송 · Shift+Enter 줄바꿈 · 이미지 첨부 가능"
          />
          <div className="variant-dock__actions">
            {busy ? (
              <button
                type="button"
                className="ghost-btn btn-with-icon variant-dock__abort"
                onClick={abortGeneration}
              >
                <Square size={12} fill="currentColor" aria-hidden />
                중지
              </button>
            ) : null}
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={busy || !referenceIds.length}
              title={
                referenceIds.length
                  ? '선택 참고 문제로 1·2·3유형을 순서대로 생성·저장'
                  : '참고 문제를 먼저 선택하세요'
              }
              onClick={() => void generateAllTypes()}
            >
              <Layers size={14} />
              1·2·3 자동 생성
            </button>
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={busy}
              onClick={() =>
                void send({
                  text: '초안을 검토하고 save_problem(confirm=true)로 문제은행에 저장해 주세요.',
                  images: [],
                  clearComposer: false,
                })
              }
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
        label="문제 제작 채팅 Dock 너비 조절"
      />
    </aside>
  );
}
