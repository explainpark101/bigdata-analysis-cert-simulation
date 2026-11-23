import { useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { AuthorChatDock } from '@/components/project/AuthorChatDock';
import { ProblemMarkdownEditor } from '@/components/problem/ProblemMarkdownEditor';
import { DataAssetPicker } from '@/components/project/DataAssetPicker';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import {
  emptyAuthorDraft,
  type AuthorDraft,
} from '@/lib/ai/authorChatStore';
import { mountPathForAsset } from '@/lib/assetPaths';
import { buildStarterCode } from '@/lib/starterCode';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';

const REF_SIDEBAR_W_MIN = 220;
const REF_SIDEBAR_W_DEFAULT = 280;
const AUTHOR_DOCK_W_MIN = 300;
const AUTHOR_DOCK_W_DEFAULT = 400;

const TASK_LABELS: Record<TaskType, string> = {
  1: '작업형 1유형',
  2: '작업형 2유형',
  3: '작업형 3유형',
};

interface ProblemAuthorTabProps {
  project: AuthoringProject;
  addProjectAssets: (assets: ProjectAsset[]) => ProjectAsset[];
  addAssetsFromFiles: (files: FileList | File[]) => Promise<ProjectAsset[]>;
  addBankProblem: (partial?: Partial<BankProblem>) => BankProblem;
  mergeBankZips: (files: File[]) => Promise<{
    addedProblems: number;
    addedAssets: number;
    labels: string[];
  }>;
  onMessage: (msg: string) => void;
  onSavedNavigate: (problem: BankProblem) => void;
}

export function ProblemAuthorTab({
  project,
  addProjectAssets,
  addAssetsFromFiles,
  addBankProblem,
  mergeBankZips,
  onMessage,
  onSavedNavigate,
}: ProblemAuthorTabProps) {
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<AuthorDraft>(() => emptyAuthorDraft(1));
  const [refSidebarWidth, setRefSidebarWidth] = useState(REF_SIDEBAR_W_DEFAULT);
  const [dockWidth, setDockWidth] = useState(AUTHOR_DOCK_W_DEFAULT);
  const zipRef = useRef<HTMLInputElement>(null);

  const refSidebarMax = useMemo(() => {
    if (typeof window === 'undefined') return 420;
    return Math.max(REF_SIDEBAR_W_MIN, Math.floor(window.innerWidth * 0.35));
  }, []);

  const dockMax = useMemo(() => {
    if (typeof window === 'undefined') return 560;
    return Math.max(AUTHOR_DOCK_W_MIN, Math.floor(window.innerWidth * 0.45));
  }, []);

  const bankByType = useMemo(() => {
    const groups: Record<TaskType, BankProblem[]> = { 1: [], 2: [], 3: [] };
    for (const b of project.bank) groups[b.taskType].push(b);
    return groups;
  }, [project.bank]);

  const toggleRef = (id: string) => {
    setReferenceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const patchDraft = (p: Partial<AuthorDraft>) => {
    setDraft((prev) => ({ ...prev, ...p }));
  };

  return (
    <div className="edit-page__body edit-page__body--with-dock author-tab">
      <div
        className="edit-sidebar-pane"
        style={{ width: refSidebarWidth, flexBasis: refSidebarWidth }}
      >
        <aside className="edit-sidebar author-tab__refs">
          <div className="author-tab__refs-head">
            <strong>참고 문제</strong>
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              onClick={() => zipRef.current?.click()}
            >
              <Upload size={14} />
              ZIP 추가
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
                  const result = await mergeBankZips(files);
                  onMessage(
                    `문제은행 병합: 문제 +${result.addedProblems} · 파일 +${result.addedAssets}` +
                      (result.labels.length
                        ? ` (${result.labels.join(', ')})`
                        : ''),
                  );
                } catch (err) {
                  onMessage(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          </div>
          <p className="edit-page__sub author-tab__refs-hint">
            여러 <code>.project.zip</code> / <code>.exam.zip</code> 을 불러와
            합친 뒤, 참고로 쓸 문항을 체크하세요.
          </p>
          {([1, 2, 3] as TaskType[]).map((tt) => (
            <div key={tt} className="bank-type-group">
              <div className="bank-type-group__head">
                <strong>{TASK_LABELS[tt]}</strong>
                <span className="badge">{bankByType[tt].length}</span>
              </div>
              <div className="quiz-list">
                {bankByType[tt].map((b) => {
                  const checked = referenceIds.includes(b.id);
                  return (
                    <label
                      key={b.id}
                      className={`quiz-item author-tab__ref-item ${checked ? 'active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRef(b.id)}
                      />
                      <span className="author-tab__ref-body">
                        <span className="quiz-item__top">
                          <span>{b.number || '·'}</span>
                          <span className="badge">{b.assetIds.length} files</span>
                        </span>
                        <span className="quiz-item__title">{b.title}</span>
                      </span>
                    </label>
                  );
                })}
                {!bankByType[tt].length ? (
                  <p className="edit-page__sub" style={{ margin: '4px 0 10px' }}>
                    문제 없음
                  </p>
                ) : null}
              </div>
            </div>
          ))}
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
        onSaved={(created) => {
          onMessage(`문제 저장: ${created.title}`);
          onSavedNavigate(created);
        }}
      />
    </div>
  );
}
