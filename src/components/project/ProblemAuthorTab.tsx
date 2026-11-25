import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Upload, X } from 'lucide-react';
import { AuthorChatDock } from '@/components/project/AuthorChatDock';
import { ProblemMarkdownEditor } from '@/components/problem/ProblemMarkdownEditor';
import { ProblemPanel } from '@/components/problem/ProblemPanel';
import { DataAssetPicker } from '@/components/project/DataAssetPicker';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import {
  emptyAuthorDraft,
  type AuthorDraft,
} from '@/lib/ai/authorChatStore';
import { bankToPreviewQuiz } from '@/lib/bankPreview';
import { mountPathForAsset } from '@/lib/assetPaths';
import { buildStarterCode } from '@/lib/starterCode';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';

const REF_SIDEBAR_W_MIN = 240;
const REF_SIDEBAR_W_DEFAULT = 300;
const PREVIEW_W_MIN = 280;
const PREVIEW_W_DEFAULT = 360;
const AUTHOR_DOCK_W_MIN = 300;
const AUTHOR_DOCK_W_DEFAULT = 400;

const TASK_LABELS: Record<TaskType, string> = {
  1: '작업형 1유형',
  2: '작업형 2유형',
  3: '작업형 3유형',
};

interface ProblemAuthorTabProps {
  project: AuthoringProject;
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
  addAssetsFromFiles: (files: FileList | File[]) => Promise<ProjectAsset[]>;
  addBankProblem: (partial?: Partial<BankProblem>) => BankProblem;
  mergeBankZips: (files: Array<File | string>) => Promise<{
    addedProblems: number;
    addedAssets: number;
    labels: string[];
  }>;
  /** Full replace load for .project.zip (File or Tauri filesystem path). */
  importProject: (source: File | string) => Promise<void>;
  onMessage: (msg: string) => void;
  onSavedNavigate: (problem: BankProblem) => void;
  onAssembleExam?: (problems: BankProblem[]) => void;
}

export function ProblemAuthorTab({
  project,
  addProjectAssets,
  addAssetsFromFiles,
  addBankProblem,
  mergeBankZips,
  importProject,
  onMessage,
  onSavedNavigate,
  onAssembleExam,
}: ProblemAuthorTabProps) {
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthorDraft>(() => emptyAuthorDraft(1));
  const [refSidebarWidth, setRefSidebarWidth] = useState(REF_SIDEBAR_W_DEFAULT);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_W_DEFAULT);
  const [dockWidth, setDockWidth] = useState(AUTHOR_DOCK_W_DEFAULT);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [listUnread, setListUnread] = useState(0);
  const [listAnnounced, setListAnnounced] = useState(0);
  const zipRef = useRef<HTMLInputElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const prevBankCount = useRef(project.bank.length);
  const pinnedTop = useRef(true);

  const refSidebarMax = useMemo(() => {
    if (typeof window === 'undefined') return 420;
    return Math.max(REF_SIDEBAR_W_MIN, Math.floor(window.innerWidth * 0.32));
  }, []);

  const previewMax = useMemo(() => {
    if (typeof window === 'undefined') return 640;
    return Math.max(PREVIEW_W_MIN, Math.floor(window.innerWidth * 0.42));
  }, []);

  const dockMax = useMemo(() => {
    if (typeof window === 'undefined') return 560;
    return Math.max(AUTHOR_DOCK_W_MIN, Math.floor(window.innerWidth * 0.42));
  }, []);

  const bankByType = useMemo(() => {
    const groups: Record<TaskType, BankProblem[]> = { 1: [], 2: [], 3: [] };
    for (const b of project.bank) groups[b.taskType].push(b);
    return groups;
  }, [project.bank]);

  const previewProblem = useMemo(() => {
    if (!previewId) return null;
    return project.bank.find((b) => b.id === previewId) ?? null;
  }, [project.bank, previewId]);

  const [previewQuiz, setPreviewQuiz] = useState<ReturnType<
    typeof bankToPreviewQuiz
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!previewProblem) {
      setPreviewQuiz(null);
      return;
    }
    void (async () => {
      const { withProjectAssetContents } = await import('@/lib/assetStore');
      const hydrated = await withProjectAssetContents(
        project,
        previewProblem.assetIds,
      );
      if (cancelled) return;
      setPreviewQuiz(bankToPreviewQuiz(hydrated, previewProblem));
    })();
    return () => {
      cancelled = true;
    };
  }, [project, previewProblem]);

  useEffect(() => {
    const added = project.bank.length - prevBankCount.current;
    prevBankCount.current = project.bank.length;
    if (added <= 0) return;
    if (pinnedTop.current) {
      listScrollRef.current?.scrollTo({ top: 0 });
      setListUnread(0);
      return;
    }
    setListUnread((n) => n + added);
  }, [project.bank.length]);

  useEffect(() => {
    if (listUnread === 0) {
      setListAnnounced(0);
      return;
    }
    const t = window.setTimeout(() => setListAnnounced(listUnread), 700);
    return () => window.clearTimeout(t);
  }, [listUnread]);

  const toggleRef = (id: string) => {
    setReferenceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const isTypeFullySelected = (tt: TaskType) => {
    const list = bankByType[tt];
    return list.length > 0 && list.every((b) => referenceIds.includes(b.id));
  };

  const toggleTypeSelection = (tt: TaskType) => {
    const list = bankByType[tt];
    if (!list.length) return;
    const ids = list.map((b) => b.id);
    if (isTypeFullySelected(tt)) {
      const drop = new Set(ids);
      setReferenceIds((prev) => prev.filter((id) => !drop.has(id)));
    } else {
      setReferenceIds((prev) => [...new Set([...prev, ...ids])]);
    }
  };

  const jumpToNewItems = () => {
    const el = listScrollRef.current;
    if (!el) return;
    pinnedTop.current = true;
    setListUnread(0);
    el.focus({ preventScroll: true });
    el.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const patchDraft = (p: Partial<AuthorDraft>) => {
    setDraft((prev) => ({ ...prev, ...p }));
  };

  const selectedCount = referenceIds.length;

  return (
    <div className="edit-page__body edit-page__body--with-dock author-tab">
      <div
        className="edit-sidebar-pane"
        style={{ width: refSidebarWidth, flexBasis: refSidebarWidth }}
      >
        <aside className="edit-sidebar author-tab__refs">
          <div className="author-tab__refs-head">
            <div className="author-tab__refs-title">
              <strong>참고 문제</strong>
              <span className="author-tab__refs-count">
                {selectedCount}/{project.bank.length}
              </span>
            </div>
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              onClick={() => {
                void (async () => {
                  try {
                    const { isTauriRuntime } = await import('@/lib/tauriRuntime');
                    if (isTauriRuntime()) {
                      const { pickZipPath, rustPeekZipKind } = await import(
                        '@/lib/tauriAssets'
                      );
                      const selected = await pickZipPath({ multiple: true });
                      if (!selected) return;
                      const paths = Array.isArray(selected)
                        ? selected
                        : [selected];
                      for (const path of paths) {
                        const kind = await rustPeekZipKind(path);
                        const base = path.split(/[\\/]/).pop() || path;
                        if (kind === 'project') {
                          onMessage(`프로젝트 불러오는 중: ${base}…`);
                          await importProject(path);
                          onMessage(`프로젝트 로드: ${base}`);
                        } else {
                          const result = await mergeBankZips([path]);
                          onMessage(
                            `문제은행 병합: 문제 +${result.addedProblems} · 파일 +${result.addedAssets} (${base})`,
                          );
                        }
                      }
                      return;
                    }
                    zipRef.current?.click();
                  } catch (err) {
                    onMessage(err instanceof Error ? err.message : String(err));
                  }
                })();
              }}
            >
              <Upload size={14} />
              ZIP
            </button>
            <input
              ref={zipRef}
              className="hidden-file"
              type="file"
              accept=".zip,application/zip,.exam.zip,.project.zip"
              multiple
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (!files.length) return;
                try {
                  const { peekZipKind } = await import('@/lib/zipKind');
                  const projectFiles: File[] = [];
                  const mergeFiles: File[] = [];
                  for (const file of files) {
                    const kind = await peekZipKind(file);
                    if (kind === 'project') projectFiles.push(file);
                    else mergeFiles.push(file);
                  }
                  for (const file of projectFiles) {
                    onMessage(`프로젝트 불러오는 중: ${file.name}…`);
                    await importProject(file);
                    onMessage(`프로젝트 로드: ${file.name}`);
                  }
                  if (mergeFiles.length) {
                    const result = await mergeBankZips(mergeFiles);
                    onMessage(
                      `문제은행 병합: 문제 +${result.addedProblems} · 파일 +${result.addedAssets}` +
                        (result.labels.length
                          ? ` (${result.labels.join(', ')})`
                          : ''),
                    );
                  }
                } catch (err) {
                  onMessage(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </div>

          <div className="author-tab__list-shell">
            <div
              ref={listScrollRef}
              className="author-tab__list-scroll"
              role="region"
              aria-label="참고 문제 목록"
              tabIndex={0}
              onScroll={(e) => {
                const el = e.currentTarget;
                const atTop = el.scrollTop <= 24;
                pinnedTop.current = atTop;
                if (atTop) setListUnread(0);
              }}
            >
              {([1, 2, 3] as TaskType[]).map((tt) => (
                <TypeGroup
                  key={tt}
                  taskType={tt}
                  list={bankByType[tt]}
                  referenceIds={referenceIds}
                  previewId={previewId}
                  allOn={isTypeFullySelected(tt)}
                  onToggleType={() => toggleTypeSelection(tt)}
                  onToggleRef={toggleRef}
                  onPreview={(id) => setPreviewId(id)}
                />
              ))}
            </div>

            <div className="author-tab__new-pill-wrap" aria-hidden={listUnread === 0}>
              {listUnread > 0 ? (
                <button
                  type="button"
                  className="author-tab__new-pill"
                  onClick={jumpToNewItems}
                  aria-label={
                    listUnread > 99
                      ? '99+ new items'
                      : `${listUnread} new ${listUnread === 1 ? 'item' : 'items'}`
                  }
                  onBlur={(e) => {
                    if (e.relatedTarget) return;
                    listScrollRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <span className="author-tab__new-pill-arrow" aria-hidden="true">
                    ↑
                  </span>
                  <span className="author-tab__new-pill-text">
                    {listUnread > 99 ? '99+' : listUnread} new
                    {listUnread === 1 ? ' item' : ' items'}
                  </span>
                </button>
              ) : null}
              <span role="status" aria-live="polite" className="visually-hidden">
                {listAnnounced > 0
                  ? listAnnounced > 99
                    ? '99+ new items'
                    : `${listAnnounced} new ${listAnnounced === 1 ? 'item' : 'items'}`
                  : ''}
              </span>
            </div>
          </div>
        </aside>
        <EdgeResizeHandle
          axis="x"
          value={refSidebarWidth}
          onChange={setRefSidebarWidth}
          min={REF_SIDEBAR_W_MIN}
          max={refSidebarMax}
          label="참고 문제 사이드바 너비 조절"
        />
      </div>

      {previewQuiz ? (
        <div
          className="author-tab__preview-pane problem-pane"
          style={{ width: previewWidth, flexBasis: previewWidth }}
        >
          <header className="author-tab__preview-head">
            <div className="author-tab__preview-head-text">
              <strong>미리보기</strong>
              <span>{previewQuiz.title}</span>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="미리보기 닫기"
              onClick={() => setPreviewId(null)}
            >
              <X size={16} />
            </button>
          </header>
          <ProblemPanel
            quiz={previewQuiz}
            zoomPct={previewZoom}
            lineHeightPct={150}
            onZoomChange={setPreviewZoom}
          />
          <EdgeResizeHandle
            axis="x"
            value={previewWidth}
            onChange={setPreviewWidth}
            min={PREVIEW_W_MIN}
            max={previewMax}
            label="문제 미리보기 너비 조절"
          />
        </div>
      ) : null}

      <main className="edit-main">
        <section className="edit-card form-grid">
          <h2 style={{ margin: 0 }}>제작 초안</h2>
          <p className="edit-page__sub">
            채팅으로 초안이 갱신됩니다. 여기서 직접 고쳐도 됩니다.
          </p>
          <TextField
            label="제목"
            value={draft.title}
            onChange={(title) => patchDraft({ title })}
          />
          <SelectField
            label="작업형"
            value={String(draft.taskType)}
            options={[
              { value: '1', label: '1유형', description: '단답 · 전처리/집계' },
              { value: '2', label: '2유형', description: '모델링 · CSV 제출' },
              { value: '3', label: '3유형', description: '단답 · 통계/검정' },
            ]}
            onChange={(v) => patchDraft({ taskType: Number(v) as TaskType })}
          />
          <label className="screen-settings-field">
            <span>메모</span>
            <textarea
              className="ce-field__input"
              rows={2}
              value={draft.note}
              onChange={(e) => patchDraft({ note: e.target.value })}
            />
          </label>
        </section>

        <section className="edit-card">
          <h2>데이터 파일</h2>
          <DataAssetPicker
            assets={project.assets}
            selectedIds={draft.assetIds}
            onChange={(assetIds) => patchDraft({ assetIds })}
          />
        </section>

        <section className="edit-card">
          <h2>문제 본문</h2>
          <ProblemMarkdownEditor
            value={draft.markdown}
            onChange={(markdown) => patchDraft({ markdown })}
            readOnly={false}
            assets={project.assets}
            onAttachImages={async (files) => {
              const added = await addAssetsFromFiles(files);
              onMessage(`${added.length}개 이미지를 라이브러리에 추가했습니다.`);
              return added;
            }}
          />
        </section>
      </main>

      <AuthorChatDock
        project={project}
        referenceIds={referenceIds}
        onReferenceIdsChange={setReferenceIds}
        draft={draft}
        onDraftChange={setDraft}
        width={dockWidth}
        onWidthChange={setDockWidth}
        maxWidth={dockMax}
        addProjectAssets={addProjectAssets}
        onSaveProblem={(partial) => {
          const taskType = partial.taskType ?? draft.taskType;
          const assetIds = partial.assetIds ?? draft.assetIds;
          const paths = assetIds
            .map((id) => project.assets.find((a) => a.id === id))
            .filter((a): a is ProjectAsset => Boolean(a))
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
        onSaved={(created, opts) => {
          onMessage(`문제 저장: ${created.title}`);
          if (opts?.navigate !== false) onSavedNavigate(created);
        }}
        onAssembleExam={onAssembleExam}
      />
    </div>
  );
}

function TypeGroup({
  taskType,
  list,
  referenceIds,
  previewId,
  allOn,
  onToggleType,
  onToggleRef,
  onPreview,
}: {
  taskType: TaskType;
  list: BankProblem[];
  referenceIds: string[];
  previewId: string | null;
  allOn: boolean;
  onToggleType: () => void;
  onToggleRef: (id: string) => void;
  onPreview: (id: string) => void;
}) {
  const typeCheckRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = typeCheckRef.current;
    if (!el) return;
    const some = list.some((b) => referenceIds.includes(b.id)) && !allOn;
    el.indeterminate = some;
  }, [list, referenceIds, allOn]);

  return (
    <section className="author-tab__section">
      <header className="author-tab__section-head">
        <label className="author-tab__type-select">
          <input
            ref={typeCheckRef}
            type="checkbox"
            checked={allOn}
            disabled={!list.length}
            onChange={onToggleType}
          />
          <span className="author-tab__section-title">{TASK_LABELS[taskType]}</span>
        </label>
        <span className="author-tab__section-meta">{list.length}</span>
      </header>

      {list.length === 0 ? (
        <p className="author-tab__empty-row">문제 없음</p>
      ) : (
        <div className="author-tab__item-list" role="group" aria-label={TASK_LABELS[taskType]}>
          {list.map((b) => {
            const checked = referenceIds.includes(b.id);
            const previewing = previewId === b.id;
            const checkId = `ref-check-${b.id}`;
            return (
              <div
                key={b.id}
                className={`author-tab__item ${checked ? 'is-checked' : ''} ${previewing ? 'is-previewing' : ''}`}
              >
                <input
                  id={checkId}
                  className="author-tab__item-input"
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleRef(b.id)}
                />
                <label htmlFor={checkId} className="author-tab__item-body">
                  <span className="author-tab__item-title">{b.title}</span>
                  <span className="author-tab__item-sub">
                    {b.number ? `${b.number} · ` : ''}
                    {b.assetIds.length} files
                    {b.note?.trim() ? ` · ${b.note.trim().slice(0, 48)}` : ''}
                  </span>
                </label>
                <button
                  type="button"
                  className={`author-tab__preview-btn ${previewing ? 'is-active' : ''}`}
                  aria-label={`${b.title} 미리보기`}
                  aria-pressed={previewing}
                  onClick={() => onPreview(b.id)}
                >
                  <Eye size={14} aria-hidden />
                  <span>미리보기</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
