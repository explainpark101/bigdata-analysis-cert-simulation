import { loadZip, zipKindFrom } from '@/lib/zipKind';
import { parseExamZipFrom } from '@/lib/examZip';
import {
  createEmptyBankProblem,
  createProjectAsset,
  validateProject,
} from '@/lib/projectIO';
import {
  persistExternalAssets,
  putAssetBody,
  putAssetBodyBytes,
  usesExternalBody,
} from '@/lib/assetStore';
import { bytesToBase64 } from '@/lib/assetMedia';
import {
  listZipEntries,
  readZipEntryBytes,
  readZipEntryText,
  zipKindFromEntries,
} from '@/lib/zipStream';
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

const FILES_PREFIX = 'files/';
const PROJECT_JSON = 'project.json';

function stem(name: string): string {
  return name.replace(/\.(project|exam)?\.zip$/i, '').replace(/\.zip$/i, '') || 'import';
}

function remapIds(
  oldId: string,
  map: Map<string, string>,
  prefix: string,
): string {
  const existing = map.get(oldId);
  if (existing) return existing;
  const next = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  map.set(oldId, next);
  return next;
}

function findStreamAssetEntry(
  entries: Awaited<ReturnType<typeof listZipEntries>>,
  assetId: string,
) {
  const prefix = `${FILES_PREFIX}${assetId}/`;
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue;
    if (entry.name.startsWith(prefix)) return entry;
  }
  return null;
}

async function mergeProjectZipFromFile(
  current: AuthoringProject,
  file: File,
  label: string,
): Promise<MergeBankZipResult> {
  const entries = await listZipEntries(file);
  const metaEntry = entries.find(
    (e) => e.name === PROJECT_JSON || e.name.endsWith(`/${PROJECT_JSON}`),
  );
  if (!metaEntry) {
    throw new Error('ZIP must contain project.json (authoring project)');
  }

  const meta = validateProject(
    JSON.parse(await readZipEntryText(file, metaEntry)),
  );

  const assetMap = new Map<string, string>();
  const problemMap = new Map<string, string>();
  const assets: ProjectAsset[] = [...current.assets];
  let addedAssets = 0;

  for (const a of meta.assets) {
    const newId = remapIds(a.id, assetMap, 'asset');
    const folder = `imports/${label}`;
    const base = a.path.includes('/') ? a.path.split('/').pop()! : a.path;
    const path = `${folder}/${base}`;
    const found = findStreamAssetEntry(entries, a.id);
    let byteLength = a.byteLength ?? a.content?.length ?? 0;

    const stub: ProjectAsset = {
      ...a,
      id: newId,
      path,
      name: a.name || base,
      content: '',
      byteLength,
    };

    if (found) {
      const bytes = await readZipEntryBytes(file, found);
      byteLength = bytes.byteLength;
      stub.byteLength = byteLength;

      if (usesExternalBody(stub)) {
        await putAssetBodyBytes(newId, a.encoding, bytes, a.mimeType);
        assets.push(stub);
      } else if (a.encoding === 'base64') {
        assets.push({ ...stub, content: bytesToBase64(bytes) });
      } else {
        assets.push({
          ...stub,
          content: new TextDecoder('utf-8').decode(bytes),
        });
      }
    } else {
      assets.push(stub);
    }

    addedAssets += 1;
    await new Promise<void>((r) => {
      window.setTimeout(r, 0);
    });
  }

  const bank: BankProblem[] = [...current.bank];
  let addedProblems = 0;
  for (const p of meta.bank) {
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
  // Keep one entry per shortSlots field (including blanks) so 소문항 slots survive import.
  const shortAnswers =
    quiz.shortSlots && quiz.shortSlots.length > 0
      ? quiz.shortSlots.map((s) => s.expected ?? '')
      : quiz.shortAnswer?.trim()
        ? [quiz.shortAnswer.trim()]
        : undefined;

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

async function mergeExamZip(
  current: AuthoringProject,
  exam: ExamSet,
  label: string,
): Promise<MergeBankZipResult> {
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
      if (usesExternalBody(asset)) {
        await putAssetBody(asset.id, asset.encoding, asset.content, asset.mimeType);
        assets.push({ ...asset, content: '' });
      } else {
        assets.push(asset);
      }
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
  const label = stem(file.name);
  const entries = await listZipEntries(file);
  const kind = zipKindFromEntries(entries);

  if (kind === 'project') {
    return mergeProjectZipFromFile(current, file, label);
  }
  if (kind === 'exam') {
    // Exam zips are usually smaller; keep JSZip path for nested asset layout.
    const zip = await loadZip(file);
    if (zipKindFrom(zip) !== 'exam') {
      throw new Error(`${file.name}: exam.json 이 필요합니다.`);
    }
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
  let project = await persistExternalAssets(current);
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
