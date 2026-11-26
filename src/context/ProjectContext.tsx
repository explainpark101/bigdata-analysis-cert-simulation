import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  clearExamSession,
  createEmptyProject,
  loadProjectFromStorage,
  materializeExamAsync,
  saveExamSession,
  saveProjectToStorage,
} from '@/lib/projectIO';
import { exportExamZip } from '@/lib/examZip';
import { exportProjectZip, importProjectZip } from '@/lib/projectZip';
import { mergeBankFromZips } from '@/lib/mergeBankZip';
import {
  clearAssetContentCache,
  deleteAssetBody,
  persistExternalAssets,
  putAssetBody,
  replaceAllAssetBodies,
  stripExternalContents,
  usesExternalBody,
} from '@/lib/assetStore';
import { isTauriRuntime } from '@/lib/tauriRuntime';
import {
  rustExportProjectZipAsk,
  rustImportProjectZip,
  rustMergeProjectZip,
  rustPeekZipKind,
  withRustZipPath,
} from '@/lib/tauriAssets';
import type {
  AuthoringProject,
  BankProblem,
  ExamBlueprint,
  ProjectAsset,
} from '@/types/project';
import type { ExamSet } from '@/types/exam';
import { mountPathForAsset } from '@/lib/assetPaths';
import {
  classifyAssetImports,
  pendingToAsset,
  readPendingImport,
  suggestRename,
  takenBasenames,
} from '@/lib/assetImport';

interface ProjectContextValue {
  project: AuthoringProject;
  activeExam: ExamBlueprint;
  setProject: (p: AuthoringProject) => void;
  /** Import files; identical basename+content skipped; content conflicts auto-renamed */
  addAssetsFromFiles: (files: FileList | File[]) => Promise<ProjectAsset[]>;
  /** Append / upsert prepared assets by mount path (large bodies → IndexedDB). */
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
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
  /** File (web) or absolute filesystem path (Tauri dialog). */
  importProject: (source: File | string) => Promise<void>;
  /**
   * Open one zip (replace), or open the first and merge the rest.
   * Top-bar multi-select "프로젝트 불러오기".
   */
  importProjectSources: (
    sources: Array<File | string>,
  ) => Promise<{
    merged: boolean;
    labels: string[];
    addedProblems?: number;
    addedAssets?: number;
  }>;
  /** Merge one or more .project.zip / .exam.zip banks into the current project */
  mergeBankZips: (files: Array<File | string>) => Promise<{
    addedProblems: number;
    addedAssets: number;
    labels: string[];
  }>;
  /** Materialize + download *.exam.zip for an exam paper */
  exportExamPackage: (examId?: string) => Promise<void>;
  /** Materialize into exam session storage for /exam */
  pushExamToSession: (examId?: string) => Promise<ExamSet>;
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

  // Debounce IDB writes: structuredClone of large projects on every keystroke OOMs WebView.
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    if (!ready) return;
    const handle = window.setTimeout(() => {
      void saveProjectToStorage(projectRef.current);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [project, ready]);
  useEffect(() => {
    if (!ready) return;
    return () => {
      void saveProjectToStorage(projectRef.current);
    };
  }, [ready]);

  const setProject = useCallback((p: AuthoringProject) => {
    setProjectState({ ...p, updatedAt: new Date().toISOString() });
  }, []);

  const addProjectAssets = useCallback(async (incoming: ProjectAsset[]) => {
    const prev = projectRef.current;
    const assets = [...prev.assets];
    const resolved: ProjectAsset[] = [];

    for (const a of incoming) {
      const mount = mountPathForAsset(a);
      const sameIdx = assets.findIndex((x) => mountPathForAsset(x) === mount);
      const id = sameIdx >= 0 ? assets[sameIdx].id : a.id;
      if (usesExternalBody(a) && a.content) {
        await putAssetBody(id, a.encoding, a.content);
      }
      const lean: ProjectAsset = usesExternalBody(a)
        ? {
            ...a,
            id,
            content: '',
            byteLength: a.byteLength ?? a.content.length,
          }
        : { ...a, id };
      if (sameIdx >= 0) assets[sameIdx] = lean;
      else assets.push(lean);
      resolved.push(lean);
    }

    setProjectState({
      ...prev,
      assets,
      updatedAt: new Date().toISOString(),
    });
    return resolved;
  }, []);

  const addAssetsFromFiles = useCallback(async (files: FileList | File[]) => {
    // One file at a time: read → IDB → drop string → next (avoids folder-import OOM).
    const resolved: ProjectAsset[] = [];
    const list = Array.from(files);
    for (const file of list) {
      const pending = await readPendingImport(file);
      if (!pending) continue;
      const prev = projectRef.current;
      const { ready, conflicts, identicalCount } = classifyAssetImports(
        [pending],
        prev.assets,
      );
      if (identicalCount) continue;
      const taken = takenBasenames(prev.assets);
      const toAdd = ready.map((p) => pendingToAsset(p));
      for (const c of conflicts) {
        const name = suggestRename(c.pending.fileName, taken);
        taken.add(name.toLowerCase());
        toAdd.push(pendingToAsset(c.pending, name));
      }
      if (!toAdd.length) continue;
      const added = await addProjectAssets(toAdd);
      resolved.push(...added);
    }
    return resolved;
  }, [addProjectAssets]);

  const updateAsset = useCallback((id: string, patch: Partial<ProjectAsset>) => {
    setProjectState((prev) => ({
      ...prev,
      assets: prev.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const removeAsset = useCallback((id: string) => {
    void deleteAssetBody(id);
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
    const next = {
      ...projectRef.current,
      bank: [...projectRef.current.bank, problem],
      updatedAt: new Date().toISOString(),
    };
    projectRef.current = next;
    setProjectState(next);
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
    const next = {
      ...projectRef.current,
      exams: [...projectRef.current.exams, exam],
      activeExamId: exam.id,
      updatedAt: new Date().toISOString(),
    };
    projectRef.current = next;
    setProjectState(next);
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
    const lean = stripExternalContents(projectRef.current);
    if (isTauriRuntime()) {
      // Save dialog + zip write both run in Rust (JS dialog plugin OOMs).
      await rustExportProjectZipAsk(
        lean,
        `${lean.id || 'project'}.project.zip`,
      );
      return;
    }
    await exportProjectZip(lean);
  }, []);

  const importProject = useCallback(async (source: File | string) => {
    // Drop prior project + exam session so WebView can GC before inflate.
    clearAssetContentCache();
    const empty = createEmptyProject({ title: '불러오는 중…' });
    projectRef.current = empty;
    setProjectState(empty);
    await clearExamSession();
    await new Promise<void>((r) => {
      window.setTimeout(r, 0);
    });

    if (isTauriRuntime()) {
      // Stage HTML File → temp (if needed), then Rust streams zip→disk.
      // Never inflate CSV bodies in the WebView (OOM on gichul-sized zips).
      const next = await withRustZipPath(source, (path) =>
        rustImportProjectZip(path),
      );
      const stamped = {
        ...stripExternalContents(next),
        updatedAt: new Date().toISOString(),
      };
      projectRef.current = stamped;
      setProjectState(stamped);
      return;
    }
    if (!(source instanceof File)) {
      throw new Error('브라우저에서는 ZIP 파일이 필요합니다.');
    }
    const next = await importProjectZip(source);
    const lean = await persistExternalAssets(next);
    const stamped = { ...lean, updatedAt: new Date().toISOString() };
    projectRef.current = stamped;
    setProjectState(stamped);
  }, []);

  const mergeBankZips = useCallback(async (files: Array<File | string>) => {
    const list = Array.from(files);
    if (!list.length) {
      return { addedProblems: 0, addedAssets: 0, labels: [] as string[] };
    }

    // Always merge into the latest project (import-then-merge must not use stale state).
    let snapshot = stripExternalContents(
      await persistExternalAssets(projectRef.current),
    );
    let addedProblems = 0;
    let addedAssets = 0;
    const labels: string[] = [];

    if (isTauriRuntime()) {
      for (const source of list) {
        const label =
          typeof source === 'string'
            ? source
                .replace(/^.*[\\/]/, '')
                .replace(/\.(project|exam|problem)?\.zip$/i, '') || 'import'
            : source.name.replace(/\.(project|exam|problem)?\.zip$/i, '') ||
              'import';
        await withRustZipPath(source, async (path) => {
          const kind = await rustPeekZipKind(path);
          if (kind === 'exam') {
            throw new Error(
              `${label}: Tauri에서는 .project.zip 병합을 지원합니다. .exam.zip 은 브라우저에서 열어 주세요.`,
            );
          }
          const result = await rustMergeProjectZip(path, snapshot, label);
          snapshot = stripExternalContents(result.project);
          projectRef.current = snapshot;
          addedProblems += result.addedProblems;
          addedAssets += result.addedAssets;
          labels.push(result.label);
        });
        await new Promise<void>((r) => {
          window.setTimeout(r, 0);
        });
      }
      setProjectState(snapshot);
      return { addedProblems, addedAssets, labels };
    }

    const fileList = list.filter((f): f is File => f instanceof File);
    const result = await mergeBankFromZips(snapshot, fileList);
    projectRef.current = result.project;
    setProjectState(result.project);
    return {
      addedProblems: result.addedProblems,
      addedAssets: result.addedAssets,
      labels: result.labels,
    };
  }, []);

  /**
   * Open one project zip (replace), or open the first and merge the rest.
   * Used by top-bar "프로젝트 불러오기" multi-select.
   */
  const importProjectSources = useCallback(
    async (sources: Array<File | string>) => {
      const list = sources.filter(Boolean);
      if (!list.length) return { merged: false, labels: [] as string[] };
      const labelOf = (s: File | string) =>
        typeof s === 'string'
          ? s.split(/[\\/]/).pop() || s
          : s.name;
      // One zip at a time so WebView can GC between large imports.
      await importProject(list[0]);
      if (list.length === 1) {
        return { merged: false, labels: [labelOf(list[0])] };
      }
      await new Promise<void>((r) => {
        window.setTimeout(r, 0);
      });
      const result = await mergeBankZips(list.slice(1));
      return {
        merged: true,
        labels: [labelOf(list[0]), ...result.labels],
        addedProblems: result.addedProblems,
        addedAssets: result.addedAssets,
      };
    },
    [importProject, mergeBankZips],
  );

  const exportExamPackage = useCallback(
    async (examId?: string) => {
      const exam = await materializeExamAsync(project, examId);
      await exportExamZip(exam);
    },
    [project],
  );

  const pushExamToSession = useCallback(
    async (examId?: string) => {
      const exam = await materializeExamAsync(project, examId);
      await saveExamSession(exam);
      return exam;
    },
    [project],
  );

  const resetSample = useCallback(() => {
    clearAssetContentCache();
    void replaceAllAssetBodies();
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
      importProjectSources,
      mergeBankZips,
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
      importProjectSources,
      mergeBankZips,
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
