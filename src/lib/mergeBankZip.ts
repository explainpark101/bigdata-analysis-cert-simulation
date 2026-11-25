import { loadZip, zipKindFrom } from '@/lib/zipKind';
import { parseProjectZipFrom } from '@/lib/projectZip';
import { parseExamZipFrom } from '@/lib/examZip';
import {
  createEmptyBankProblem,
  createProjectAsset,
} from '@/lib/projectIO';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
} from '@/types/project';
import type { ExamSet, QuizProblem } from '@/types/exam';

export interface MergeBankZipResult {
  project: AuthoringProject;
  addedProblems: number;
  addedAssets: number;
  label: string;
}

function stem(name: string): string {
  return name.replace(/\.(project|exam)?\.zip$/i, '').replace(/\.zip$/i, '') || 'import';
}

function remapIds<T extends string>(
  oldId: T,
  map: Map<string, string>,
  prefix: string,
): string {
  const existing = map.get(oldId);
  if (existing) return existing;
  const next = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  map.set(oldId, next);
  return next;
}

function mergeProjectZip(
  current: AuthoringProject,
  incoming: AuthoringProject,
  label: string,
): MergeBankZipResult {
  const assetMap = new Map<string, string>();
  const problemMap = new Map<string, string>();

  const assets: ProjectAsset[] = [...current.assets];
  let addedAssets = 0;
  for (const a of incoming.assets) {
    const newId = remapIds(a.id, assetMap, 'asset');
    const folder = `imports/${label}`;
    const base = a.path.includes('/') ? a.path.split('/').pop()! : a.path;
    const path = `${folder}/${base}`;
    assets.push({
      ...a,
      id: newId,
      path,
      name: a.name || base,
    });
    addedAssets += 1;
  }

  const bank: BankProblem[] = [...current.bank];
  let addedProblems = 0;
  for (const p of incoming.bank) {
    const newId = remapIds(p.id, problemMap, 'bank');
    const assetIds = (p.assetIds ?? [])
      .map((id) => assetMap.get(id))
      .filter((id): id is string => Boolean(id));
    const sourceProblemId = p.sourceProblemId
      ? (problemMap.get(p.sourceProblemId) ??
        remapIds(p.sourceProblemId, problemMap, 'bank'))
      : undefined;
    bank.push({
      ...p,
      id: newId,
      assetIds,
      sourceProblemId,
      note: p.note
        ? `${p.note}\n(imported: ${label})`
        : `imported: ${label}`,
    });
    addedProblems += 1;
  }

  return {
    project: {
      ...current,
      assets,
      bank,
      updatedAt: new Date().toISOString(),
    },
    addedProblems,
    addedAssets,
    label,
  };
}

function quizToBank(
  quiz: QuizProblem,
  assetIds: string[],
  label: string,
): BankProblem {
  const taskType =
    quiz.taskType === 1 || quiz.taskType === 2 || quiz.taskType === 3
      ? quiz.taskType
      : 1;
  const shortAnswers =
    quiz.shortSlots?.map((s) => s.expected ?? '').filter((s) => s.trim()) ??
    (quiz.shortAnswer?.trim() ? [quiz.shortAnswer.trim()] : undefined);

  return createEmptyBankProblem({
    id: `bank-${crypto.randomUUID().slice(0, 8)}`,
    number: quiz.number,
    title: quiz.title || `imported · ${quiz.id}`,
    note: quiz.note
      ? `${quiz.note}\n(imported exam: ${label})`
      : `imported exam: ${label}`,
    showNoteOnExam: Boolean(quiz.showNoteOnExam),
    taskType,
    kind: quiz.kind,
    language: quiz.language,
    markdown: quiz.markdown,
    starterCode: quiz.starterCode,
    answerCode: quiz.answerCode ?? { python: '', r: '' },
    shortAnswer: shortAnswers?.[0] ?? quiz.shortAnswer ?? '',
    shortAnswers,
    gradingCode: quiz.gradingCode ?? { python: '', r: '' },
    assetIds,
    submitFormat: quiz.submitFormat ?? (taskType === 2 ? 'csv' : 'short'),
    submitFile: quiz.submitFile ?? (taskType === 2 ? 'result.csv' : undefined),
    testCases: quiz.testCases,
  });
}

function mergeExamZip(
  current: AuthoringProject,
  exam: ExamSet,
  label: string,
): MergeBankZipResult {
  const assets: ProjectAsset[] = [...current.assets];
  const bank: BankProblem[] = [...current.bank];
  let addedAssets = 0;
  let addedProblems = 0;

  for (const quiz of exam.quizzes) {
    const assetIds: string[] = [];
    for (const file of quiz.files ?? []) {
      if (!file.content) continue;
      const base = file.name || file.path.split('/').pop() || 'file';
      const libraryPath = `imports/${label}/${quiz.id}/${base}`;
      const asset = createProjectAsset(
        {
          name: base,
          content: file.content,
          encoding: file.encoding,
          mimeType: file.mimeType,
        },
        libraryPath,
      );
      assets.push(asset);
      assetIds.push(asset.id);
      addedAssets += 1;
    }
    bank.push(quizToBank(quiz, assetIds, label));
    addedProblems += 1;
  }

  return {
    project: {
      ...current,
      assets,
      bank,
      updatedAt: new Date().toISOString(),
    },
    addedProblems,
    addedAssets,
    label,
  };
}

/** Merge one .project.zip or .exam.zip bank/assets into the current project. */
export async function mergeBankFromZip(
  current: AuthoringProject,
  file: File,
): Promise<MergeBankZipResult> {
  // Single JSZip load — avoid detectZipKind + parse each loading the file.
  const zip = await loadZip(file);
  const kind = zipKindFrom(zip);
  const label = stem(file.name);
  if (kind === 'project') {
    const incoming = await parseProjectZipFrom(zip);
    return mergeProjectZip(current, incoming, label);
  }
  if (kind === 'exam') {
    const exam = await parseExamZipFrom(zip);
    return mergeExamZip(current, exam, label);
  }
  throw new Error(
    `${file.name}: project.json 또는 exam.json 이 있는 ZIP만 불러올 수 있습니다.`,
  );
}

/** Sequentially merge many zips (order preserved). */
export async function mergeBankFromZips(
  current: AuthoringProject,
  files: File[],
): Promise<{
  project: AuthoringProject;
  addedProblems: number;
  addedAssets: number;
  labels: string[];
}> {
  let project = current;
  let addedProblems = 0;
  let addedAssets = 0;
  const labels: string[] = [];
  for (const file of files) {
    const result = await mergeBankFromZip(project, file);
    project = result.project;
    addedProblems += result.addedProblems;
    addedAssets += result.addedAssets;
    labels.push(result.label);
  }
  return { project, addedProblems, addedAssets, labels };
}
