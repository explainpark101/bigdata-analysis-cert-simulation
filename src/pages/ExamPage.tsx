import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Download,
  FolderOpen,
  Home,
  Moon,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react';
import { useExamSession } from '@/context/ExamSessionContext';
import { useTheme } from '@/context/ThemeContext';
import { useRuntime } from '@/context/RuntimeContext';
import { maxRunTimeoutMs } from '@/lib/runTimeout';
import { formatRunClock, useRunElapsed } from '@/hooks/useRunElapsed';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  loadExamUiSettings,
  saveExamUiSettings,
  type ExamUiSettings,
} from '@/lib/examUiSettings';
import type { ExamLanguage, RunResult } from '@/types/exam';
import { isImageAsset } from '@/lib/assetMedia';
import { assetBasename } from '@/lib/assetPaths';
import { shortAnswersEqual } from '@/lib/shortAnswerMatch';
import { QuizSidebar } from '@/components/layout/QuizSidebar';
import { HeaderMenu } from '@/components/layout/HeaderMenu';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { ProblemPanel } from '@/components/problem/ProblemPanel';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ResultsPanel } from '@/components/results/ResultsPanel';
import { ScreenSettingsModal } from '@/components/exam/ScreenSettingsModal';
import { ShortAnswerPanel } from '@/components/exam/ShortAnswerPanel';
import { ConfirmModal } from '@/components/exam/ConfirmModal';
import { ExamBlueprintPicker } from '@/components/exam/ExamBlueprintPicker';
import {
  ExamPaneNavigator,
  type ExamPaneId,
  type ExamPaneOption,
} from '@/components/exam/ExamPaneNavigator';
import { CsvPreviewPane } from '@/components/project/CsvPreviewPane';

/** Portrait / narrow phones: 3 columns become swipeable pages. */
const EXAM_PAGED_MQ =
  '(orientation: portrait) and (max-width: 1100px), (max-width: 720px)';
import {
  forceSubmitPending,
  gradeExam,
  listUnsubmitted,
} from '@/lib/examGrade';
import {
  appendActivityEvent,
  ensureSessionStart,
  loadActivityEvents,
  summarizeActivity,
} from '@/lib/examActivityLog';
import { saveGradeResult } from '@/lib/gradeResultStore';
import { collectExamAssetIds, materializeExam } from '@/lib/projectIO';
import {
  hydrateProjectAssets,
  parseProjectZipMeta,
} from '@/lib/projectZip';
import { parseExamZipFrom } from '@/lib/examZip';
import { loadZip, zipKindFrom } from '@/lib/zipKind';
import type { AuthoringProject } from '@/types/project';
import type JSZip from 'jszip';
import { readPyodideFileText, runPython } from '@/runtimes/pyodideRuntime';
import {
  mountAssetsToPyodide,
  mountAssetsToWebR,
} from '@/runtimes/fsMount';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';
import type { ShortAnswerSlot } from '@/types/exam';
import { examineeDataFiles } from '@/lib/type2Assets';
import { saveType2Submission } from '@/lib/type2ResultStore';

const SIDEBAR_W_DEFAULT = 240;
const SIDEBAR_W_MIN = 180;

function timerStorageKey(examId: string): string {
  return `bks.examTimerStart.${examId}`;
}

function ensureExamStartMs(examId: string): number {
  try {
    const raw = sessionStorage.getItem(timerStorageKey(examId));
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const now = Date.now();
    sessionStorage.setItem(timerStorageKey(examId), String(now));
    return now;
  } catch {
    return Date.now();
  }
}

function formatRemaining(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function ExamPage() {
  const {
    exam,
    setExam,
    updateQuiz,
    updateNotepad,
    exportZip,
    loadSampleExam,
    clear,
  } = useExamSession();
  const { theme, toggleTheme, setTheme } = useTheme();
  const { runtime, ensureRuntimes } = useRuntime();
  const navigate = useNavigate();
  const zipRef = useRef<HTMLInputElement>(null);
  /** Keep loaded project zip so we hydrate only the selected exam's assets. */
  const pendingZipRef = useRef<JSZip | null>(null);

  const [activeId, setActiveId] = useState('');
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const runElapsedMs = useRunElapsed(running);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_W_DEFAULT);
  const [problemWidth, setProblemWidth] = useState(420);
  const [editorHeight, setEditorHeight] = useState(420);
  const editorMainRef = useRef<HTMLDivElement>(null);
  const [uiSettings, setUiSettings] = useState<ExamUiSettings>(() =>
    loadExamUiSettings(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  /** `code` or provided CSV path */
  const [workspaceTab, setWorkspaceTab] = useState<string>('code');
  const [gradeConfirmOpen, setGradeConfirmOpen] = useState(false);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [codeResetConfirmOpen, setCodeResetConfirmOpen] = useState(false);
  const [pendingProject, setPendingProject] = useState<AuthoringProject | null>(
    null,
  );
  const [pendingExamId, setPendingExamId] = useState('');
  const [zipBusy, setZipBusy] = useState(false);
  const [zipMessage, setZipMessage] = useState('');
  const emptyZipTitleId = useId();
  const pagedLayout = useMediaQuery(EXAM_PAGED_MQ);
  const [examPane, setExamPane] = useState<ExamPaneId>('workspace');
  const [paneNavExpanded, setPaneNavExpanded] = useState(false);

  const patchUiSettings = useCallback(
    (next: ExamUiSettings) => {
      setUiSettings(next);
      saveExamUiSettings(next);
      // Keep app chrome + editor colors in sync with screen-settings theme
      setTheme(next.editorTheme === 'light' ? 'light' : 'dark');
    },
    [setTheme],
  );

  const setContentZoom = useCallback((contentZoomPct: number) => {
    setUiSettings((prev) => {
      const next = { ...prev, contentZoomPct };
      saveExamUiSettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!exam?.quizzes.length) {
      setActiveId('');
      return;
    }
    if (!exam.quizzes.some((q) => q.id === activeId)) {
      setActiveId(exam.quizzes[0].id);
    }
  }, [exam, activeId]);

  useEffect(() => {
    if (!exam) {
      setRemainingSec(null);
      return;
    }
    ensureExamStartMs(exam.id);
    ensureSessionStart(exam.id, exam.title);
    const limit = exam.timeLimitMinutes;
    if (limit == null || limit <= 0) {
      setRemainingSec(null);
      return;
    }
    const startMs = ensureExamStartMs(exam.id);
    const limitMs = limit * 60 * 1000;
    const tick = () => {
      const left = Math.ceil((startMs + limitMs - Date.now()) / 1000);
      setRemainingSec(left);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [exam?.id, exam?.timeLimitMinutes, exam]);

  const quizIndex = Math.max(
    0,
    exam?.quizzes.findIndex((q) => q.id === activeId) ?? 0,
  );
  const quiz = exam?.quizzes[quizIndex];
  const isShortView = quiz?.viewMode === 'short';
  const language = quiz?.language ?? 'python';
  // Empty string is a valid draft only after the user edits; unset → starter.
  const code =
    quiz?.answerDraft != null && quiz.answerDraft !== ''
      ? quiz.answerDraft
      : (quiz?.starterCode[language] ?? '');
  const notepadGroup = quiz?.notepadGroup ?? '';
  const sharedNotepad =
    (notepadGroup && exam?.notepads?.[notepadGroup]) ||
    quiz?.notepad ||
    '';
  const dataFiles = useMemo(
    () =>
      examineeDataFiles(
        (quiz?.files ?? []).filter((f) => !isImageAsset(f)),
      ),
    [quiz?.files],
  );

  useEffect(() => {
    setWorkspaceTab('code');
  }, [quiz?.id]);

  const examPanes: ExamPaneOption[] = useMemo(() => {
    if (isShortView) {
      return [
        { id: 'list', label: '문제 목록', shortLabel: '목록' },
        {
          id: 'workspace',
          label: '답안 작성',
          shortLabel: '답안',
          workspaceVariant: 'short',
        },
      ];
    }
    return [
      { id: 'list', label: '문제 목록', shortLabel: '목록' },
      { id: 'problem', label: '문제', shortLabel: '문제' },
      {
        id: 'workspace',
        label: '코드 · 실행',
        shortLabel: '코드',
        workspaceVariant: 'code',
      },
    ];
  }, [isShortView]);

  useEffect(() => {
    if (examPanes.some((p) => p.id === examPane)) return;
    setExamPane(examPanes[0]?.id ?? 'workspace');
  }, [examPanes, examPane]);

  useEffect(() => {
    if (!pagedLayout) setPaneNavExpanded(false);
  }, [pagedLayout]);

  useEffect(() => {
    if (!exam || !quiz) return;
    appendActivityEvent(exam.id, {
      type: 'quiz_focus',
      at: Date.now(),
      quizId: quiz.id,
      title: quiz.title,
    });
    const tab = quiz.viewMode === 'short' ? 'short' : 'code';
    appendActivityEvent(exam.id, {
      type: 'tab_focus',
      at: Date.now(),
      quizId: quiz.id,
      title: quiz.title,
      tab,
    });
  }, [exam?.id, quiz?.id]);

  useEffect(() => {
    if (!exam || !quiz || isShortView) return;
    appendActivityEvent(exam.id, {
      type: 'tab_focus',
      at: Date.now(),
      quizId: quiz.id,
      title: quiz.title,
      tab: workspaceTab,
    });
  }, [exam?.id, quiz?.id, quiz?.title, workspaceTab, isShortView]);

  useEffect(() => {
    if (workspaceTab === 'code') return;
    if (!dataFiles.some((f) => f.path === workspaceTab)) {
      setWorkspaceTab('code');
    }
  }, [dataFiles, workspaceTab]);

  const activeCsv = useMemo(
    () => dataFiles.find((f) => f.path === workspaceTab) ?? null,
    [dataFiles, workspaceTab],
  );

  const maxSidebarWidth = useMemo(() => {
    if (typeof window === 'undefined') return 360;
    return Math.max(SIDEBAR_W_MIN, Math.floor(window.innerWidth * 0.35));
  }, []);

  const maxProblemWidth = useMemo(() => {
    if (typeof window === 'undefined') return 900;
    return Math.max(320, window.innerWidth - sidebarWidth - 360);
  }, [sidebarWidth]);

  const maxEditorHeight = useMemo(() => {
    const mainH = editorMainRef.current?.clientHeight;
    if (mainH && mainH > 0) return Math.max(160, mainH - 121);
    return 900;
  }, [editorHeight]);

  const onEditorHeightChange = useCallback((next: number) => {
    const mainH = editorMainRef.current?.clientHeight ?? 0;
    const maxH = Math.max(160, mainH > 0 ? mainH - 121 : 900);
    setEditorHeight(Math.min(maxH, Math.max(160, next)));
  }, []);

  const mountCurrentFiles = useCallback(async () => {
    if (!quiz?.files?.length) return [];
    // Hide grading-only labels (test_label*) from the examinee runtime mount.
    const visible = examineeDataFiles(quiz.files);
    if (!visible.length) return [];
    // Always sync Pyodide; also sync webR when the active language is R
    // (or after R has been loaded once).
    const tasks: Array<Promise<string[]>> = [
      mountAssetsToPyodide(visible),
    ];
    if (language === 'r' || runtime.r === 'ready') {
      tasks.push(mountAssetsToWebR(visible));
    }
    const results = await Promise.all(tasks);
    return results[0] ?? [];
  }, [quiz, language, runtime.r]);

  useEffect(() => {
    if (runtime.python !== 'ready' || !quiz) return;
    void mountCurrentFiles().catch(() => {
      /* silent — files still listed in panel; runtime errors show on Run */
    });
  }, [runtime.python, quiz?.id, mountCurrentFiles, quiz]);

  const patchQuiz = useCallback(
    (patch: Partial<NonNullable<typeof quiz>>) => {
      if (!quiz) return;
      updateQuiz(quiz.id, patch);
    },
    [quiz, updateQuiz],
  );

  const setLanguage = (next: ExamLanguage) => {
    if (!quiz) return;
    const draft =
      quiz.answerDraft && quiz.language === next
        ? quiz.answerDraft
        : quiz.starterCode[next];
    patchQuiz({ language: next, answerDraft: draft });
    setWorkspaceTab('code');
  };

  const ensureR = async () => {
    if (runtime.r !== 'ready') {
      ensureRuntimes();
      await preloadWebR();
    }
    const visible = examineeDataFiles(quiz?.files);
    if (visible.length) {
      await mountAssetsToWebR(visible).catch(() => undefined);
    }
  };

  const maxRunSeconds =
    typeof exam?.maxRunSeconds === 'number' && exam.maxRunSeconds > 0
      ? exam.maxRunSeconds
      : 60;
  const runTimeoutMs = maxRunTimeoutMs(maxRunSeconds);

  const runCode = async () => {
    if (!quiz || running || !exam) return;
    const started = Date.now();
    appendActivityEvent(exam.id, {
      type: 'run_start',
      at: started,
      quizId: quiz.id,
      title: quiz.title,
    });
    setRunning(true);
    setResult(null);
    try {
      await mountCurrentFiles();
      const source =
        quiz.answerDraft != null && quiz.answerDraft !== ''
          ? quiz.answerDraft
          : quiz.starterCode[language];
      const opts = { timeoutMs: runTimeoutMs };
      const out =
        language === 'python'
          ? await runPython(source, opts)
          : ((await ensureR()), await runR(source, opts));
      setResult(out);
      appendActivityEvent(exam.id, {
        type: 'run_end',
        at: Date.now(),
        quizId: quiz.id,
        title: quiz.title,
        durationMs: out.durationMs || Date.now() - started,
        ok: out.ok,
      });
    } catch (err) {
      appendActivityEvent(exam.id, {
        type: 'run_end',
        at: Date.now(),
        quizId: quiz.id,
        title: quiz.title,
        durationMs: Date.now() - started,
        ok: false,
      });
      setResult({
        ok: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
    } finally {
      setRunning(false);
    }
  };

  const submitShortAnswers = () => {
    if (!quiz || quiz.viewMode !== 'short') return;
    const slots = quiz.shortSlots ?? [];
    // Partial answers are allowed — empty slots are recorded as blank.
    const lines = slots.map((s) => {
      const draft = (s.draft ?? '').trim();
      const expected = (s.expected ?? '').trim();
      if (!draft) {
        return expected
          ? `FAIL · ${s.label}: (미입력) (정답 ${expected})`
          : `${s.label}: 미입력`;
      }
      if (!expected) return `${s.label}: 제출됨 (${draft})`;
      const ok = shortAnswersEqual(draft, expected);
      return `${ok ? 'PASS' : 'FAIL'} · ${s.label}: ${draft}${ok ? '' : ` (정답 ${expected})`}`;
    });
    patchQuiz({ submitted: true, shortSlots: slots });
    if (exam) {
      appendActivityEvent(exam.id, {
        type: 'submit',
        at: Date.now(),
        quizId: quiz.id,
        title: quiz.title,
        tab: 'short',
      });
    }
    setResult({
      ok: lines.every((l) => l.startsWith('PASS') || l.includes('제출됨')),
      stdout: `[단답 제출]\n${lines.join('\n')}`,
      stderr: '',
      durationMs: 0,
    });
  };

  /**
   * Type-2 only: capture result.csv into exam session + IndexedDB.
   * Do not download or grade here — grading runs when the exam ends.
   */
  const submitCsvResult = async () => {
    if (!quiz || quiz.taskType !== 2 || quiz.kind !== 'submit') return;
    const path = quiz.submitFile || 'result.csv';
    try {
      const csvText = await readPyodideFileText(path);
      if (!csvText.trim()) {
        throw new Error(`${path} 이 비어 있습니다.`);
      }
      patchQuiz({ submitted: true, submittedCsv: csvText });
      if (exam) {
        await saveType2Submission({
          examId: exam.id,
          quizId: quiz.id,
          csv: csvText,
          submitFile: path,
        });
        appendActivityEvent(exam.id, {
          type: 'submit',
          at: Date.now(),
          quizId: quiz.id,
          title: quiz.title,
          tab: 'code',
        });
      }
      const lines = csvText.split(/\r?\n/).length;
      setResult((prev) => ({
        ok: true,
        stdout:
          `${prev?.stdout ?? ''}\n\n[제출] ${path} 저장 완료 (${lines} lines). 채점은 시험 끝내기 후 진행됩니다.`.trim(),
        stderr: prev?.stderr ?? '',
        durationMs: prev?.durationMs ?? 0,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult((prev) => ({
        ok: false,
        stdout: prev?.stdout ?? '',
        stderr: `${prev?.stderr ? `${prev.stderr}\n` : ''}${message}`,
        durationMs: prev?.durationMs ?? 0,
      }));
    }
  };

  const setNotepadText = (text: string) => {
    if (notepadGroup) updateNotepad(notepadGroup, text);
    else patchQuiz({ notepad: text });
  };

  const setShortSlots = (slots: ShortAnswerSlot[]) => {
    patchQuiz({ shortSlots: slots });
  };

  const runGrading = useCallback(
    async (opts?: { submitPending?: boolean }) => {
      if (!exam || gradeBusy) return;
      setGradeBusy(true);
      setGradeConfirmOpen(false);
      try {
        let gradingExam = exam;
        if (opts?.submitPending) {
          gradingExam = await forceSubmitPending(exam, {
            readCsv: async (path) => {
              try {
                const text = await readPyodideFileText(path);
                return text.trim() ? text : null;
              } catch {
                return null;
              }
            },
          });
          for (const q of gradingExam.quizzes) {
            const prev = exam.quizzes.find((x) => x.id === q.id);
            if (!prev || prev.submitted || !q.submitted) continue;
            updateQuiz(q.id, {
              submitted: true,
              submittedCsv: q.submittedCsv,
              shortSlots: q.shortSlots,
            });
            if (q.taskType === 2 && q.submittedCsv?.trim()) {
              await saveType2Submission({
                examId: exam.id,
                quizId: q.id,
                csv: q.submittedCsv,
                submitFile: q.submitFile || 'result.csv',
              });
            }
          }
        }
        appendActivityEvent(exam.id, {
          type: 'grade',
          at: Date.now(),
          title: exam.title,
        });
        const report = await gradeExam(gradingExam, {
          timeoutMs: maxRunTimeoutMs(gradingExam.maxRunSeconds),
        });
        const gradedAtMs = Date.now();
        const startMs = ensureExamStartMs(exam.id);
        const events = loadActivityEvents(exam.id);
        const activity = summarizeActivity(events, gradedAtMs);
        await saveGradeResult({
          examId: exam.id,
          examTitle: exam.title,
          gradedAt: new Date(gradedAtMs).toISOString(),
          elapsedMs: Math.max(0, gradedAtMs - startMs),
          report,
          activity,
          rawEvents: events,
        });
        navigate('/exam/result');
      } catch (err) {
        const gradedAtMs = Date.now();
        const startMs = ensureExamStartMs(exam.id);
        const events = loadActivityEvents(exam.id);
        await saveGradeResult({
          examId: exam.id,
          examTitle: exam.title,
          gradedAt: new Date(gradedAtMs).toISOString(),
          elapsedMs: Math.max(0, gradedAtMs - startMs),
          report: {
            items: [
              {
                quizId: 'error',
                title: '채점 오류',
                status: 'fail',
                detail: err instanceof Error ? err.message : String(err),
                earned: 0,
                max: 0,
              },
            ],
            earned: 0,
            max: 0,
            unsubmittedCount: 0,
          },
          activity: summarizeActivity(events, gradedAtMs),
          rawEvents: events,
        });
        navigate('/exam/result');
      } finally {
        setGradeBusy(false);
      }
    },
    [exam, gradeBusy, navigate, updateQuiz],
  );

  const requestGrade = useCallback(() => {
    if (!exam || gradeBusy) return;
    const pending = listUnsubmitted(exam);
    if (pending.length > 0) {
      setGradeConfirmOpen(true);
      return;
    }
    void runGrading();
  }, [exam, gradeBusy, runGrading]);

  const handleSessionZip = useCallback(
    async (file: File) => {
      setZipBusy(true);
      setZipMessage('');
      try {
        // One JSZip.loadAsync — previous path did arrayBuffer + detect + parse (2–3× RAM).
        const zip = await loadZip(file);
        const kind = zipKindFrom(zip);
        if (kind === 'project') {
          const project = await parseProjectZipMeta(zip);
          pendingZipRef.current = zip;
          setExam(null);
          setPendingProject(project);
          setPendingExamId(
            project.activeExamId || project.exams[0]?.id || '',
          );
          return;
        }
        if (kind === 'exam') {
          pendingZipRef.current = null;
          setPendingProject(null);
          setPendingExamId('');
          const next = await parseExamZipFrom(zip);
          setExam({
            ...next,
            kind: 'exam',
            updatedAt: new Date().toISOString(),
          });
          return;
        }
        pendingZipRef.current = null;
        setZipMessage(
          '지원하지 않는 ZIP입니다. exam.json 또는 project.json 이 필요합니다.',
        );
      } catch (err) {
        pendingZipRef.current = null;
        setZipMessage(err instanceof Error ? err.message : String(err));
      } finally {
        setZipBusy(false);
      }
    },
    [setExam],
  );

  const openPendingExam = useCallback(async () => {
    if (!pendingProject || !pendingExamId || zipBusy) return;
    setZipBusy(true);
    setZipMessage('');
    try {
      const zip = pendingZipRef.current;
      const assetIds = collectExamAssetIds(pendingProject, pendingExamId);
      const hydrated = zip
        ? await hydrateProjectAssets(zip, pendingProject, assetIds)
        : pendingProject;
      const next = materializeExam(hydrated, pendingExamId);
      setExam(next);
      pendingZipRef.current = null;
      setPendingProject(null);
      setPendingExamId('');
    } catch (err) {
      setZipMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setZipBusy(false);
    }
  }, [pendingExamId, pendingProject, setExam, zipBusy]);

  if (!exam) {
    return (
      <div className="home-page">
        <button
          type="button"
          className="ghost-btn btn-with-icon home-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {theme === 'dark' ? '라이트' : '다크'}
        </button>
        <div className="home-card home-card--wide">
          {pendingProject ? (
            <>
              <h1 id={emptyZipTitleId}>시험지 선택</h1>
              <p>
                프로젝트 ZIP「{pendingProject.title}」의 시험지 중 하나를 골라
                응시하세요.
              </p>
              <ExamBlueprintPicker
                exams={pendingProject.exams}
                selectedId={pendingExamId}
                onSelect={setPendingExamId}
                onSubmit={openPendingExam}
                busy={zipBusy}
                labelledBy={emptyZipTitleId}
                submitLabel="선택한 시험 응시"
                emptyMessage="이 프로젝트에 등록된 시험지가 없습니다."
              />
              <div className="home-actions" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="ghost-btn home-btn"
                  disabled={zipBusy}
                  onClick={() => {
                    pendingZipRef.current = null;
                    setPendingProject(null);
                    setPendingExamId('');
                    setZipMessage('');
                    zipRef.current?.click();
                  }}
                >
                  다른 ZIP 불러오기
                </button>
              </div>
            </>
          ) : (
            <>
              <h1>시험 세션 없음</h1>
              <p>
                .exam.zip 또는 .project.zip 을 불러오거나 샘플 시험을
                로드하세요.
              </p>
              <div className="home-actions">
                <button
                  type="button"
                  className="primary-btn home-btn"
                  disabled={zipBusy}
                  onClick={() => zipRef.current?.click()}
                >
                  시험 ZIP 불러오기
                  <span>.exam.zip · .project.zip</span>
                </button>
                <button
                  type="button"
                  className="ghost-btn home-btn"
                  disabled={zipBusy}
                  onClick={loadSampleExam}
                >
                  샘플 시험
                </button>
                <Link className="ghost-btn home-btn" to="/project">
                  프로젝트로 가서 시험 만들기
                </Link>
              </div>
            </>
          )}
          {zipMessage ? (
            <p className="edit-page__sub" style={{ marginTop: 12 }}>
              {zipMessage}
            </p>
          ) : null}
          <input
            ref={zipRef}
            className="hidden-file"
            type="file"
            accept=".zip,application/zip"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) await handleSessionZip(file);
            }}
          />
        </div>
      </div>
    );
  }

  if (!quiz) {
    return <div style={{ padding: 24 }}>시험에 문제가 없습니다.</div>;
  }

  return (
    <div
      className={`app-shell${pagedLayout ? ' app-shell--paged' : ''}`}
      data-exam-pane={pagedLayout ? examPane : undefined}
    >
      <header className="exam-header">
        <div className="exam-header__title">시험 {exam.title}</div>
        <div className="exam-header__meta">
          {exam.timeLimitMinutes == null || exam.timeLimitMinutes <= 0 ? (
            <span>제한 시간 없음</span>
          ) : (
            <span
              className={
                remainingSec != null && remainingSec <= 300
                  ? 'exam-timer exam-timer--warn'
                  : 'exam-timer'
              }
              title={`제한 ${exam.timeLimitMinutes}분`}
            >
              남은 시간{' '}
              <span className="exam-timer__value">
                {remainingSec == null
                  ? `${exam.timeLimitMinutes}분`
                  : remainingSec <= 0
                    ? '00:00:00 (종료)'
                    : formatRemaining(remainingSec)}
              </span>
            </span>
          )}
        </div>
        <div className="exam-header__actions">
          <div className="runtime-badges" aria-label="런타임 상태">
            <span
              className={`runtime-pill runtime-pill--${
                running && language === 'python'
                  ? 'loading'
                  : runtime.python === 'ready'
                    ? 'ready'
                    : runtime.python === 'loading'
                      ? 'loading'
                      : 'idle'
              }`}
              title={
                running && language === 'python'
                  ? 'Python 실행 중'
                  : `Python ${runtime.python}`
              }
            >
              <i className="runtime-dot" aria-hidden />
              Python
            </span>
            <span
              className={`runtime-pill runtime-pill--${
                running && language === 'r'
                  ? 'loading'
                  : runtime.r === 'ready'
                    ? 'ready'
                    : runtime.r === 'loading'
                      ? 'loading'
                      : 'idle'
              }`}
              title={
                running && language === 'r' ? 'R 실행 중' : `R ${runtime.r}`
              }
            >
              <i className="runtime-dot" aria-hidden />
              R
            </span>
          </div>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="화면설정"
            title="화면설정"
          >
            <Settings size={16} />
          </button>
          <HeaderMenu
            label="메뉴"
            items={[
              {
                id: 'settings',
                label: '화면설정',
                icon: <Settings size={16} />,
                onClick: () => setSettingsOpen(true),
              },
              {
                id: 'home',
                label: '홈',
                icon: <Home size={16} />,
                onClick: () => navigate('/'),
              },
              {
                id: 'project',
                label: '프로젝트',
                icon: <FolderOpen size={16} />,
                onClick: () => navigate('/project'),
              },
              {
                id: 'open-zip',
                label: '시험 ZIP 열기',
                icon: <FolderOpen size={16} />,
                onClick: () => zipRef.current?.click(),
              },
              {
                id: 'save-zip',
                label: 'ZIP 저장',
                icon: <Download size={16} />,
                onClick: () => void exportZip(),
              },
              {
                id: 'clear',
                label: '세션 비우기',
                icon: <Trash2 size={16} />,
                danger: true,
                onClick: () => setClearConfirmOpen(true),
              },
            ]}
          />
          <input
            ref={zipRef}
            className="hidden-file"
            type="file"
            accept=".zip,application/zip"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) await handleSessionZip(file);
            }}
          />
        </div>
      </header>

      <div className="exam-body">
        <div
          className="quiz-sidebar-pane"
          data-pane="list"
          style={
            pagedLayout
              ? undefined
              : { width: sidebarWidth, flexBasis: sidebarWidth }
          }
        >
          <QuizSidebar
            exam={exam}
            activeId={quiz.id}
            onSelect={(id) => {
              setActiveId(id);
              setResult(null);
              if (pagedLayout) {
                setExamPane(isShortView ? 'workspace' : 'problem');
              }
            }}
          />
          {!pagedLayout ? (
            <EdgeResizeHandle
              axis="x"
              value={sidebarWidth}
              onChange={setSidebarWidth}
              min={SIDEBAR_W_MIN}
              max={maxSidebarWidth}
              label="문제 목록 너비 조절"
            />
          ) : null}
        </div>

        {!isShortView && (
          <div
            className="problem-pane"
            data-pane="problem"
            style={pagedLayout ? undefined : { width: problemWidth }}
          >
            <ProblemPanel
              quiz={quiz}
              zoomPct={uiSettings.contentZoomPct}
              lineHeightPct={uiSettings.contentLineHeightPct}
              onZoomChange={setContentZoom}
            />
            {!pagedLayout ? (
              <EdgeResizeHandle
                axis="x"
                value={problemWidth}
                onChange={setProblemWidth}
                min={280}
                max={maxProblemWidth}
                label="문제 패널 너비 조절"
              />
            ) : null}
          </div>
        )}

        <section
          className={`workspace-panel ${isShortView ? 'workspace-panel--short' : ''}`}
          data-pane="workspace"
        >
          {isShortView ? (
            <div className="editor-main short-answer-workspace">
              <ShortAnswerPanel
                quiz={quiz}
                onSlotsChange={setShortSlots}
                onSubmit={submitShortAnswers}
              />
            </div>
          ) : (
            <>
              <div className="editor-toolbar">
                <div className="editor-toolbar__tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={workspaceTab === 'code'}
                    className={`workspace-tab ${workspaceTab === 'code' ? 'active' : ''}`}
                    onClick={() => setWorkspaceTab('code')}
                  >
                    {language === 'python' ? 'Python3' : 'R'}
                  </button>
                  {dataFiles.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      role="tab"
                      aria-selected={workspaceTab === f.path}
                      className={`workspace-tab ${workspaceTab === f.path ? 'active' : ''}`}
                      title={f.path}
                      onClick={() => setWorkspaceTab(f.path)}
                    >
                      {assetBasename(f.name || f.path)}
                    </button>
                  ))}
                </div>
                <div className="editor-toolbar__actions">
                  <select
                    value={language}
                    aria-label="언어"
                    onChange={(e) => setLanguage(e.target.value as ExamLanguage)}
                  >
                    <option value="python">Python3</option>
                    <option value="r">R</option>
                  </select>
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => setCodeResetConfirmOpen(true)}
                  >
                    초기화
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    disabled={running}
                    onClick={() => void runCode()}
                  >
                    실행
                  </button>
                  <span
                    className={`run-clock ${running ? 'run-clock--live' : ''}`}
                    title="실행 시간 / 제한"
                    aria-live="polite"
                  >
                    {formatRunClock(
                      running
                        ? runElapsedMs
                        : (result?.durationMs ?? 0),
                      maxRunSeconds,
                    )}
                  </span>
                  {quiz.taskType === 2 && quiz.kind === 'submit' && (
                    <button
                      type="button"
                      className="tool-btn"
                      disabled={running}
                      onClick={() => void submitCsvResult()}
                    >
                      제출
                    </button>
                  )}
                </div>
              </div>

              <div className="editor-main" ref={editorMainRef}>
                <div
                  className="code-editor-wrap"
                  style={{ height: editorHeight }}
                >
                  {workspaceTab === 'code' ? (
                    <>
                      <button
                        type="button"
                        className="tool-btn notepad-fab"
                        onClick={() => setNotepadOpen((v) => !v)}
                      >
                        메모장
                      </button>
                      <CodeEditor
                        value={code}
                        language={language}
                        onChange={(value) => patchQuiz({ answerDraft: value })}
                        prefs={{
                          fontSize: uiSettings.editorFontSize,
                          lineHeightPct: uiSettings.editorLineHeightPct,
                          keymap: uiSettings.editorKeymap,
                          indentUnit: uiSettings.indentUnit,
                          tabSize: uiSettings.tabSize,
                        }}
                      />
                      {notepadOpen && (
                        <textarea
                          className="notepad-popup"
                          placeholder="메모를 작성해보세요."
                          value={sharedNotepad}
                          onChange={(e) => setNotepadText(e.target.value)}
                        />
                      )}
                    </>
                  ) : (
                    <div className="exam-csv-workspace">
                      <CsvPreviewPane asset={activeCsv} />
                    </div>
                  )}
                </div>

                <div className="workspace-y-split">
                  <EdgeResizeHandle
                    axis="y"
                    value={editorHeight}
                    onChange={onEditorHeightChange}
                    min={160}
                    max={maxEditorHeight}
                    label="코드 에디터 / 실행 결과 높이 조절"
                  />
                </div>

                <div className="results-pane">
                  <ResultsPanel
                    result={result}
                    running={running}
                    elapsedMs={runElapsedMs}
                    maxRunSeconds={maxRunSeconds}
                  />
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {pagedLayout ? (
        <ExamPaneNavigator
          panes={examPanes}
          active={examPane}
          expanded={paneNavExpanded}
          onExpandedChange={setPaneNavExpanded}
          onSelect={setExamPane}
        />
      ) : null}

      <ScreenSettingsModal
        open={settingsOpen}
        value={uiSettings}
        onClose={() => setSettingsOpen(false)}
        onChange={patchUiSettings}
      />

      <footer className="exam-footer">
        <span className="exam-footer__label">
          빅데이터분석기사 실기 체험 · 실행 1분 · 자동완성 없음
        </span>
        <div className="exam-footer__nav" role="navigation" aria-label="문제 이동">
          <button
            type="button"
            className="exam-footer__nav-btn"
            disabled={quizIndex <= 0}
            onClick={() => {
              const prev = exam.quizzes[quizIndex - 1];
              if (prev) {
                setActiveId(prev.id);
                setResult(null);
              }
            }}
          >
            &lt; 이전 문제
          </button>
          <span className="exam-footer__pos" aria-live="polite">
            {quizIndex + 1}/{exam.quizzes.length}
          </span>
          <button
            type="button"
            className="exam-footer__nav-btn exam-footer__nav-btn--next"
            disabled={quizIndex >= exam.quizzes.length - 1}
            onClick={() => {
              const next = exam.quizzes[quizIndex + 1];
              if (next) {
                setActiveId(next.id);
                setResult(null);
              }
            }}
          >
            다음 문제 &gt;
          </button>
        </div>
        <div className="exam-footer__actions">
          <button
            type="button"
            className="exam-footer__grade-btn"
            disabled={gradeBusy}
            onClick={requestGrade}
            title="시험 종료 후 답안을 채점합니다. 종료 뒤에는 추가 제출이 불가합니다."
          >
            {gradeBusy ? '채점 중…' : '시험 끝내기'}
          </button>
        </div>
      </footer>

      <ConfirmModal
        open={gradeConfirmOpen}
        title="시험 끝내기 · 미제출 확인"
        message={`미제출 문항이 ${listUnsubmitted(exam).length}건 있습니다.\n현재 입력된 답안으로 제출한 뒤 시험을 끝내고 채점할까요?\n(종료 후에는 답안을 더 제출할 수 없습니다.)`}
        confirmLabel="제출 후 시험 끝내기"
        cancelLabel="취소"
        busy={gradeBusy}
        onConfirm={() => void runGrading({ submitPending: true })}
        onCancel={() => setGradeConfirmOpen(false)}
      />

      <ConfirmModal
        open={clearConfirmOpen}
        title="세션 비우기"
        message={
          '현재 시험 세션을 비울까요?\n진행 중인 답안·제출 상태가 사라집니다.'
        }
        cancelLabel="취소"
        secondaryLabel="홈으로 가기"
        confirmLabel="세션 비우기"
        confirmDanger
        onCancel={() => setClearConfirmOpen(false)}
        onSecondary={() => {
          setClearConfirmOpen(false);
          clear();
          navigate('/');
        }}
        onConfirm={() => {
          setClearConfirmOpen(false);
          clear();
        }}
      />

      <ConfirmModal
        open={codeResetConfirmOpen}
        title="코드 초기화"
        message={
          '편집 중인 코드를 시작 코드로 되돌릴까요?\n작성한 내용이 사라집니다.'
        }
        cancelLabel="취소"
        confirmLabel="초기화"
        confirmDanger
        onCancel={() => setCodeResetConfirmOpen(false)}
        onConfirm={() => {
          patchQuiz({ answerDraft: quiz.starterCode[language] });
          setResult(null);
          setCodeResetConfirmOpen(false);
        }}
      />
    </div>
  );
}
