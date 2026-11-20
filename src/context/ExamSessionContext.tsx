import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  clearExamSession,
  loadExamSession,
  materializeExam,
  saveExamSession,
} from '@/lib/projectIO';
import { SAMPLE_PROJECT } from '@/data/sampleProject';
import { parseExamZip, exportExamZip } from '@/lib/examZip';
import type { ExamSet, QuizProblem } from '@/types/exam';

interface ExamSessionContextValue {
  exam: ExamSet | null;
  ready: boolean;
  setExam: (exam: ExamSet | null) => void;
  updateQuiz: (quizId: string, patch: Partial<QuizProblem>) => void;
  /** Shared notepad for a notepadGroup (t1/t2/t3). */
  updateNotepad: (group: string, text: string) => void;
  importExamZip: (file: File) => Promise<void>;
  exportZip: () => Promise<void>;
  loadSampleExam: () => void;
  clear: () => void;
}

const ExamSessionContext = createContext<ExamSessionContextValue | null>(null);

export function ExamSessionProvider({ children }: { children: ReactNode }) {
  const [exam, setExamState] = useState<ExamSet | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadExamSession();
      if (cancelled) return;
      setExamState(stored ?? materializeExam(SAMPLE_PROJECT));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !exam) return;
    void saveExamSession(exam);
  }, [exam, ready]);

  const setExam = useCallback((next: ExamSet | null) => {
    if (!next) {
      void clearExamSession();
      setExamState(null);
      return;
    }
    setExamState({ ...next, kind: 'exam', updatedAt: new Date().toISOString() });
  }, []);

  const updateQuiz = useCallback((quizId: string, patch: Partial<QuizProblem>) => {
    setExamState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        quizzes: prev.quizzes.map((q) =>
          q.id === quizId ? { ...q, ...patch } : q,
        ),
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const updateNotepad = useCallback((group: string, text: string) => {
    if (!group) return;
    setExamState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        notepads: { ...(prev.notepads ?? {}), [group]: text },
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const importExamZip = useCallback(async (file: File) => {
    const next = await parseExamZip(file);
    setExamState({ ...next, kind: 'exam', updatedAt: new Date().toISOString() });
  }, []);

  const exportZip = useCallback(async () => {
    if (!exam) return;
    await exportExamZip(exam);
  }, [exam]);

  const loadSampleExam = useCallback(() => {
    setExamState(materializeExam(SAMPLE_PROJECT));
  }, []);

  const clear = useCallback(() => {
    void clearExamSession();
    setExamState(null);
  }, []);

  const value = useMemo(
    () => ({
      exam,
      ready,
      setExam,
      updateQuiz,
      updateNotepad,
      importExamZip,
      exportZip,
      loadSampleExam,
      clear,
    }),
    [
      exam,
      ready,
      setExam,
      updateQuiz,
      updateNotepad,
      importExamZip,
      exportZip,
      loadSampleExam,
      clear,
    ],
  );

  if (!ready) {
    return <div className="storage-boot">시험 세션 불러오는 중…</div>;
  }

  return (
    <ExamSessionContext.Provider value={value}>
      {children}
    </ExamSessionContext.Provider>
  );
}

export function useExamSession(): ExamSessionContextValue {
  const ctx = useContext(ExamSessionContext);
  if (!ctx) {
    throw new Error('useExamSession must be used within ExamSessionProvider');
  }
  return ctx;
}
