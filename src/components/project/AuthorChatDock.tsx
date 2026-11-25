import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import {
  Eraser,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Square,
} from 'lucide-react';
import { loadAiSettings } from '@/lib/aiSettings';
import {
  isDraftReadyForSave,
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
  normalizeAuthorDraft,
  loadAuthorSession,
  saveAuthorSession,
  type AuthorDraft,
} from '@/lib/ai/authorChatStore';
import {
  authorDifficultyPromptKo,
  authorRuntimeEnvPromptKo,
  authorType13AnswerFormatPromptKo,
  authorType2BandPromptKo,
} from '@/lib/ai/authorRuntimePrompt';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';
import {
  OFFICIAL_AUTOGEN_SEQUENCE,
  OFFICIAL_COUNTS,
  OFFICIAL_POINTS_PER_ITEM,
  OFFICIAL_TOTAL_ITEMS,
  countBankByType,
  isOfficialStructure,
  takeAllOrRandom,
} from '@/lib/examOfficialSpec';
import { ConfirmModal } from '@/components/exam/ConfirmModal';
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
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
  onSaveProblem: (partial: Partial<BankProblem>) => BankProblem;
  onSaved: (
    problem: BankProblem,
    opts?: { navigate?: boolean },
  ) => void;
  /** After 1·2·3 auto-gen succeeds, assemble an exam paper from the new problems. */
  onAssembleExam?: (
    problems: BankProblem[],
    opts?: { navigate?: boolean },
  ) => void;
}

const AUTO_EXAM_COUNT_MIN = 1;
const AUTO_EXAM_COUNT_MAX = 10;

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

/** Cap context size while still covering the bank. */
const AUTO_REF_MAX = 16;

/**
 * Pick bank problems to feed the author agent for a given task type.
 * - Prefer user selection when present (always kept).
 * - Fill with same-type (then other-type) peers.
 * - If the candidate set fits in `max`, take all; otherwise random sample.
 * - Exclude ids from the current auto-gen batch (avoid copying ourselves).
 */
function pickReferencesForSituation(
  bank: BankProblem[],
  taskType: TaskType,
  selectedIds: string[],
  excludeIds: Iterable<string>,
  max = AUTO_REF_MAX,
): string[] {
  const exclude = new Set(excludeIds);
  const pool = bank.filter((b) => !exclude.has(b.id));
  if (!pool.length) return [];

  const selected = pool.filter((b) => selectedIds.includes(b.id));
  const sameType = pool.filter((b) => b.taskType === taskType);
  const otherType = pool.filter((b) => b.taskType !== taskType);

  const merged = new Map<string, BankProblem>();
  if (selected.length) {
    for (const b of selected) merged.set(b.id, b);
    for (const b of sameType) merged.set(b.id, b);
    for (const b of otherType) merged.set(b.id, b);
  } else if (sameType.length) {
    for (const b of sameType) merged.set(b.id, b);
    for (const b of otherType) merged.set(b.id, b);
  } else {
    for (const b of pool) merged.set(b.id, b);
  }

  const same = [...merged.values()].filter((b) => b.taskType === taskType);
  const other = [...merged.values()].filter((b) => b.taskType !== taskType);
  const candidates = [...same, ...other];

  if (candidates.length <= max) {
    return candidates.map((b) => b.id);
  }

  // Always keep user-selected refs when possible, then random-fill.
  const selectedSet = new Set(selected.map((b) => b.id));
  const kept = candidates.filter((b) => selectedSet.has(b.id)).slice(0, max);
  const rest = candidates.filter((b) => !selectedSet.has(b.id));
  const need = max - kept.length;
  const filled = need > 0 ? takeAllOrRandom(rest, need) : [];
  return [...kept.map((b) => b.id), ...filled.map((b) => b.id)];
}

function autoPromptForType(
  taskType: TaskType,
  refCount: number,
  ordinalInType: number,
  refMode: 'selected' | 'auto',
): string {
  const pts = OFFICIAL_POINTS_PER_ITEM[taskType];
  const refLine =
    refMode === 'auto'
      ? `문제은행에서 상황에 맞게 가져온 참고 문제 ${refCount}개(제${taskType}유형 우선)를 분석한 뒤, 빅데이터분석기사 실기(제13회 가이드) 작업형 ${taskType}유형 새 문항을 작성·저장하세요.`
      : `선택된 참고 문제 ${refCount}개를 분석한 뒤, 빅데이터분석기사 실기(제13회 가이드) 작업형 ${taskType}유형 새 문항을 작성·저장하세요.`;
  return [
    refLine,
    `이번 생성은 제${taskType}유형 ${ordinalInType}/${OFFICIAL_COUNTS[taskType]}번째 · 문항 배점 ${pts}점입니다.`,
    '',
    '## 참고 분석',
    '- list_references → get_reference 로 참고 문항의 도메인·스키마·요구 스킬·답안 형식을 파악하세요.',
    '- 같은 유형 참고를 우선 보고, 다른 유형은 스킬·난이도만 참고하세요.',
    '- 같은 스킬군/시험 의도를 유지하되, 스토리·컬럼명·시드·분포·문구는 완전히 새로 만드세요. 베끼지 마세요.',
    '',
    authorRuntimeEnvPromptKo(),
    '',
    authorDifficultyPromptKo({
      // Last type-1/3 item in a paper leans formula / custom-metric hard.
      preferHard:
        taskType !== 2 && ordinalInType >= OFFICIAL_COUNTS[taskType],
    }),
    '- 단순 사칙/한 줄 집계 장난감 문제는 금지합니다.',
    '- 결측·형변환·그룹집계·피처/인코딩·모델지표·가설검정 등 실기에서 쓰는 다단계 파이프라인을 포함하세요.',
    `- update_draft로 task_type=${taskType} 를 먼저 설정하세요.`,
    '',
    '## 데이터 설계 판단 (필수)',
    '- 참고/프로젝트에 쓸 만한 CSV가 있으면 MUTATE, 없으면 SYNTHESIZE를 고르세요. 한 줄로 선택 이유를 말한 뒤 진행하세요.',
    '- MUTATE: list_project_csvs → preview_csv_asset → set_transform_code(python|r) → run_transform_code → save_generated_assets',
    '  (컬럼명 변경·결측 주입·리샘플·분포 이동·train/test 재분할 등으로 스킬은 유지하고 내용은 새로 만드세요. 원본을 draft에 그대로 붙이지 마세요.)',
    '- SYNTHESIZE: set_dataset_code → run_dataset_code → save_generated_assets (고정 시드로 out/*.csv 신규 생성)',
    '- xlsx/parquet/json/txt 테이블 금지. 문제 본문에 CSV 파일명을 명시하세요.',
    '',
    taskType === 1 || taskType === 3
      ? authorType13AnswerFormatPromptKo()
      : '',
    taskType === 2 ? authorType2BandPromptKo() : '',
    '',
    '## 유형별 마무리',
    taskType === 2
      ? '- 2유형(40점): 본문에 채점 구간표 + 제출 형식. grading에 SCORE_BANDS(또는 EARNED_POINTS). 모델링은 sklearn/xgboost/lightgbm(또는 R 허용 스택) 기준.'
      : `- ${taskType}유형(${pts}점): 본문에 반올림/절사·자리수 명시 → set_answer_code → run_answer_code → set_short_answers(숫자만). 제출은 별도 답안 제출 화면(단답)입니다.`,
    '- 마지막에 반드시 save_problem(confirm=true). 저장 없이 끝내면 실패입니다.',
    '- 이번 턴에서는 해당 유형 하나만 작업·저장하세요.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

/** AbortSignal.throwIfAborted is missing on some WebViews — polyfill inline. */
function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (typeof signal.throwIfAborted === 'function') {
    signal.throwIfAborted();
  }
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException('Generation aborted', 'AbortError');
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
  onAssembleExam,
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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [examCountOpen, setExamCountOpen] = useState(false);
  const [examCountInput, setExamCountInput] = useState('1');
  const examCountInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  const messagesRef = useRef(messages);
  const projectRef = useRef(project);
  const referenceIdsRef = useRef(referenceIds);
  const busyRef = useRef(false);
  const liveStreamRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const bodyIdPrefix = useId();
  draftRef.current = draft;
  messagesRef.current = messages;
  projectRef.current = project;
  referenceIdsRef.current = referenceIds;

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
        onDraftChange(normalizeAuthorDraft(stored.draft));
        // Do not clobber refs the user already picked while this load was in flight
        // (otherwise the 123 button stays disabled / generation sees empty refs).
        if (referenceIdsRef.current.length === 0) {
          onReferenceIdsChange?.(stored.referenceIds ?? []);
        }
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
      ? `참고 ${n}개 선택(자동 생성 시 같은 유형 은행 문제와 함께 사용) · ${web}`
      : `자동 생성은 문제은행을 유형별로 자동 참고합니다. 원하면 좌측에서 강조할 참고를 고르세요. ${web}`;
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
    requireSave?: boolean;
    /** Locked refs for batch auto-gen (avoids session-restore races). */
    referenceIds?: string[];
  }) => {
    setLiveStatus('요청 준비 중…');
    setStream('');
    setLiveTools([]);
    const settings = await loadAiSettings();
    throwIfAborted(opts.signal);
    const result = await runAuthorAgentTurn({
      ctx: {
        settings,
        project: projectRef.current,
        draft: opts.draftOverride ?? draftRef.current,
        referenceIds: opts.referenceIds ?? referenceIdsRef.current,
        addProjectAssets,
      },
      history: opts.history,
      userText: opts.userText,
      userImages: opts.images ?? [],
      onDraft: onDraftChange,
      onSave: onSaveProblem,
      onProgress: handleProgress,
      signal: opts.signal,
      requireSave: opts.requireSave,
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
    if ((!userText && !images.length) || busyRef.current) return;

    const historyBefore = messagesRef.current;
    const userMsg = buildUserMessage(userText, images);
    setMessages([...historyBefore, userMsg]);
    if (clearComposer) {
      setInput('');
      setAttachments([]);
    }
    const ctrl = beginAbortable();
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
      setStream('');
      setLiveTools([]);
    }
  };

  const clampExamCount = (raw: string): number => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return AUTO_EXAM_COUNT_MIN;
    return Math.min(AUTO_EXAM_COUNT_MAX, Math.max(AUTO_EXAM_COUNT_MIN, n));
  };

  const openExamCountPrompt = () => {
    if (busyRef.current) return;
    if (!projectRef.current.bank.length) {
      setError(
        '문제은행이 비어 있습니다. ZIP 병합이나 문제 추가 후 다시 시도하세요.',
      );
      return;
    }
    setExamCountInput('1');
    setExamCountOpen(true);
    window.setTimeout(() => examCountInputRef.current?.select(), 0);
  };

  const generateAllTypes = async (examCountIn: number) => {
    if (busyRef.current) return;
    const examCount = clampExamCount(String(examCountIn));
    const preferredIds = [...referenceIdsRef.current];
    if (!projectRef.current.bank.length) {
      setError(
        '문제은행이 비어 있습니다. ZIP 병합이나 문제 추가 후 다시 시도하세요.',
      );
      return;
    }

    const ctrl = beginAbortable();
    busyRef.current = true;
    setBusy(true);
    setError('');
    setExamCountOpen(false);
    let history = messagesRef.current;
    const excludeCreated = new Set<string>();
    let assembledPapers = 0;

    try {
      for (let paper = 0; paper < examCount; paper++) {
        throwIfAborted(ctrl.signal);
        const savedProblems: BankProblem[] = [];
        const typeOrdinal: Record<TaskType, number> = { 1: 0, 2: 0, 3: 0 };
        const paperLabel = `${paper + 1}/${examCount}`;

        history = [
          ...history,
          {
            role: 'assistant',
            content: `—— 시험지 ${paperLabel} 자동 생성 시작 (공식 3+1+2) ——`,
          },
        ];
        setMessages(history);

        for (let i = 0; i < OFFICIAL_AUTOGEN_SEQUENCE.length; i++) {
          const taskType = OFFICIAL_AUTOGEN_SEQUENCE[i];
          typeOrdinal[taskType] += 1;
          const ordinalInType = typeOrdinal[taskType];
          throwIfAborted(ctrl.signal);

          const bankNow = projectRef.current.bank;
          const turnRefs = pickReferencesForSituation(
            bankNow,
            taskType,
            preferredIds,
            excludeCreated,
          );
          if (!turnRefs.length) {
            setError(
              `제${taskType}유형 참고 문제를 찾을 수 없습니다. 문제은행에 문항을 추가하세요.`,
            );
            break;
          }
          const refMode = preferredIds.length ? 'selected' : 'auto';
          onReferenceIdsChange?.(turnRefs);

          const prompt = autoPromptForType(
            taskType,
            turnRefs.length,
            ordinalInType,
            refMode,
          );
          const userMsg = buildUserMessage(prompt, []);
          const historyBefore = history;
          history = [...historyBefore, userMsg];
          setMessages(history);
          onDraftChange(emptyAuthorDraft(taskType));
          draftRef.current = emptyAuthorDraft(taskType);

          setLiveStatus(
            `시험지 ${paperLabel} · 제${taskType}유형 ${ordinalInType}/${OFFICIAL_COUNTS[taskType]} · 참고 ${turnRefs.length}개 · 생성 중… (${savedProblems.length + 1}/${OFFICIAL_TOTAL_ITEMS})`,
          );
          setStream('');
          setLiveTools([]);

          let result = await runTurn({
            userText: prompt,
            history: historyBefore,
            draftOverride: emptyAuthorDraft(taskType),
            signal: ctrl.signal,
            requireSave: true,
            referenceIds: turnRefs,
          });

          if (!result.savedProblem) {
            throwIfAborted(ctrl.signal);
            setLiveStatus(
              `시험지 ${paperLabel} · 제${taskType}유형 저장 재시도…`,
            );
            const savePrompt =
              '추가 수정 없이 지금 초안으로 save_problem(confirm=true)만 호출하세요.';
            const saveUser = buildUserMessage(savePrompt, []);
            history = [...result.messages, saveUser];
            setMessages(history);
            result = await runTurn({
              userText: savePrompt,
              history: result.messages,
              draftOverride: result.draft,
              signal: ctrl.signal,
              requireSave: true,
              referenceIds: turnRefs,
            });
          }

          if (!result.savedProblem && isDraftReadyForSave(result.draft)) {
            setLiveStatus(
              `시험지 ${paperLabel} · 제${taskType}유형 초안 직접 저장…`,
            );
            const created = onSaveProblem({
              title: result.draft.title,
              note: result.draft.note,
              showNoteOnExam: false,
              taskType: result.draft.taskType,
              kind: 'submit',
              language: result.draft.language,
              markdown: result.draft.markdown,
              answerCode: result.draft.answerCode,
              gradingCode: result.draft.gradingCode,
              datasetCode: result.draft.datasetCode || undefined,
              assetIds: result.draft.assetIds,
              sourceProblemId: turnRefs[0],
              submitFormat: result.draft.taskType === 2 ? 'csv' : 'short',
              submitFile:
                result.draft.taskType === 2 ? 'result.csv' : undefined,
              shortAnswers:
                result.draft.taskType === 2
                  ? undefined
                  : result.draft.shortAnswers,
              shortAnswer:
                result.draft.taskType === 2
                  ? ''
                  : (result.draft.shortAnswers[0] ?? ''),
            });
            result = {
              ...result,
              savedProblem: created,
              messages: [
                ...result.messages,
                {
                  role: 'assistant',
                  content: `클라이언트가 초안을 저장했습니다: ${created.title}`,
                },
              ],
            };
          }

          history = result.messages;
          setMessages(history);
          onDraftChange(result.draft);
          draftRef.current = result.draft;

          if (result.savedProblem) {
            savedProblems.push(result.savedProblem);
            excludeCreated.add(result.savedProblem.id);
            onSaved(result.savedProblem, { navigate: false });
            const nextType =
              OFFICIAL_AUTOGEN_SEQUENCE[i + 1] ??
              (taskType < 3 ? ((taskType + 1) as TaskType) : 1);
            const nextDraft = emptyAuthorDraft(nextType);
            onDraftChange(nextDraft);
            draftRef.current = nextDraft;
          } else {
            setError(
              `시험지 ${paperLabel} · 제${taskType}유형 저장에 실패했습니다. 초안(본문·정답)이 충분히 채워지지 않았을 수 있습니다.`,
            );
            break;
          }
        }

        let summary =
          savedProblems.length > 0
            ? `시험지 ${paperLabel} 생성 완료 (${savedProblems.length}/${OFFICIAL_TOTAL_ITEMS}):\n${savedProblems
                .map((p, i) => `${i + 1}. [제${p.taskType}유형] ${p.title}`)
                .join('\n')}`
            : `시험지 ${paperLabel}: 저장된 문항이 없습니다.`;

        const counts = countBankByType(savedProblems);
        if (savedProblems.length > 0 && onAssembleExam) {
          setLiveStatus(`시험지 ${paperLabel} 조립 중…`);
          try {
            const isLast = paper === examCount - 1;
            onAssembleExam(
              [...savedProblems].sort(
                (a, b) =>
                  a.taskType - b.taskType || a.title.localeCompare(b.title),
              ),
              { navigate: isLast },
            );
            assembledPapers += 1;
            if (isOfficialStructure(counts)) {
              summary +=
                '\n\n시험 조립 완료: 공식 구성(1유형 3 · 2유형 1 · 3유형 2).';
            } else {
              summary += `\n\n시험 조립 완료 (부분): 1유형 ${counts[1]} · 2유형 ${counts[2]} · 3유형 ${counts[3]} / 목표 3+1+2.`;
            }
          } catch (assembleErr) {
            setError(
              assembleErr instanceof Error
                ? assembleErr.message
                : String(assembleErr),
            );
            summary += '\n\n시험 조립에 실패했습니다.';
          }
        }

        history = [
          ...history,
          { role: 'assistant', content: summary },
        ];
        setMessages(history);

        if (savedProblems.length === 0) break;
      }

      clearLive();
      void playCompletionSound();
      if (assembledPapers > 0) {
        history = [
          ...history,
          {
            role: 'assistant',
            content: `전체 완료: 시험지 ${assembledPapers}/${examCount}장 조립했습니다.`,
          },
        ];
        setMessages(history);
      }
    } catch (err) {
      handleAbortCatch(err);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
      setStream('');
      setLiveTools([]);
      setLiveStatus('');
    }
  };

  const resend = (m: ChatMessage) => {
    const { text, images } = extractUserPayload(m);
    void send({ text, images, clearComposer: false });
  };

  const clearChat = async () => {
    abortRef.current?.abort(
      new DOMException('Generation aborted', 'AbortError'),
    );
    abortRef.current = null;
    setMessages([]);
    setInput('');
    setAttachments([]);
    setError('');
    clearLive();
    busyRef.current = false;
    setBusy(false);
    setClearConfirmOpen(false);
    await clearAuthorSession(project.id);
    void saveAuthorSession({
      projectId: project.id,
      referenceIds,
      messages: [],
      draft: draftRef.current,
      updatedAt: new Date().toISOString(),
    });
  };

  const canClearChat =
    messages.some((m) => m.role === 'user' || m.role === 'assistant') ||
    Boolean(input.trim()) ||
    attachments.length > 0 ||
    Boolean(error);

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
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            disabled={!canClearChat && !busy}
            title="채팅 메시지 비우기"
            aria-label="채팅 비우기"
            onClick={() => setClearConfirmOpen(true)}
          >
            <Eraser size={14} aria-hidden />
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
              disabled={busy || project.bank.length === 0}
              title={
                project.bank.length
                  ? '시험지 장수를 고른 뒤, 문제은행을 참고해 공식 6문항(3+1+2)씩 생성·조립'
                  : '문제은행에 문항이 필요합니다'
              }
              onClick={openExamCountPrompt}
            >
              <Layers size={14} />
              1·2·3 자동 생성·조립 (3+1+2)
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
      <ConfirmModal
        open={clearConfirmOpen}
        title="채팅 비우기"
        message={
          busy
            ? '진행 중인 생성을 중지하고 채팅 메시지를 모두 지울까요? 제작 초안·참고 선택은 유지됩니다.'
            : '채팅 메시지를 모두 지울까요? 제작 초안·참고 선택은 유지됩니다.'
        }
        confirmLabel="비우기"
        confirmDanger
        onConfirm={() => void clearChat()}
        onCancel={() => setClearConfirmOpen(false)}
      />
      <ExamCountDialog
        open={examCountOpen}
        value={examCountInput}
        inputRef={examCountInputRef}
        onChange={setExamCountInput}
        onCancel={() => setExamCountOpen(false)}
        onConfirm={() => {
          const n = clampExamCount(examCountInput);
          setExamCountInput(String(n));
          void generateAllTypes(n);
        }}
      />
    </aside>
  );
}

function ExamCountDialog({
  open,
  value,
  inputRef,
  onChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    onConfirm();
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClose={() => {
        if (open) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form className="confirm-dialog__panel" onSubmit={submit}>
        <header className="modal__header">
          <h2 id={titleId}>시험지 몇 장을 만들까요?</h2>
        </header>
        <div className="modal__body">
          <p style={{ margin: '0 0 10px', lineHeight: 1.55 }}>
            각 시험지마다 공식 구성(1유형 3 · 2유형 1 · 3유형 2)으로 문항을
            생성·조립합니다. ({AUTO_EXAM_COUNT_MIN}–{AUTO_EXAM_COUNT_MAX}장)
          </p>
          <label className="screen-settings-field">
            <span>시험지 수</span>
            <input
              ref={inputRef}
              className="ce-field__input"
              type="number"
              min={AUTO_EXAM_COUNT_MIN}
              max={AUTO_EXAM_COUNT_MAX}
              step={1}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoFocus
            />
          </label>
        </div>
        <footer className="modal__footer">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="primary-btn">
            생성 시작
          </button>
        </footer>
      </form>
    </dialog>
  );
}
