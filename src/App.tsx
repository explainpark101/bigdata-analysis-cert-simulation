import { useCallback, useEffect, useMemo, useState } from 'react';
import { SAMPLE_EXAM } from '@/data/sampleExam';
import {
  cloneExam,
  loadExamFromStorage,
  saveExamToStorage,
  submittedCount,
} from '@/lib/examIO';
import type { ExamLanguage, ExamSet, RunResult, RuntimeStatus } from '@/types/exam';
import { QuizSidebar } from '@/components/layout/QuizSidebar';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { ProblemPanel } from '@/components/problem/ProblemPanel';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ResultsPanel } from '@/components/results/ResultsPanel';
import { ExamManager } from '@/components/admin/ExamManager';
import {
  downloadPyodideFile,
  preloadPyodide,
  runPython,
} from '@/runtimes/pyodideRuntime';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';

const SIDEBAR_W = 220;

export default function App() {
  const [exam, setExam] = useState<ExamSet>(
    () => loadExamFromStorage() ?? cloneExam(SAMPLE_EXAM),
  );
  const [activeId, setActiveId] = useState(() => exam.quizzes[0]?.id ?? '');
  const [editMode, setEditMode] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus>({
    python: 'idle',
    r: 'idle',
  });

  const [problemWidth, setProblemWidth] = useState(420);
  const [editorHeight, setEditorHeight] = useState(420);
  const [resultsHeight, setResultsHeight] = useState(220);

  const quizIndex = Math.max(
    0,
    exam.quizzes.findIndex((q) => q.id === activeId),
  );
  const quiz = exam.quizzes[quizIndex] ?? exam.quizzes[0];
  const language = quiz?.language ?? 'python';
  const code = quiz?.answerDraft ?? quiz?.starterCode[language] ?? '';

  const { done, total } = useMemo(() => submittedCount(exam), [exam]);

  const maxProblemWidth = useMemo(() => {
    if (typeof window === 'undefined') return 900;
    return Math.max(320, window.innerWidth - SIDEBAR_W - 360);
  }, []);

  useEffect(() => {
    saveExamToStorage(exam);
  }, [exam]);

  useEffect(() => {
    let cancelled = false;
    setRuntime((s) => ({ ...s, python: 'loading', message: 'Pyodide loading…' }));
    preloadPyodide()
      .then(() => {
        if (!cancelled) {
          setRuntime((s) => ({ ...s, python: 'ready', message: undefined }));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRuntime((s) => ({
            ...s,
            python: 'error',
            message: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateQuiz = useCallback(
    (patch: Partial<NonNullable<typeof quiz>>) => {
      if (!quiz) return;
      setExam((prev) => ({
        ...prev,
        quizzes: prev.quizzes.map((q) =>
          q.id === quiz.id ? { ...q, ...patch } : q,
        ),
        updatedAt: new Date().toISOString(),
      }));
    },
    [quiz],
  );

  const setLanguage = (next: ExamLanguage) => {
    if (!quiz) return;
    const draft =
      quiz.answerDraft && quiz.language === next
        ? quiz.answerDraft
        : quiz.starterCode[next];
    updateQuiz({ language: next, answerDraft: draft });
  };

  const resetCode = () => {
    if (!quiz) return;
    updateQuiz({ answerDraft: quiz.starterCode[language] });
    setResult(null);
  };

  const ensureR = async () => {
    if (runtime.r === 'ready') return;
    setRuntime((s) => ({ ...s, r: 'loading' }));
    try {
      await preloadWebR();
      setRuntime((s) => ({ ...s, r: 'ready' }));
    } catch (err) {
      setRuntime((s) => ({
        ...s,
        r: 'error',
        message: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  };

  const runCode = async () => {
    if (!quiz || running) return;
    setRunning(true);
    setResult(null);
    try {
      const source = quiz.answerDraft ?? quiz.starterCode[language];
      const out =
        language === 'python'
          ? await runPython(source)
          : ((await ensureR()), await runR(source));
      setResult(out);
    } finally {
      setRunning(false);
    }
  };

  const runTests = async () => {
    await runCode();
    const cases = quiz?.testCases ?? [];
    if (!cases.length) {
      setResult((prev) =>
        prev
          ? {
              ...prev,
              stdout: `${prev.stdout}\n\n[테스트] 정의된 테스트 케이스가 없습니다.`,
            }
          : prev,
      );
      return;
    }
    setResult((prev) => {
      if (!prev) return prev;
      const lines = cases.map((tc) => {
        const ok = (tc.expectIncludes ?? []).every((s) =>
          prev.stdout.includes(s),
        );
        return `${ok ? 'PASS' : 'FAIL'} · ${tc.name}`;
      });
      return {
        ...prev,
        stdout: `${prev.stdout}\n\n[테스트]\n${lines.join('\n')}`,
        ok: prev.ok && lines.every((l) => l.startsWith('PASS')),
      };
    });
  };

  const submitAnswer = async () => {
    if (!quiz || quiz.kind !== 'submit') return;

    if (quiz.submitFormat === 'csv') {
      const path = quiz.submitFile || 'result.csv';
      try {
        await downloadPyodideFile(path, path);
        updateQuiz({ submitted: true });
        setResult((prev) => ({
          ok: true,
          stdout: `${prev?.stdout ?? ''}\n\n[제출] ${path} 다운로드 완료`.trim(),
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
      return;
    }

    updateQuiz({ submitted: true });
    setResult((prev) => ({
      ok: true,
      stdout: prev?.stdout ?? '',
      stderr: prev?.stderr ?? '',
      durationMs: prev?.durationMs ?? 0,
    }));
  };

  const goRelative = (delta: number) => {
    const next = quizIndex + delta;
    if (next < 0 || next >= exam.quizzes.length) return;
    setActiveId(exam.quizzes[next].id);
    setResult(null);
  };

  if (!quiz) {
    return <div style={{ padding: 24 }}>시험 데이터가 없습니다.</div>;
  }

  return (
    <div className="app-shell">
      <header className="exam-header">
        <div className="exam-header__title">시험 {exam.title}</div>
        <div className="exam-header__meta">
          {exam.timeLimitMinutes == null
            ? '제한 시간 없음'
            : `제한 시간 ${exam.timeLimitMinutes}분`}
        </div>
        <div className="exam-header__actions">
          <span
            className={`runtime-pill ${runtime.python}`}
            title={runtime.message}
          >
            Python {runtime.python}
          </span>
          <span className={`runtime-pill ${runtime.r}`}>R {runtime.r}</span>
          <button
            type="button"
            className={`tool-btn ${editMode ? 'active' : ''}`}
            onClick={() => setEditMode((v) => !v)}
          >
            문제편집
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setManagerOpen(true)}
          >
            가져오기/내보내기
          </button>
        </div>
      </header>

      <div className="exam-body">
        <QuizSidebar
          exam={exam}
          activeId={quiz.id}
          onSelect={(id) => {
            setActiveId(id);
            setResult(null);
          }}
        />

        <div className="problem-pane" style={{ width: problemWidth }}>
          <ProblemPanel
            quiz={quiz}
            editMode={editMode}
            onMarkdownChange={(markdown) => updateQuiz({ markdown })}
          />
          <EdgeResizeHandle
            axis="x"
            value={problemWidth}
            onChange={setProblemWidth}
            min={280}
            max={maxProblemWidth}
            label="문제 패널 너비 조절"
          />
        </div>

        <section className="workspace-panel">
          <div className="editor-toolbar">
            <div className="row">
              <select
                value={language}
                aria-label="언어"
                onChange={(e) => setLanguage(e.target.value as ExamLanguage)}
              >
                <option value="python">Python3</option>
                <option value="r">R</option>
              </select>
              <button type="button" className="tool-btn" onClick={resetCode}>
                초기화
              </button>
              <button
                type="button"
                className="tool-btn"
                onClick={() => saveExamToStorage(exam)}
              >
                저장
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={running}
                onClick={() => void runCode()}
              >
                실행
              </button>
              <button
                type="button"
                className="tool-btn"
                disabled={running}
                onClick={() => void runTests()}
              >
                테스트
              </button>
              {quiz.kind === 'submit' && (
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => void submitAnswer()}
                >
                  {quiz.submitFormat === 'csv' ? '제출 (csv)' : '제출'}
                </button>
              )}
            </div>
            <div className="row">
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                제출 {String(done).padStart(2, '0')}/
                {String(total).padStart(2, '0')}
              </span>
            </div>
          </div>

          <div className="editor-main">
            <div
              className="code-editor-wrap"
              style={{ height: editorHeight, flex: 'none' }}
            >
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
                onChange={(value) => updateQuiz({ answerDraft: value })}
              />
              {notepadOpen && (
                <textarea
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: 44,
                    width: 280,
                    height: 180,
                    zIndex: 3,
                    borderRadius: 8,
                    border: '1px solid #334155',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    padding: 8,
                    fontFamily: 'var(--dq-font)',
                  }}
                  placeholder="메모를 작성해보세요."
                  value={quiz.notepad ?? ''}
                  onChange={(e) => updateQuiz({ notepad: e.target.value })}
                />
              )}
              <EdgeResizeHandle
                axis="y"
                value={editorHeight}
                onChange={setEditorHeight}
                min={160}
                max={900}
                label="코드 에디터 높이 조절"
              />
            </div>

            <div
              className="results-pane"
              style={{ height: resultsHeight, flex: 'none' }}
            >
              <EdgeResizeHandle
                axis="y"
                value={resultsHeight}
                onChange={setResultsHeight}
                min={120}
                max={600}
                invert
                label="실행 결과 높이 조절"
              />
              <ResultsPanel result={result} running={running} />
            </div>
          </div>
        </section>
      </div>

      <footer className="exam-footer">
        <span>빅데이터분석기사 실기 체험환경</span>
        <span>
          {quizIndex + 1}/{exam.quizzes.length}
        </span>
        <button
          type="button"
          className="primary-btn"
          disabled={quizIndex >= exam.quizzes.length - 1}
          onClick={() => goRelative(1)}
        >
          다음 문제 &gt;
        </button>
      </footer>

      <ExamManager
        open={managerOpen}
        exam={exam}
        activeQuiz={quiz}
        onClose={() => setManagerOpen(false)}
        onExamChange={setExam}
        onSelectQuiz={setActiveId}
      />
    </div>
  );
}
