import {
  assetBasename,
  mountPathForAsset,
  rewriteMountPaths,
} from '@/lib/assetPaths';
import { takenBasenames } from '@/lib/assetImport';
import { createProjectAsset } from '@/lib/projectIO';
import type { CodeByLanguage } from '@/types/exam';
import type { ProjectAsset } from '@/types/project';

/** Random 8-char hex suffix for collision-safe CSV names. */
export function randomCsvHash(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

/**
 * If `desired` basename is free, keep it. Otherwise append `_<hash>` before
 * the extension (never overwrite an existing library CSV of the same name).
 * Mutates `taken` (lowercase basenames) as names are claimed.
 */
export function allocateUniqueCsvFileName(
  desired: string,
  taken: Set<string>,
): { name: string; renamed: boolean; original: string } {
  const original = assetBasename(desired);
  const lower = original.toLowerCase();
  if (!taken.has(lower)) {
    taken.add(lower);
    return { name: original, renamed: false, original };
  }
  const m = original.match(/^(.*?)(\.csv)$/i);
  const stem = m?.[1] || original;
  const ext = m?.[2] || '.csv';
  for (let i = 0; i < 32; i += 1) {
    const next = `${stem}_${randomCsvHash()}${ext}`;
    if (!taken.has(next.toLowerCase())) {
      taken.add(next.toLowerCase());
      return { name: next, renamed: true, original };
    }
  }
  // Extremely unlikely: fall back to UUID stem.
  const fallback = `${stem}_${crypto.randomUUID()}${ext}`;
  taken.add(fallback.toLowerCase());
  return { name: fallback, renamed: true, original };
}

export type CsvMountRename = { from: string; to: string };

export type PersistGeneratedCsvResult = {
  /** Lean assets from addProjectAssets, with just-saved content restored. */
  added: ProjectAsset[];
  /** Mount-path renames when a basename already existed (`data/a.csv` → `data/a_<hash>.csv`). */
  renames: CsvMountRename[];
};

/**
 * Persist out/*.csv bodies into the project library as-is.
 * On basename collision, append a random hash — never overwrite.
 */
export async function persistGeneratedCsvAssets(opts: {
  files: Array<{ basename: string; content: string }>;
  folder: string;
  existingAssets: ProjectAsset[];
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
}): Promise<PersistGeneratedCsvResult> {
  const folder = opts.folder.replace(/^\/+|\/+$/g, '') || 'data';
  const taken = takenBasenames(opts.existingAssets);
  const renames: CsvMountRename[] = [];
  const pending: ProjectAsset[] = [];
  const contents: string[] = [];

  for (const file of opts.files) {
    const rawBase = assetBasename(file.basename.replace(/^out\//, ''));
    if (!rawBase.toLowerCase().endsWith('.csv')) continue;
    const { name, renamed, original } = allocateUniqueCsvFileName(
      rawBase,
      taken,
    );
    if (renamed) {
      renames.push({
        from: `data/${original}`,
        to: `data/${name}`,
      });
    }
    contents.push(file.content);
    pending.push(
      createProjectAsset(
        {
          name,
          content: file.content,
          encoding: 'utf-8',
          mimeType: 'text/csv',
        },
        `${folder}/${name}`,
      ),
    );
  }

  if (!pending.length) {
    return { added: [], renames: [] };
  }

  const lean = await opts.addProjectAssets(pending);
  const added: ProjectAsset[] = lean.map((a, i) => ({
    ...a,
    content: contents[i] ?? a.content,
  }));
  return { added, renames };
}

/** Rewrite mount paths inside free-form text (markdown / code). */
export function rewriteTextMountPaths(
  text: string,
  renames: CsvMountRename[],
): string {
  if (!renames.length) return text;
  return rewriteMountPaths(text, renames);
}

export function rewriteCodeByLanguageMountPaths(
  code: CodeByLanguage,
  renames: CsvMountRename[],
): CodeByLanguage {
  if (!renames.length) return code;
  return {
    python: rewriteTextMountPaths(code.python ?? '', renames),
    r: rewriteTextMountPaths(code.r ?? '', renames),
  };
}

/** Apply CSV mount renames across typical draft text fields. */
export function applyCsvRenamesToDraftFields<
  T extends {
    markdown: string;
    answerCode: CodeByLanguage;
    gradingCode: CodeByLanguage;
    datasetCode?: string;
    transformCode?: CodeByLanguage;
  },
>(draft: T, renames: CsvMountRename[]): T {
  if (!renames.length) return draft;
  return {
    ...draft,
    markdown: rewriteTextMountPaths(draft.markdown, renames),
    answerCode: rewriteCodeByLanguageMountPaths(draft.answerCode, renames),
    gradingCode: rewriteCodeByLanguageMountPaths(draft.gradingCode, renames),
    datasetCode: draft.datasetCode
      ? rewriteTextMountPaths(draft.datasetCode, renames)
      : draft.datasetCode,
    transformCode: draft.transformCode
      ? rewriteCodeByLanguageMountPaths(draft.transformCode, renames)
      : draft.transformCode,
  };
}

/** Sync renamed assets onto a turn-local project.assets array. */
export function upsertProjectAssets(
  projectAssets: ProjectAsset[],
  added: ProjectAsset[],
): void {
  for (const full of added) {
    const idx = projectAssets.findIndex((x) => x.id === full.id);
    if (idx >= 0) projectAssets[idx] = full;
    else projectAssets.push(full);
  }
}

export function csvMountPath(asset: ProjectAsset): string {
  return mountPathForAsset(asset);
}
