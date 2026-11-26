import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckSquare,
  Copy,
  Cpu,
  Download,
  FilePlus2,
  FolderPlus,
  Home,
  Library,
  ListChecks,
  ListTodo,
  PenLine,
  Play,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import { useProject } from '@/context/ProjectContext';
import { useExamSession } from '@/context/ExamSessionContext';
import { ProblemMarkdownEditor } from '@/components/problem/ProblemMarkdownEditor';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { CsvPreviewPane } from '@/components/project/CsvPreviewPane';
import { AssetLibraryTree } from '@/components/project/AssetLibraryTree';
import { DataAssetPicker } from '@/components/project/DataAssetPicker';
import { AssetImportConflictDialog } from '@/components/project/AssetImportConflictDialog';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import {
  pendingToAsset,
  takenBasenames,
  type AssetNameConflict,
  type ConflictResolution,
  type PendingAssetImport,
} from '@/lib/assetImport';
import { AnswerAuthorPanel } from '@/components/project/AnswerAuthorPanel';
import { ExamAssemblePreview } from '@/components/project/ExamAssemblePreview';
import { ExamAutoReviewQueueModal } from '@/components/project/ExamAutoReviewQueueModal';
import { ProjectExportModal } from '@/components/project/ProjectExportModal';
import { RuntimeLockQueueModal } from '@/components/project/RuntimeLockQueueModal';
import { VariantChatDock } from '@/components/project/VariantChatDock';
import { ModifyChatDock } from '@/components/project/ModifyChatDock';
import { ProblemAuthorTab } from '@/components/project/ProblemAuthorTab';
import { GlobalSettingsModal } from '@/components/settings/GlobalSettingsModal';
import { ConfirmModal } from '@/components/exam/ConfirmModal';
import type { ExamLanguage, QuizKind, SubmitFormat } from '@/types/exam';
import type { BankProblem, TaskType } from '@/types/project';
import { mountPathForAsset } from '@/lib/assetPaths';
import {
  collectAssignedProblemIds,
  type ProjectExportOptions,
} from '@/lib/projectIO';
import { buildStarterCode } from '@/lib/starterCode';
import {
  OFFICIAL_COUNTS,
  OFFICIAL_MAX_RUN_SECONDS,
  OFFICIAL_POINTS_PER_ITEM,
  OFFICIAL_TIME_LIMIT_MINUTES,
  OFFICIAL_TOTAL_ITEMS,
  OFFICIAL_TOTAL_POINTS,
  countBankByType,
  countIdsByType,
  isOfficialStructure,
  officialStructureSummary,
  pickOfficialProblemIds,
} from '@/lib/examOfficialSpec';
import { autoUploadExamFromProject } from '@/lib/autoUpload';
import { startExamAutoReview } from '@/lib/ai/examAutoReview';
import {
  countRunningExamAutoReviews,
  isExamAutoReviewRunning,
  subscribeExamAutoReviewQueue,
} from '@/lib/examAutoReviewQueue';
import {
  countBusyRuntimeLocks,
  subscribeRuntimeLockQueue,
} from '@/lib/runtimeMutex';

interface PendingImportSession {
  ready: PendingAssetImport[];
  conflicts: AssetNameConflict[];
  identicalCount: number;
}

type PendingDanger =
  | { kind: 'resetSample' }
  | { kind: 'removeAsset'; id: string; name: string }
  | { kind: 'removeProblem'; id: string; title: string }
  | { kind: 'removeExam'; id: string; title: string };

const PREVIEW_W_MIN = 260;
const PREVIEW_W_DEFAULT = 400;
const BANK_SIDEBAR_W_MIN = 200;
const BANK_SIDEBAR_W_DEFAULT = 260;
const VARIANT_DOCK_W_MIN = 300;
const VARIANT_DOCK_W_DEFAULT = 380;
const MODIFY_DOCK_W_MIN = 300;
const MODIFY_DOCK_W_DEFAULT = 380;

type Tab = 'assets' | 'bank' | 'author' | 'exam';
type BankListFilter = 'all' | 'unassigned';

const TASK_LABELS: Record<TaskType, string> = {
  1: '작업형 1유형',
  2: '작업형 2유형',
  3: '작업형 3유형',
};

export default function ProjectPage() {
  const {
    project,
    getProject,
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
    toggleExamProblem,
    setExamProblemIds,
    updateExamMeta,
    exportProject,
    importProjectSources,
    mergeBankZips,
    exportExamPackage,
    pushExamToSession,
    resetSample,
  } = useProject();
  const { setExam } = useExamSession();

  const [tab, setTab] = useState<Tab>('assets');
  const bankZipRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState(project.bank[0]?.id ?? '');
  const [selectedAssetId, setSelectedAssetId] = useState(
    project.assets[0]?.id ?? '',
  );
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_W_DEFAULT);
  const [bankSidebarWidth, setBankSidebarWidth] = useState(
    BANK_SIDEBAR_W_DEFAULT,
  );
  const [variantDockWidth, setVariantDockWidth] = useState(
    VARIANT_DOCK_W_DEFAULT,
  );
  const [modifyDockWidth, setModifyDockWidth] = useState(
    MODIFY_DOCK_W_DEFAULT,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [bankListFilter, setBankListFilter] =
    useState<BankListFilter>('all');
  const [autoReviewQueueOpen, setAutoReviewQueueOpen] = useState(false);
  const [runtimeQueueOpen, setRuntimeQueueOpen] = useState(false);
  const [runningAutoReviews, setRunningAutoReviews] = useState(0);
  const [busyRuntimes, setBusyRuntimes] = useState(0);
  const [activeExamReviewing, setActiveExamReviewing] = useState(false);
  const [variantOpen, setVariantOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingDanger, setPendingDanger] = useState<PendingDanger | null>(null);
  const [importSession, setImportSession] = useState<PendingImportSession | null>(
    null,
  );

  useEffect(
    () =>
      subscribeExamAutoReviewQueue(() => {
        setRunningAutoReviews(countRunningExamAutoReviews());
        setActiveExamReviewing(isExamAutoReviewRunning(activeExam.id));
      }),
    [activeExam.id],
  );

  useEffect(
    () =>
      subscribeRuntimeLockQueue(() => {
        setBusyRuntimes(countBusyRuntimeLocks());
      }),
    [],
  );
  const csvRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const finishImport = async (
    ready: PendingAssetImport[],
    conflicts: AssetNameConflict[],
    resolutions: ConflictResolution[],
    identicalCount: number,
  ) => {
    const toAdd = ready.map((p) => pendingToAsset(p));
    conflicts.forEach((c, i) => {
      const r = resolutions[i];
      if (!r || r.action === 'skip') return;
      toAdd.push(pendingToAsset(c.pending, r.newName));
    });
    const added = await addProjectAssets(toAdd);
    const skippedConflicts = resolutions.filter((r) => r.action === 'skip').length;
    setMessage(
      `추가 ${added.length} · 내용 동일 건너뜀 ${identicalCount}` +
        (skippedConflicts ? ` · 충돌 건너뜀 ${skippedConflicts}` : ''),
    );
    const last = added[added.length - 1];
    if (last) setSelectedAssetId(last.id);
    setImportSession(null);
  };

  const handleLibraryFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    // Stream one file at a time (full readPendingImports OOMs on big folders).
    setMessage('파일 불러오는 중…');
    try {
      const added = await addAssetsFromFiles(files);
      if (!added.length) {
        setMessage('가져올 CSV/이미지 파일이 없거나 모두 동일해 건너뛰었습니다.');
        return;
      }
      setMessage(`추가 ${added.length}`);
      const last = added[added.length - 1];
      if (last) setSelectedAssetId(last.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const previewMaxWidth = useMemo(() => {
    if (typeof window === 'undefined') return 720;
    return Math.max(PREVIEW_W_MIN, Math.floor(window.innerWidth * 0.55));
  }, []);

  const bankSidebarMaxWidth = useMemo(() => {
    if (typeof window === 'undefined') return 420;
    return Math.max(BANK_SIDEBAR_W_MIN, Math.floor(window.innerWidth * 0.4));
  }, []);

  const variantDockMaxWidth = useMemo(() => {
    if (typeof window === 'undefined') return 560;
    return Math.max(VARIANT_DOCK_W_MIN, Math.floor(window.innerWidth * 0.45));
  }, []);

  const modifyDockMaxWidth = useMemo(() => {
    if (typeof window === 'undefined') return 560;
    return Math.max(MODIFY_DOCK_W_MIN, Math.floor(window.innerWidth * 0.45));
  }, []);

  const problem = useMemo(
    () => project.bank.find((b) => b.id === selectedId) ?? project.bank[0],
    [project.bank, selectedId],
  );

  const selectedAsset = useMemo(
    () => project.assets.find((a) => a.id === selectedAssetId) ?? null,
    [project.assets, selectedAssetId],
  );

  const assignedProblemIds = useMemo(
    () => collectAssignedProblemIds(project),
    [project],
  );

  const unassignedProblemCount = useMemo(
    () => project.bank.filter((b) => !assignedProblemIds.has(b.id)).length,
    [project.bank, assignedProblemIds],
  );

  const bankByType = useMemo(() => {
    const groups: Record<TaskType, typeof project.bank> = {
      1: [],
      2: [],
      3: [],
    };
    for (const b of project.bank) {
      groups[b.taskType].push(b);
    }
    return groups;
  }, [project.bank]);

  const filteredBankByType = useMemo(() => {
    if (bankListFilter !== 'unassigned') return bankByType;
    const groups: Record<TaskType, typeof project.bank> = {
      1: [],
      2: [],
      3: [],
    };
    for (const tt of [1, 2, 3] as TaskType[]) {
      groups[tt] = bankByType[tt].filter((b) => !assignedProblemIds.has(b.id));
    }
    return groups;
  }, [bankByType, bankListFilter, assignedProblemIds]);

  const examTypeCounts = useMemo(
    () => countIdsByType(activeExam.problemIds, project.bank),
    [activeExam.problemIds, project.bank],
  );
  const examIsOfficial = isOfficialStructure(examTypeCounts);

  const patch = (p: Partial<NonNullable<typeof problem>>) => {
    if (!problem) return;
    updateBankProblem(problem.id, p);
  };

  const pathsForAssets = (assetIds: string[]) =>
    assetIds
      .map((id) => project.assets.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => mountPathForAsset(a));

  const patchWithStarter = (
    p: Partial<NonNullable<typeof problem>> & {
      taskType?: TaskType;
      assetIds?: string[];
    },
  ) => {
    if (!problem) return;
    const taskType = p.taskType ?? problem.taskType;
    const assetIds = p.assetIds ?? problem.assetIds;
    updateBankProblem(problem.id, {
      ...p,
      starterCode: buildStarterCode(taskType, pathsForAssets(assetIds)),
    });
  };

  const addTypedProblem = (taskType: TaskType) => {
    const p = addBankProblem({
      taskType,
      title: `제${taskType}유형 · 새 문제`,
      number: String(project.bank.filter((b) => b.taskType === taskType).length + 1).padStart(2, '0'),
      submitFormat: taskType === 2 ? 'csv' : 'short',
      submitFile: taskType === 2 ? 'result.csv' : undefined,
    });
    setSelectedId(p.id);
    setTab('bank');
  };

  return (
    <div className="edit-page">
      <header className="edit-page__header">
        <div>
          <h1>프로젝트 · 문제은행</h1>
          <p className="edit-page__sub">
            CSV·문제은행을 모은 뒤 시험지를 조립합니다. 공식 구성은 1유형 3·2유형
            1·3유형 2(100점). 시험지마다{' '}
            <code>.exam.zip</code> 내보내기·응시가 가능합니다.
          </p>
        </div>
        <div className="row edit-page__actions">
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => setRuntimeQueueOpen(true)}
            aria-label="런타임 큐"
            title="Pyodide / WebR 사용·대기 큐"
          >
            <Cpu size={16} />
            런타임 큐
            {busyRuntimes > 0 ? (
              <span className="exam-auto-review-header-badge">
                {busyRuntimes}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => setAutoReviewQueueOpen(true)}
            aria-label="자동 검수 큐"
            title="자동 검수 큐"
          >
            <ListTodo size={16} />
            검수 큐
            {runningAutoReviews > 0 ? (
              <span className="exam-auto-review-header-badge">
                {runningAutoReviews}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="전역 설정"
            title="전역 설정"
          >
            <Settings size={16} />
            설정
          </button>
          <Link className="ghost-btn btn-with-icon" to="/">
            <Home size={16} />
            홈
          </Link>
          <Link className="ghost-btn btn-with-icon" to="/exam">
            <Play size={16} />
            시험 화면
          </Link>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => setExportOpen(true)}
          >
            <Download size={16} />
            프로젝트 ZIP
          </button>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => {
              // Always use the HTML file picker. The JS @tauri-apps/plugin-dialog
              // open() path OOMs in WebView2 before the native dialog paints.
              zipRef.current?.click();
            }}
          >
            <Upload size={16} />
            프로젝트 불러오기
          </button>
          <button
            type="button"
            className="primary-btn btn-with-icon"
            onClick={async () => {
              await exportExamPackage(activeExam.id);
              setMessage(`시험 ZIP 저장: ${activeExam.title}`);
            }}
          >
            <Download size={16} />
            선택 시험 ZIP
          </button>
          <button
            type="button"
            className="primary-btn btn-with-icon"
            onClick={() => navigate('/project/exam-pick')}
          >
            <Play size={16} />
            선택 시험 보기
          </button>
          <button
            type="button"
            className="danger-btn btn-with-icon"
            onClick={() => setPendingDanger({ kind: 'resetSample' })}
          >
            <RotateCcw size={16} />
            샘플 초기화
          </button>
        </div>
        <input
          ref={zipRef}
          className="hidden-file"
          type="file"
          accept=".zip,application/zip,.project.zip,.exam.zip"
          multiple
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (!files.length) return;
            try {
              setMessage(
                files.length > 1
                  ? `프로젝트 ${files.length}개 불러오는 중…`
                  : '프로젝트 불러오는 중…',
              );
              // Prefer filesystem paths when WebView attaches File.path (Tauri).
              const result = await importProjectSources(files);
              setMessage(
                result.merged
                  ? `프로젝트 병합 로드: ${result.labels.join(', ')}` +
                      (result.addedProblems != null
                        ? ` · 문제 +${result.addedProblems}`
                        : '')
                  : `프로젝트 로드: ${result.labels[0]}`,
              );
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </header>

      <div className="project-tabs panel-tabs dark">
        <button
          type="button"
          className={`tab-btn btn-with-icon ${tab === 'assets' ? 'active' : ''}`}
          onClick={() => setTab('assets')}
        >
          <Library size={15} />
          파일 라이브러리 ({project.assets.length})
        </button>
        <button
          type="button"
          className={`tab-btn btn-with-icon ${tab === 'bank' ? 'active' : ''}`}
          onClick={() => setTab('bank')}
        >
          <ListChecks size={15} />
          문제은행 ({project.bank.length})
        </button>
        <button
          type="button"
          className={`tab-btn btn-with-icon ${tab === 'author' ? 'active' : ''}`}
          onClick={() => setTab('author')}
        >
          <PenLine size={15} />
          문제 제작
        </button>
        <button
          type="button"
          className={`tab-btn btn-with-icon ${tab === 'exam' ? 'active' : ''}`}
          onClick={() => setTab('exam')}
        >
          <CheckSquare size={15} />
          시험 조립 ({project.exams.length})
        </button>
      </div>

      {tab === 'assets' && (
        <div className="assets-layout">
          <div className="assets-layout__main">
            <section className="edit-card form-grid">
              <h2>프로젝트</h2>
              <label>
                제목
                <input
                  value={project.title}
                  onChange={(e) => setProject({ ...project, title: e.target.value })}
                />
              </label>
              <label>
                설명
                <input
                  value={project.description ?? ''}
                  onChange={(e) =>
                    setProject({ ...project, description: e.target.value })
                  }
                />
              </label>
            </section>

            <section className="edit-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>CSV · 이미지 라이브러리</h2>
                <div className="row">
                  <button
                    type="button"
                    className="ghost-btn btn-with-icon"
                    onClick={() => folderRef.current?.click()}
                  >
                    <FolderPlus size={16} />
                    폴더 불러오기
                  </button>
                  <button
                    type="button"
                    className="primary-btn btn-with-icon"
                    onClick={() => csvRef.current?.click()}
                  >
                    <FilePlus2 size={16} />
                    파일 여러 개 추가
                  </button>
                </div>
                <input
                  ref={csvRef}
                  className="hidden-file"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain,image/*,.png,.jpg,.jpeg,.gif,.webp,.svg"
                  multiple
                  onChange={async (e) => {
                    const files = e.target.files;
                    e.target.value = '';
                    await handleLibraryFiles(files);
                  }}
                />
                <input
                  ref={(el) => {
                    folderRef.current = el;
                    if (el) {
                      el.setAttribute('webkitdirectory', '');
                      el.setAttribute('directory', '');
                    }
                  }}
                  className="hidden-file"
                  type="file"
                  multiple
                  onChange={async (e) => {
                    const files = e.target.files;
                    e.target.value = '';
                    await handleLibraryFiles(files);
                  }}
                />
              </div>
              <p className="edit-page__sub">
                폴더/파일을 불러오면 트리로 정리됩니다. 코드/시험에서는 항상{' '}
                <code>data/파일명.csv</code> · <code>images/파일명</code> 으로
                불러옵니다. 파일명 충돌(내용 다름) 시 이름 변경 또는 건너뛰기를
                선택할 수 있습니다.
              </p>
              <AssetLibraryTree
                assets={project.assets}
                selectedId={selectedAssetId}
                onSelect={setSelectedAssetId}
                onUpdatePath={(id, path) => updateAsset(id, { path })}
                onRemove={(id) => {
                  const asset = project.assets.find((x) => x.id === id);
                  setPendingDanger({
                    kind: 'removeAsset',
                    id,
                    name: asset?.name || asset?.path || id,
                  });
                }}
              />
            </section>
          </div>
          <div
            className="csv-preview-pane"
            style={{ width: previewWidth, flexBasis: previewWidth }}
          >
            <EdgeResizeHandle
              axis="x"
              value={previewWidth}
              onChange={setPreviewWidth}
              min={PREVIEW_W_MIN}
              max={previewMaxWidth}
              invert
              label="CSV 미리보기 너비 조절"
            />
            <CsvPreviewPane asset={selectedAsset} />
          </div>
        </div>
      )}

      {tab === 'bank' && (
        <div
          className={`edit-page__body ${
            problem ? 'edit-page__body--with-dock' : ''
          }`}
        >
          <div
            className="edit-sidebar-pane"
            style={{ width: bankSidebarWidth, flexBasis: bankSidebarWidth }}
          >
            <aside className="edit-sidebar">
              <div className="bank-import-bar">
                <button
                  type="button"
                  className="ghost-btn btn-with-icon"
                  title="문제 ZIP을 여러 개 선택해 한 번에 불러오기"
                  onClick={() => bankZipRef.current?.click()}
                >
                  <Upload size={14} />
                  문제 불러오기
                </button>
                <input
                  ref={bankZipRef}
                  className="hidden-file"
                  type="file"
                  accept=".zip,application/zip,.exam.zip,.project.zip,.problem.zip"
                  multiple
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (!files.length) return;
                    try {
                      setMessage(
                        `문제 파일 불러오는 중… (${files.length}개)`,
                      );
                      const result = await mergeBankZips(files);
                      setMessage(
                        `문제 불러오기: 문제 +${result.addedProblems} · 파일 +${result.addedAssets}` +
                          (result.labels.length
                            ? ` (${result.labels.join(', ')})`
                            : ''),
                      );
                    } catch (err) {
                      setMessage(
                        err instanceof Error ? err.message : String(err),
                      );
                    }
                  }}
                />
              </div>
              <div
                className="bank-list-filter"
                role="group"
                aria-label="문제은행 목록 필터"
              >
                <button
                  type="button"
                  className={`bank-list-filter__btn ${
                    bankListFilter === 'all' ? 'active' : ''
                  }`}
                  aria-pressed={bankListFilter === 'all'}
                  onClick={() => setBankListFilter('all')}
                >
                  전체 ({project.bank.length})
                </button>
                <button
                  type="button"
                  className={`bank-list-filter__btn ${
                    bankListFilter === 'unassigned' ? 'active' : ''
                  }`}
                  aria-pressed={bankListFilter === 'unassigned'}
                  onClick={() => setBankListFilter('unassigned')}
                  title="어떤 시험 조립에도 넣지 않은 문제만 보기"
                >
                  미배정 ({unassignedProblemCount})
                </button>
              </div>
              {([1, 2, 3] as TaskType[]).map((tt) => (
                <div key={tt} className="bank-type-group">
                  <div className="bank-type-group__head">
                    <strong>
                      {TASK_LABELS[tt]}
                      {bankListFilter === 'unassigned'
                        ? ` · ${filteredBankByType[tt].length}`
                        : ''}
                    </strong>
                    <button
                      type="button"
                      className="primary-btn btn-with-icon"
                      onClick={() => addTypedProblem(tt)}
                    >
                      <Plus size={14} />
                      추가
                    </button>
                  </div>
                  <div className="quiz-list">
                    {filteredBankByType[tt].map((b) => {
                      const unassigned = !assignedProblemIds.has(b.id);
                      return (
                        <button
                          key={b.id}
                          id={`bank-problem-${b.id}`}
                          type="button"
                          className={`quiz-item ${b.id === problem?.id ? 'active' : ''}`}
                          onClick={() => setSelectedId(b.id)}
                        >
                          <div className="quiz-item__top">
                            <span>{b.number || '·'}</span>
                            <span className="quiz-item__badges">
                              {unassigned ? (
                                <span className="badge warn">미배정</span>
                              ) : null}
                              <span className="badge">
                                {b.assetIds.length} files
                              </span>
                            </span>
                          </div>
                          <div className="quiz-item__title">{b.title}</div>
                        </button>
                      );
                    })}
                    {!filteredBankByType[tt].length && (
                      <p className="edit-page__sub" style={{ margin: '4px 0 10px' }}>
                        {bankListFilter === 'unassigned'
                          ? '미배정 문제 없음'
                          : '문제 없음'}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </aside>
            <EdgeResizeHandle
              axis="x"
              value={bankSidebarWidth}
              onChange={setBankSidebarWidth}
              min={BANK_SIDEBAR_W_MIN}
              max={bankSidebarMaxWidth}
              label="문제은행 사이드바 너비 조절"
            />
          </div>

          <main className="edit-main">
            {!problem ? (
              <p>문제를 추가하세요.</p>
            ) : (
              <>
                <section className="edit-card form-grid">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {problem.title}
                      {!assignedProblemIds.has(problem.id) ? (
                        <span className="badge warn" title="어떤 시험 조립에도 포함되지 않음">
                          미배정
                        </span>
                      ) : null}
                    </h2>
                    <div className="row">
                      <button
                        type="button"
                        className="ghost-btn btn-with-icon"
                        onClick={() => setVariantOpen(true)}
                      >
                        <Sparkles size={16} />
                        변형 만들기
                      </button>
                      <button
                        type="button"
                        className="ghost-btn btn-with-icon"
                        onClick={() => {
                          const d = duplicateProblem(problem.id);
                          if (d) setSelectedId(d.id);
                        }}
                      >
                        <Copy size={16} />
                        복제
                      </button>
                      <button
                        type="button"
                        className="danger-btn btn-with-icon"
                        onClick={() =>
                          setPendingDanger({
                            kind: 'removeProblem',
                            id: problem.id,
                            title: problem.title,
                          })
                        }
                      >
                        <Trash2 size={16} />
                        삭제
                      </button>
                    </div>
                  </div>
                  <label>
                    내부 제목 (문제은행용 · 시험 UI에는 `제N유형 M번`으로 표시)
                    <input
                      value={problem.title}
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                  </label>
                  <label>
                    설명 (출제 시기·변형 메모 등)
                    <textarea
                      rows={3}
                      value={problem.note ?? ''}
                      onChange={(e) => patch({ note: e.target.value })}
                      placeholder="예: 2024년 기출 변형 / 중앙값 문항"
                    />
                  </label>
                  <label className="switch" style={{ width: 'fit-content' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(problem.showNoteOnExam)}
                      onChange={(e) =>
                        patch({ showNoteOnExam: e.target.checked })
                      }
                    />
                    시험지에 설명 표시
                  </label>
                  <div className="row">
                    <label style={{ flex: 1 }}>
                      번호 (은행 정렬용)
                      <input
                        value={problem.number}
                        onChange={(e) => patch({ number: e.target.value })}
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      작업형
                      <select
                        value={problem.taskType}
                        onChange={(e) =>
                          patchWithStarter({
                            taskType: Number(e.target.value) as TaskType,
                            submitFormat:
                              Number(e.target.value) === 2 ? 'csv' : 'short',
                            submitFile:
                              Number(e.target.value) === 2
                                ? 'result.csv'
                                : undefined,
                          })
                        }
                      >
                        <option value={1}>1유형</option>
                        <option value={2}>2유형</option>
                        <option value={3}>3유형</option>
                      </select>
                    </label>
                    <label style={{ flex: 1 }}>
                      종류
                      <select
                        value={problem.kind}
                        onChange={(e) =>
                          patch({ kind: e.target.value as QuizKind })
                        }
                      >
                        <option value="guide">guide</option>
                        <option value="practice">practice</option>
                        <option value="submit">submit</option>
                      </select>
                    </label>
                    <label style={{ flex: 1 }}>
                      제출
                      <select
                        value={problem.submitFormat ?? 'short'}
                        onChange={(e) =>
                          patch({
                            submitFormat: e.target.value as SubmitFormat,
                          })
                        }
                      >
                        <option value="short">단답</option>
                        <option value="csv">CSV</option>
                      </select>
                    </label>
                    <label style={{ flex: 1 }}>
                      언어
                      <select
                        value={problem.language}
                        onChange={(e) =>
                          patch({
                            language: e.target.value as ExamLanguage,
                          })
                        }
                      >
                        <option value="python">Python3</option>
                        <option value="r">R</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="edit-card">
                  <h2>이 문제에서 사용할 데이터 파일</h2>
                  <p className="edit-page__sub">
                    토글로 마운트할 CSV를 고릅니다. 런타임 경로는{' '}
                    <code>data/파일명.csv</code> 입니다. 이미지는 마크다운 에디터의
                    첨부 버튼으로 넣습니다.
                  </p>
                  <DataAssetPicker
                    assets={project.assets}
                    selectedIds={problem.assetIds}
                    onChange={(assetIds) => patchWithStarter({ assetIds })}
                  />
                </section>

                <section className="edit-card">
                  <h2>문제 본문</h2>
                  <ProblemMarkdownEditor
                    value={problem.markdown}
                    onChange={(markdown) => patch({ markdown })}
                    readOnly={false}
                    assets={project.assets}
                    onAttachImages={async (files) => {
                      const added = await addAssetsFromFiles(files);
                      setMessage(
                        `${added.length}개 이미지를 라이브러리에 추가하고 본문에 삽입했습니다.`,
                      );
                      return added;
                    }}
                  />
                </section>

                <AnswerAuthorPanel
                  project={project}
                  problem={problem}
                  onPatch={patch}
                />

                {problem.sourceProblemId ? (
                  <p className="edit-page__sub">
                    원본 문제 id: <code>{problem.sourceProblemId}</code>
                  </p>
                ) : null}

                {problem.taskType === 2 && (
                  <section className="edit-card">
                    <h2>채점 코드 · 작업형 2</h2>
                    <p className="edit-page__sub">
                      기준 모델·학습 방법·평가지표로 제출 <code>result.csv</code> 를
                      평가하는 스크립트입니다. (시험 문제 본문에는 표시되지 않음)
                    </p>
                    <h3 className="edit-card__subhead">Python</h3>
                    <div className="edit-code-wrap edit-code-wrap--tall">
                      <CodeEditor
                        value={problem.gradingCode?.python ?? ''}
                        language="python"
                        onChange={(python) =>
                          patch({
                            gradingCode: {
                              python,
                              r: problem.gradingCode?.r ?? '',
                            },
                          })
                        }
                      />
                    </div>
                    <h3 className="edit-card__subhead">R</h3>
                    <div className="edit-code-wrap">
                      <CodeEditor
                        value={problem.gradingCode?.r ?? ''}
                        language="r"
                        onChange={(r) =>
                          patch({
                            gradingCode: {
                              python: problem.gradingCode?.python ?? '',
                              r,
                            },
                          })
                        }
                      />
                    </div>
                  </section>
                )}
              </>
            )}
          </main>

          {problem && variantOpen ? (
            <VariantChatDock
              open={variantOpen}
              source={problem}
              project={project}
              width={variantDockWidth}
              onWidthChange={setVariantDockWidth}
              maxWidth={variantDockMaxWidth}
              onClose={() => setVariantOpen(false)}
              addProjectAssets={addProjectAssets}
              onSaveVariant={(partial: Partial<BankProblem>) => {
                const taskType = partial.taskType ?? problem.taskType;
                const assetIds = partial.assetIds ?? [];
                const paths = assetIds
                  .map((id) => project.assets.find((a) => a.id === id))
                  .filter((a): a is NonNullable<typeof a> => Boolean(a))
                  .map((a) => mountPathForAsset(a));
                return addBankProblem({
                  ...partial,
                  taskType,
                  number: String(
                    project.bank.filter((b) => b.taskType === taskType).length + 1,
                  ).padStart(2, '0'),
                  starterCode: buildStarterCode(taskType, paths),
                });
              }}
              onSaved={(created) => {
                setSelectedId(created.id);
                setMessage(`변형 문제 저장: ${created.title}`);
                setVariantOpen(false);
              }}
            />
          ) : problem ? (
            <ModifyChatDock
              problem={problem}
              project={project}
              width={modifyDockWidth}
              onWidthChange={setModifyDockWidth}
              maxWidth={modifyDockMaxWidth}
              addProjectAssets={addProjectAssets}
              onLinkCsv={({ assetIds, markdown, answerCode, gradingCode }) => {
                const paths = assetIds
                  .map((id) => project.assets.find((a) => a.id === id))
                  .filter((a): a is NonNullable<typeof a> => Boolean(a))
                  .map((a) => mountPathForAsset(a));
                updateBankProblem(problem.id, {
                  assetIds,
                  ...(markdown != null ? { markdown } : {}),
                  ...(answerCode != null ? { answerCode } : {}),
                  ...(gradingCode != null ? { gradingCode } : {}),
                  starterCode: buildStarterCode(problem.taskType, paths),
                });
                setMessage('CSV가 없어 자동 생성·연결했습니다.');
              }}
              onApply={(partial: Partial<BankProblem>) => {
                const taskType = partial.taskType ?? problem.taskType;
                const assetIds = partial.assetIds ?? problem.assetIds;
                const paths = assetIds
                  .map((id) => project.assets.find((a) => a.id === id))
                  .filter((a): a is NonNullable<typeof a> => Boolean(a))
                  .map((a) => mountPathForAsset(a));
                const next: BankProblem = {
                  ...problem,
                  ...partial,
                  id: problem.id,
                  number: problem.number,
                  taskType,
                  assetIds,
                  starterCode: buildStarterCode(taskType, paths),
                };
                updateBankProblem(problem.id, next);
                return next;
              }}
              onApplied={(updated) => {
                setMessage(`문제 반영: ${updated.title}`);
              }}
            />
          ) : null}
        </div>
      )}

      {tab === 'author' && (
        <ProblemAuthorTab
          project={project}
          addProjectAssets={addProjectAssets}
          addAssetsFromFiles={addAssetsFromFiles}
          addBankProblem={addBankProblem}
          mergeBankZips={mergeBankZips}
          onMessage={setMessage}
          onSavedNavigate={(created) => {
            setSelectedId(created.id);
            setTab('bank');
          }}
          onAssembleExam={(problems, opts) => {
            // This batch only — never pull older bank / sample problems.
            const counts = countBankByType(problems);
            const byId = new Map(problems.map((p) => [p.id, p]));
            const orderedIds = isOfficialStructure(counts)
              ? pickOfficialProblemIds(problems)
              : problems.map((p) => p.id);
            const ordered = orderedIds
              .map((id) => byId.get(id))
              .filter((p): p is (typeof problems)[number] => Boolean(p));
            if (!ordered.length) {
              setMessage('시험 조립 실패: 이번 생성 문항이 없습니다.');
              return;
            }
            const stamp = new Date().toLocaleString('ko-KR', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            const structureNote = isOfficialStructure(counts)
              ? '공식 구성(3+1+2)'
              : `맞춤 구성(1유형 ${counts[1]} · 2유형 ${counts[2]} · 3유형 ${counts[3]})`;
            const exam = addExam({
              title: `AI 자동 시험 ${stamp}`,
              description: `${structureNote} · 이번 생성 문항만 · ${ordered
                .map((p) => `제${p.taskType}유형`)
                .join(' · ')}`,
              problemIds: ordered.map((p) => p.id),
              timeLimitMinutes: OFFICIAL_TIME_LIMIT_MINUTES,
              maxRunSeconds: OFFICIAL_MAX_RUN_SECONDS,
            });
            setMessage(
              `시험 조립 완료: ${exam.title} · ${ordered.length}문항 (이번 생성분만)`,
            );
            // React state may lag; merge this batch + new exam for webhook upload.
            const bankById = new Map(project.bank.map((b) => [b.id, b]));
            for (const p of ordered) bankById.set(p.id, p);
            const uploadSnapshot = {
              ...project,
              bank: [...bankById.values()],
              exams: [
                ...project.exams.filter((e) => e.id !== exam.id),
                exam,
              ],
              activeExamId: exam.id,
            };
            void autoUploadExamFromProject(uploadSnapshot, exam.id).then(
              (msg) => {
                if (msg) setMessage((prev) => `${prev} · ${msg}`);
              },
            );
            // Stay on author tab while multi-paper batch is still running.
            if (opts?.navigate !== false) setTab('exam');
          }}
        />
      )}

      {tab === 'exam' && (
        <div className="exam-assemble-layout">
          <aside className="exam-paper-list edit-card">
            <div className="exam-paper-list__head">
              <h2>시험지</h2>
              <button
                type="button"
                className="ghost-btn btn-with-icon"
                onClick={() => {
                  const ex = addExam({
                    title: `새 시험지 ${project.exams.length + 1}`,
                  });
                  setMessage(`시험지 추가: ${ex.title}`);
                }}
              >
                <Plus size={15} />
                새 시험지
              </button>
            </div>
            <ul className="exam-paper-list__items">
              {project.exams.map((ex) => (
                <li key={ex.id}>
                  <button
                    type="button"
                    className={`exam-paper-list__item ${
                      ex.id === activeExam.id ? 'active' : ''
                    }`}
                    onClick={() => selectExam(ex.id)}
                  >
                    <strong>{ex.title}</strong>
                    <span>
                      문제 {ex.problemIds.length}개
                      {isExamAutoReviewRunning(ex.id) ? ' · 검수 중' : ''}
                    </span>
                  </button>
                  <div className="exam-paper-list__item-actions">
                    <button
                      type="button"
                      className="ghost-btn btn-with-icon"
                      title="복제"
                      onClick={() => {
                        const dup = duplicateExam(ex.id);
                        if (dup) setMessage(`복제: ${dup.title}`);
                      }}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="danger-btn btn-with-icon"
                      title="삭제"
                      disabled={project.exams.length <= 1}
                      onClick={() => {
                        if (project.exams.length <= 1) return;
                        setPendingDanger({
                          kind: 'removeExam',
                          id: ex.id,
                          title: ex.title,
                        });
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          <div className="exam-assemble-main">
            <section className="edit-card form-grid">
              <h2>시험지 메타</h2>
              <label>
                시험 제목
                <input
                  value={activeExam.title}
                  onChange={(e) => updateExamMeta({ title: e.target.value })}
                />
              </label>
              <label>
                설명
                <input
                  value={activeExam.description ?? ''}
                  onChange={(e) =>
                    updateExamMeta({ description: e.target.value })
                  }
                />
              </label>
              <label>
                제한 시간 (분)
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="180"
                  value={
                    activeExam.timeLimitMinutes == null
                      ? ''
                      : activeExam.timeLimitMinutes
                  }
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') {
                      updateExamMeta({ timeLimitMinutes: null });
                      return;
                    }
                    const n = Number(raw);
                    updateExamMeta({
                      timeLimitMinutes: Number.isFinite(n)
                        ? Math.max(0, Math.round(n))
                        : OFFICIAL_TIME_LIMIT_MINUTES,
                    });
                  }}
                />
              </label>
              <p className="edit-page__sub" style={{ marginTop: -4 }}>
                제13회 가이드 기준 {OFFICIAL_TIME_LIMIT_MINUTES}분(3시간).
                비우면 제한 없음.
              </p>
              <label>
                코드 최대 실행시간 (초)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={activeExam.maxRunSeconds ?? OFFICIAL_MAX_RUN_SECONDS}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    updateExamMeta({
                      maxRunSeconds: Number.isFinite(n)
                        ? Math.max(1, Math.round(n))
                        : OFFICIAL_MAX_RUN_SECONDS,
                    });
                  }}
                />
              </label>
              <p className="edit-page__sub" style={{ marginTop: -4 }}>
                코드 실행 1회당 제한입니다. 가이드 기준{' '}
                {OFFICIAL_MAX_RUN_SECONDS}초(1분), 초과 시 강제 취소.
              </p>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="primary-btn btn-with-icon"
                  disabled={
                    activeExamReviewing || !activeExam.problemIds.length
                  }
                  onClick={() => {
                    const result = startExamAutoReview(activeExam.id, {
                      getProject,
                      addProjectAssets,
                      updateBankProblem,
                    });
                    if (!result.started) {
                      if (result.reason === 'already_running') {
                        setMessage('이 시험지는 이미 자동 검수 중입니다.');
                        setAutoReviewQueueOpen(true);
                      } else if (result.reason === 'empty_exam') {
                        setMessage('포함할 문제가 없습니다.');
                      } else {
                        setMessage('자동 검수를 시작할 수 없습니다.');
                      }
                      return;
                    }
                    setMessage(
                      `자동 검수 시작: ${activeExam.title} · ${activeExam.problemIds.length}문제 병렬 실행`,
                    );
                    setAutoReviewQueueOpen(true);
                  }}
                >
                  <ShieldCheck size={15} />
                  {activeExamReviewing ? '검수 중…' : '자동 검수'}
                </button>
                <button
                  type="button"
                  className="primary-btn btn-with-icon"
                  onClick={async () => {
                    await exportExamPackage(activeExam.id);
                    setMessage(`시험 ZIP 저장: ${activeExam.title}`);
                  }}
                >
                  <Download size={15} />
                  이 시험지 내보내기
                </button>
                <button
                  type="button"
                  className="primary-btn btn-with-icon"
                  onClick={() => {
                    void pushExamToSession(activeExam.id).then((next) => {
                      setExam(next);
                      navigate('/exam');
                    });
                  }}
                >
                  <Play size={15} />
                  이 시험지 보기
                </button>
              </div>
              <p className="edit-page__sub" style={{ marginTop: -4 }}>
                자동 검수: 모든 문제 정답 검증 → 오류·불일치 시 AI 수정 →
                IndexedDB·미리보기 반영. 검수 중에도 다른 시험지로 이동·동시
                검수 가능.
              </p>
            </section>
            <section className="edit-card">
              <h2>포함할 문제 (유형별 선택 · 순서 = 응시 순서)</h2>
              <p className="edit-page__sub" style={{ marginTop: 0 }}>
                제13회 공식 구성: 1유형 {OFFICIAL_COUNTS[1]}문항(각{' '}
                {OFFICIAL_POINTS_PER_ITEM[1]}점) · 2유형 {OFFICIAL_COUNTS[2]}
                문항({OFFICIAL_POINTS_PER_ITEM[2]}점) · 3유형{' '}
                {OFFICIAL_COUNTS[3]}문항(각 {OFFICIAL_POINTS_PER_ITEM[3]}점) ={' '}
                {OFFICIAL_TOTAL_ITEMS}문항 / {OFFICIAL_TOTAL_POINTS}점
              </p>
              <p
                className="edit-page__sub"
                style={{
                  marginTop: 4,
                  color: examIsOfficial
                    ? 'var(--dq-ok-text, inherit)'
                    : 'var(--dq-danger-text, inherit)',
                }}
                role="status"
              >
                현재 선택: {officialStructureSummary(examTypeCounts)}
                {examIsOfficial ? ' — 공식 구성과 일치' : ' — 공식 구성과 다름 (연습용 허용)'}
              </p>
              <div className="row" style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="ghost-btn btn-with-icon"
                  onClick={() =>
                    setExamProblemIds(pickOfficialProblemIds(project.bank))
                  }
                  title="유형별로 가장 최근에 추가된 문항만으로 3·1·2 공식 구성 (초과 시 최신 후보에서 랜덤)"
                >
                  <ListChecks size={16} />
                  공식 구성으로 맞추기
                </button>
                <button
                  type="button"
                  className="ghost-btn btn-with-icon"
                  onClick={() =>
                    setExamProblemIds(project.bank.map((b) => b.id))
                  }
                >
                  <CheckSquare size={16} />
                  전체 포함
                </button>
                <button
                  type="button"
                  className="ghost-btn btn-with-icon"
                  onClick={() => setExamProblemIds([])}
                >
                  <Square size={16} />
                  전체 해제
                </button>
              </div>
              {([1, 2, 3] as TaskType[]).map((tt) => (
                <div key={tt} className="exam-type-block">
                  <div className="bank-type-group__head">
                    <strong>{TASK_LABELS[tt]}</strong>
                    <div className="row">
                      <button
                        type="button"
                        className="ghost-btn btn-with-icon"
                        onClick={() => {
                          const ids = new Set(activeExam.problemIds);
                          for (const b of bankByType[tt]) ids.add(b.id);
                          setExamProblemIds([...ids]);
                        }}
                      >
                        <CheckSquare size={14} />
                        유형 전체
                      </button>
                      <button
                        type="button"
                        className="ghost-btn btn-with-icon"
                        onClick={() => {
                          const drop = new Set(
                            bankByType[tt].map((b) => b.id),
                          );
                          setExamProblemIds(
                            activeExam.problemIds.filter((id) => !drop.has(id)),
                          );
                        }}
                      >
                        <Square size={14} />
                        유형 해제
                      </button>
                    </div>
                  </div>
                  <ul className="asset-pick-list">
                    {bankByType[tt].map((b) => (
                      <li key={b.id}>
                        <label className="asset-pick">
                          <input
                            type="checkbox"
                            checked={activeExam.problemIds.includes(b.id)}
                            onChange={() => toggleExamProblem(b.id)}
                          />
                          <span className="badge">제{b.taskType}유형</span>
                          <span>{b.title}</span>
                          {b.showNoteOnExam && b.note?.trim() ? (
                            <span className="badge">설명표시</span>
                          ) : null}
                          <span className="badge">{b.assetIds.length} csv</span>
                        </label>
                      </li>
                    ))}
                    {!bankByType[tt].length && (
                      <li className="edit-page__sub">
                        이 유형에 문제가 없습니다.
                      </li>
                    )}
                  </ul>
                </div>
              ))}
              <p className="edit-page__sub">
                현재 순서:{' '}
                {activeExam.problemIds
                  .map(
                    (id) =>
                      project.bank.find((b) => b.id === id)?.title || id,
                  )
                  .join(' → ') || '(없음)'}
              </p>
            </section>
          </div>

          <ExamAssemblePreview
            project={project}
            problemIds={activeExam.problemIds}
            onEditInBank={(id) => {
              setSelectedId(id);
              setTab('bank');
              setVariantOpen(false);
              setMessage('문제은행으로 이동했습니다.');
            }}
          />
        </div>
      )}

      {message && (
        <p className="edit-toast" style={{ padding: '0 18px 16px' }}>
          {message}
        </p>
      )}

      {importSession && (
        <AssetImportConflictDialog
          conflicts={importSession.conflicts}
          takenNames={takenBasenames(project.assets)}
          onCancel={() => setImportSession(null)}
          onResolveAll={(resolutions) => {
            void finishImport(
              importSession.ready,
              importSession.conflicts,
              resolutions,
              importSession.identicalCount,
            );
          }}
        />
      )}

      <ProjectExportModal
        open={exportOpen}
        project={project}
        busy={exportBusy}
        onCancel={() => {
          if (!exportBusy) setExportOpen(false);
        }}
        onConfirm={(options: ProjectExportOptions) => {
          void (async () => {
            try {
              setExportBusy(true);
              setMessage('프로젝트 ZIP 저장 중…');
              await exportProject(options);
              setExportOpen(false);
              const bits: string[] = [];
              if (options.omitUnassignedProblems) bits.push('미배정 문제 제외');
              if (options.omitUnassignedCsvs) bits.push('미배정 CSV 제외');
              setMessage(
                bits.length
                  ? `프로젝트 ZIP 저장 완료 (${bits.join(' · ')})`
                  : '프로젝트 ZIP 저장 완료',
              );
            } catch (err) {
              setMessage(err instanceof Error ? err.message : String(err));
            } finally {
              setExportBusy(false);
            }
          })();
        }}
      />

      <GlobalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      <RuntimeLockQueueModal
        open={runtimeQueueOpen}
        onClose={() => setRuntimeQueueOpen(false)}
      />

      <ExamAutoReviewQueueModal
        open={autoReviewQueueOpen}
        onClose={() => setAutoReviewQueueOpen(false)}
        onSelectExam={(examId) => {
          setAutoReviewQueueOpen(false);
          selectExam(examId);
          setTab('exam');
          setMessage('시험 조립 탭으로 이동했습니다.');
        }}
        onSelectProblem={(problemId, examId) => {
          setAutoReviewQueueOpen(false);
          selectExam(examId);
          setVariantOpen(false);
          setSelectedId(problemId);
          setTab('bank');
          const title =
            project.bank.find((b) => b.id === problemId)?.title ?? problemId;
          setMessage(`문제은행에서 선택: ${title}`);
          // Bank list mounts after tab switch — wait a tick before scrolling.
          window.setTimeout(() => {
            document
              .getElementById(`bank-problem-${problemId}`)
              ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }, 50);
        }}
      />

      <ConfirmModal
        open={Boolean(pendingDanger)}
        title={
          pendingDanger?.kind === 'resetSample'
            ? '샘플 초기화'
            : pendingDanger?.kind === 'removeAsset'
              ? '파일 제거'
              : pendingDanger?.kind === 'removeProblem'
                ? '문제 삭제'
                : pendingDanger?.kind === 'removeExam'
                  ? '시험지 삭제'
                  : '확인'
        }
        message={
          pendingDanger?.kind === 'resetSample'
            ? '프로젝트를 샘플 상태로 되돌릴까요?\n현재 문제은행·시험지·라이브러리 변경이 사라집니다.'
            : pendingDanger?.kind === 'removeAsset'
              ? `「${pendingDanger.name}」 파일을 라이브러리에서 제거할까요?`
              : pendingDanger?.kind === 'removeProblem'
                ? `「${pendingDanger.title}」 문제를 삭제할까요?`
                : pendingDanger?.kind === 'removeExam'
                  ? `「${pendingDanger.title}」 시험지를 삭제할까요?`
                  : ''
        }
        cancelLabel="취소"
        confirmLabel={
          pendingDanger?.kind === 'resetSample' ? '초기화' : '삭제'
        }
        confirmDanger
        onCancel={() => setPendingDanger(null)}
        onConfirm={() => {
          if (!pendingDanger) return;
          if (pendingDanger.kind === 'resetSample') {
            resetSample();
            setMessage('샘플 프로젝트로 초기화했습니다.');
          } else if (pendingDanger.kind === 'removeAsset') {
            const { id } = pendingDanger;
            removeAsset(id);
            if (selectedAssetId === id) {
              setSelectedAssetId(
                project.assets.find((x) => x.id !== id)?.id ?? '',
              );
            }
            setMessage(`파일 제거: ${pendingDanger.name}`);
          } else if (pendingDanger.kind === 'removeProblem') {
            const { id, title } = pendingDanger;
            removeBankProblem(id);
            setSelectedId(
              project.bank.find((b) => b.id !== id)?.id ?? '',
            );
            setVariantOpen(false);
            setMessage(`문제 삭제: ${title}`);
          } else if (pendingDanger.kind === 'removeExam') {
            const ok = removeExam(pendingDanger.id);
            if (ok) setMessage(`삭제: ${pendingDanger.title}`);
          }
          setPendingDanger(null);
        }}
      />
    </div>
  );
}
