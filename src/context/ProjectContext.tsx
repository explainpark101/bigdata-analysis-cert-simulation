import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SAMPLE_PROJECT } from '@/data/sampleProject';
import {
  cloneProject,
  createEmptyBankProblem,
  createEmptyExamBlueprint,
  duplicateBankProblem,
  duplicateExamBlueprint,
  getActiveExam,
  loadProjectFromStorage,
  materializeExam,
  saveExamSession,
  saveProjectToStorage,
} from '@/lib/projectIO';
import { exportExamZip } from '@/lib/examZip';
import { exportProjectZip, parseProjectZip } from '@/lib/projectZip';
import type {
  AuthoringProject,
  BankProblem,
  ExamBlueprint,
  ProjectAsset,
} from '@/types/project';
import { mountPathForAsset } from '@/lib/assetPaths';
import {
  classifyAssetImports,
  pendingToAsset,
  readPendingImports,
  suggestRename,
  takenBasenames,
} from '@/lib/assetImport';

interface ProjectContextValue {
  project: AuthoringProject;
  activeExam: ExamBlueprint;
  setProject: (p: AuthoringProject) => void;
  /** Import files; identical basename+content skipped; content conflicts auto-renamed */
  addAssetsFromFiles: (files: FileList | File[]) => Promise<ProjectAsset[]>;
  /** Append / upsert prepared assets by mount path */
  addProjectAssets: (assets: ProjectAsset[]) => ProjectAsset[];
  updateAsset: (id: string, patch: Partial<ProjectAsset>) => void;
  removeAsset: (id: string) => void;
  updateBankProblem: (id: string, patch: Partial<BankProblem>) => void;
  addBankProblem: (partial?: Partial<BankProblem>) => BankProblem;
  duplicateProblem: (id: string) => BankProblem | null;
  removeBankProblem: (id: string) => void;
  selectExam: (id: string) => void;
  addExam: (partial?: Partial<ExamBlueprint>) => ExamBlueprint;
  duplicateExam: (id: string) => ExamBlueprint | null;
  removeExam: (id: string) => boolean;
  setExamProblemIds: (ids: string[]) => void;
  toggleExamProblem: (id: string) => void;
  updateExamMeta: (patch: Partial<ExamBlueprint>) => void;
  exportProject: () => Promise<void>;
  importProject: (file: File) => Promise<void>;
  /** Materialize + download *.exam.zip for an exam paper */
  exportExamPackage: (examId?: string) => Promise<void>;
  /** Materialize into exam session storage for /exam */
  pushExamToSession: (examId?: string) => Promise<void>;
  resetSample: () => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function patchActiveExam(
  prev: AuthoringProject,
  patch: Partial<ExamBlueprint>,
): AuthoringProject {
  const now = new Date().toISOString();
  return {
    ...prev,
    exams: prev.exams.map((e) =>
      e.id === prev.activeExamId ? { ...e, ...patch, updatedAt: now } : e,
    ),
    updatedAt: now,
  };
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProjectState] = useState<AuthoringProject>(() =>
    cloneProject(SAMPLE_PROJECT),
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadProjectFromStorage();
      if (cancelled) return;
      if (stored) setProjectState(stored);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    void saveProjectToStorage(project);
  }, [project, ready]);

  const setProject = useCallback((p: AuthoringProject) => {
    setProjectState({ ...p, updatedAt: new Date().toISOString() });
  }, []);

  const addProjectAssets = useCallback((incoming: ProjectAsset[]) => {
    const resolved: ProjectAsset[] = [];
    setProjectState((prev) => {
      const assets = [...prev.assets];
      for (const a of incoming) {
        const mount = mountPathForAsset(a);
        const sameIdx = assets.findIndex((x) => mountPathForAsset(x) === mount);
        if (sameIdx >= 0) {
          const next = { ...a, id: assets[sameIdx].id };
          assets[sameIdx] = next;
          resolved.push(next);
        } else {
          assets.push(a);
          resolved.push(a);
        }
      }
      return { ...prev, assets, updatedAt: new Date().toISOString() };
    });
    return resolved;
  }, []);

  const addAssetsFromFiles = useCallback(async (files: FileList | File[]) => {
    const pending = await readPendingImports(files);
    if (!pending.length) return [];

    const resolved: ProjectAsset[] = [];
    setProjectState((prev) => {
      const { ready, conflicts } = classifyAssetImports(pending, prev.assets);
      const taken = takenBasenames(prev.assets);
      const toAdd = ready.map((p) => pendingToAsset(p));
      for (const c of conflicts) {
        const name = suggestRename(c.pending.fileName, taken);
        taken.add(name.toLowerCase());
        toAdd.push(pendingToAsset(c.pending, name));
      }

      const assets = [...prev.assets];
      for (const a of toAdd) {
        const mount = mountPathForAsset(a);
        const sameIdx = assets.findIndex((x) => mountPathForAsset(x) === mount);
        if (sameIdx >= 0) {
          const next = { ...a, id: assets[sameIdx].id };
          assets[sameIdx] = next;
          resolved.push(next);
        } else {
          assets.push(a);
          resolved.push(a);
        }
      }
      return { ...prev, assets, updatedAt: new Date().toISOString() };
    });
    return resolved;
  }, []);

  const updateAsset = useCallback((id: string, patch: Partial<ProjectAsset>) => {
    setProjectState((prev) => ({
      ...prev,
      assets: prev.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const removeAsset = useCallback((id: string) => {
    setProjectState((prev) => ({
      ...prev,
      assets: prev.assets.filter((a) => a.id !== id),
      bank: prev.bank.map((b) => ({
        ...b,
        assetIds: b.assetIds.filter((x) => x !== id),
      })),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const updateBankProblem = useCallback(
    (id: string, patch: Partial<BankProblem>) => {
      setProjectState((prev) => ({
        ...prev,
        bank: prev.bank.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        updatedAt: new Date().toISOString(),
      }));
    },
    [],
  );

  const addBankProblem = useCallback((partial?: Partial<BankProblem>) => {
    const problem = createEmptyBankProblem(partial);
    setProjectState((prev) => ({
      ...prev,
      bank: [...prev.bank, problem],
      updatedAt: new Date().toISOString(),
    }));
    return problem;
  }, []);

  const duplicateProblem = useCallback((id: string) => {
    let created: BankProblem | null = null;
    setProjectState((prev) => {
      const src = prev.bank.find((b) => b.id === id);
      if (!src) return prev;
      created = duplicateBankProblem(src);
      return {
        ...prev,
        bank: [...prev.bank, created],
        updatedAt: new Date().toISOString(),
      };
    });
    return created;
  }, []);

  const removeBankProblem = useCallback((id: string) => {
    setProjectState((prev) => ({
      ...prev,
      bank: prev.bank.filter((b) => b.id !== id),
      exams: prev.exams.map((ex) => ({
        ...ex,
        problemIds: ex.problemIds.filter((x) => x !== id),
      })),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const selectExam = useCallback((id: string) => {
    setProjectState((prev) => {
      if (!prev.exams.some((e) => e.id === id)) return prev;
      return { ...prev, activeExamId: id, updatedAt: new Date().toISOString() };
    });
  }, []);

  const addExam = useCallback((partial?: Partial<ExamBlueprint>) => {
    const exam = createEmptyExamBlueprint(partial);
    setProjectState((prev) => ({
      ...prev,
      exams: [...prev.exams, exam],
      activeExamId: exam.id,
      updatedAt: new Date().toISOString(),
    }));
    return exam;
  }, []);

  const duplicateExam = useCallback((id: string) => {
    let created: ExamBlueprint | null = null;
    setProjectState((prev) => {
      const src = prev.exams.find((e) => e.id === id);
      if (!src) return prev;
      created = duplicateExamBlueprint(src);
      return {
        ...prev,
        exams: [...prev.exams, created],
        activeExamId: created.id,
        updatedAt: new Date().toISOString(),
      };
    });
    return created;
  }, []);

  const removeExam = useCallback((id: string) => {
    let ok = false;
    setProjectState((prev) => {
      if (prev.exams.length <= 1) return prev;
      if (!prev.exams.some((e) => e.id === id)) return prev;
      const exams = prev.exams.filter((e) => e.id !== id);
      ok = true;
      return {
        ...prev,
        exams,
        activeExamId:
          prev.activeExamId === id ? exams[0].id : prev.activeExamId,
        updatedAt: new Date().toISOString(),
      };
    });
    return ok;
  }, []);

  const setExamProblemIds = useCallback((ids: string[]) => {
    setProjectState((prev) => patchActiveExam(prev, { problemIds: ids }));
  }, []);

  const toggleExamProblem = useCallback((id: string) => {
    setProjectState((prev) => {
      const active = getActiveExam(prev);
      const has = active.problemIds.includes(id);
      const problemIds = has
        ? active.problemIds.filter((x) => x !== id)
        : [...active.problemIds, id];
      return patchActiveExam(prev, { problemIds });
    });
  }, []);

  const updateExamMeta = useCallback((patch: Partial<ExamBlueprint>) => {
    setProjectState((prev) => patchActiveExam(prev, patch));
  }, []);

  const exportProject = useCallback(async () => {
    await exportProjectZip(project);
  }, [project]);

  const importProject = useCallback(async (file: File) => {
    const next = await parseProjectZip(file);
    setProjectState({ ...next, updatedAt: new Date().toISOString() });
  }, []);

  const exportExamPackage = useCallback(
    async (examId?: string) => {
      const exam = materializeExam(project, examId);
      await exportExamZip(exam);
    },
    [project],
  );

  const pushExamToSession = useCallback(
    async (examId?: string) => {
      const exam = materializeExam(project, examId);
      await saveExamSession(exam);
    },
    [project],
  );

  const resetSample = useCallback(() => {
    setProjectState(cloneProject(SAMPLE_PROJECT));
  }, []);

  const activeExam = useMemo(() => getActiveExam(project), [project]);

  const value = useMemo(
    () => ({
      project,
      activeExam,
      setProject,
      addAssetsFromFiles,
      addProjectAssets,
      updateAsset,
      removeAsset,
      updateBankProblem,
      addBankProblem,
      duplicateProblem,
      removeBankProblem,
      selectExam,
      addExam,
      duplicateExam,
      removeExam,
      setExamProblemIds,
      toggleExamProblem,
      updateExamMeta,
      exportProject,
      importProject,
      exportExamPackage,
      pushExamToSession,
      resetSample,
    }),
    [
      project,
      activeExam,
      setProject,
      addAssetsFromFiles,
      addProjectAssets,
      updateAsset,
      removeAsset,
      updateBankProblem,
      addBankProblem,
      duplicateProblem,
      removeBankProblem,
      selectExam,
      addExam,
      duplicateExam,
      removeExam,
      setExamProblemIds,
      toggleExamProblem,
      updateExamMeta,
      exportProject,
      importProject,
      exportExamPackage,
      pushExamToSession,
      resetSample,
    ],
  );

  if (!ready) {
    return <div className="storage-boot">프로젝트 불러오는 중…</div>;
  }

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
