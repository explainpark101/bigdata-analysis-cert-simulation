import {
  appendCsvMountNote,
  ensureProblemHasCsv,
  linkedCsvAssetIds,
} from '@/lib/ai/ensureProblemCsv';
import {
  applyCsvRenamesToDraftFields,
  upsertProjectAssets,
} from '@/lib/ai/csvAssetPersist';
import { verifyDraftSolvedWithStoredCsv } from '@/lib/ai/verifyProblemSolve';
import type { CodeByLanguage } from '@/types/exam';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';

/** Draft-shaped fields needed to ensure CSV + verify solve before bank write. */
export type VerifiableDraft = {
  title: string;
  markdown: string;
  language: 'python' | 'r';
  answerCode: CodeByLanguage;
  gradingCode: CodeByLanguage;
  shortAnswers: string[];
  assetIds: string[];
  taskType: TaskType;
};

export type PrepareVerifiedDraftResult =
  | {
      ok: true;
      draft: VerifiableDraft;
      csvAssetIds: string[];
      verifiedLanguage: 'python' | 'r';
    }
  | {
      ok: false;
      error: string;
      regenerate?: boolean;
      draft: VerifiableDraft;
    };

/**
 * Ensure ≥1 stored CSV is linked, then run answer code against those CSVs.
 * Mutates `project.assets` (hydrated bodies) and may attach newly created CSVs
 * onto `draft.assetIds` / markdown. Does not call onSave — caller persists.
 */
export async function prepareDraftForVerifiedSave(opts: {
  project: AuthoringProject;
  draft: VerifiableDraft;
  /** Shell used when synthesizing missing CSVs (id/folder). */
  problemShell: BankProblem;
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
}): Promise<PrepareVerifiedDraftResult> {
  let draft: VerifiableDraft = {
    ...opts.draft,
    answerCode: { ...opts.draft.answerCode },
    gradingCode: { ...opts.draft.gradingCode },
    shortAnswers: [...opts.draft.shortAnswers],
    assetIds: [...opts.draft.assetIds],
  };

  if (linkedCsvAssetIds(opts.project, draft.assetIds).length === 0) {
    const ensured = await ensureProblemHasCsv({
      project: opts.project,
      problem: {
        ...opts.problemShell,
        taskType: draft.taskType,
        assetIds: draft.assetIds,
        markdown: draft.markdown,
        title: draft.title,
      },
      addProjectAssets: opts.addProjectAssets,
    });
    upsertProjectAssets(opts.project.assets, ensured.created);
    draft = {
      ...draft,
      assetIds: ensured.assetIds,
      markdown: ensured.changed
        ? appendCsvMountNote(draft.markdown, ensured.csvNames)
        : draft.markdown,
    };
    if (ensured.renames.length) {
      draft = applyCsvRenamesToDraftFields(draft, ensured.renames);
    }
  }

  if (linkedCsvAssetIds(opts.project, draft.assetIds).length === 0) {
    return {
      ok: false,
      error: 'CSV_REQUIRED: draft still has no .csv assets after ensure',
      draft,
    };
  }

  const verified = await verifyDraftSolvedWithStoredCsv({
    project: opts.project,
    assetIds: draft.assetIds,
    taskType: draft.taskType,
    language: draft.language,
    answerCode: draft.answerCode,
    shortAnswers: draft.shortAnswers,
  });

  if (!verified.ok) {
    return {
      ok: false,
      error: verified.error,
      regenerate: verified.regenerate,
      draft,
    };
  }

  return {
    ok: true,
    draft,
    csvAssetIds: linkedCsvAssetIds(opts.project, draft.assetIds),
    verifiedLanguage: verified.language,
  };
}
