import type {
  AuthoringProject,
  BankProblem,
  ExamBlueprint,
  ProjectAsset,
} from '@/types/project';
import type {
  ExamAsset,
  ExamSet,
  QuizProblem,
  ShortAnswerSlot,
} from '@/types/exam';
import { extractMarkdownImagePaths } from '@/lib/assetMedia';
import { mountPathForAsset, normalizeLibraryPath } from '@/lib/assetPaths';
import { ensureIdbReady, idbDelete, idbGet, idbSet } from '@/lib/idb';
import { buildStarterCode } from '@/lib/starterCode';
import {
  OFFICIAL_MAX_RUN_SECONDS,
  OFFICIAL_TIME_LIMIT_MINUTES,
  shortSlotPoints,
} from '@/lib/examOfficialSpec';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function circledLabel(index: number): string {
  return CIRCLED[index] ?? String(index + 1);
}

export function cloneProject(project: AuthoringProject): AuthoringProject {
  return structuredClone(project);
}

/** Minimal project used while swapping in a large import (frees prior RAM). */
export function createEmptyProject(
  partial?: Partial<AuthoringProject>,
): AuthoringProject {
  const exam = createEmptyExamBlueprint({
    title: partial?.title ? `${partial.title} 시험` : '새 시험지',
  });
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    kind: 'project',
    id: partial?.id ?? `proj-${crypto.randomUUID().slice(0, 8)}`,
    title: partial?.title ?? '새 프로젝트',
    description: partial?.description ?? '',
    assets: [],
    bank: [],
    exams: [exam],
    activeExamId: exam.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptyExamBlueprint(
  partial?: Partial<ExamBlueprint>,
): ExamBlueprint {
  const now = new Date().toISOString();
  return {
    id: partial?.id ?? `exam-${crypto.randomUUID().slice(0, 8)}`,
    title: partial?.title ?? '새 시험지',
    description: partial?.description ?? '',
    /** Default 180 min (3h) per 13th guide; null = no limit when explicitly cleared */
    timeLimitMinutes:
      partial?.timeLimitMinutes === undefined
        ? OFFICIAL_TIME_LIMIT_MINUTES
        : partial.timeLimitMinutes,
    maxRunSeconds:
      partial?.maxRunSeconds === undefined
        ? OFFICIAL_MAX_RUN_SECONDS
        : Math.max(
            1,
            Math.round(
              Number(partial.maxRunSeconds) || OFFICIAL_MAX_RUN_SECONDS,
            ),
          ),
    problemIds: partial?.problemIds ? [...partial.problemIds] : [],
    createdAt: partial?.createdAt ?? now,
    updatedAt: partial?.updatedAt ?? now,
  };
}

export function duplicateExamBlueprint(exam: ExamBlueprint): ExamBlueprint {
  const now = new Date().toISOString();
  return {
    ...structuredClone(exam),
    id: `exam-${crypto.randomUUID().slice(0, 8)}`,
    title: `${exam.title} (복제)`,
    createdAt: now,
    updatedAt: now,
  };
}

/** Active exam paper, or first paper if id missing. */
export function getActiveExam(
  project: AuthoringProject,
  examId?: string,
): ExamBlueprint {
  const id = examId ?? project.activeExamId;
  return (
    project.exams.find((e) => e.id === id) ??
    project.exams[0] ??
    createEmptyExamBlueprint({ title: project.title || '시험지' })
  );
}

/**
 * Asset ids required to materialize one exam paper (bank assetIds + markdown images).
 * Used to inflate only needed zip entries and avoid OOM on large project zips.
 */
export function collectExamAssetIds(
  project: AuthoringProject,
  examId?: string,
): string[] {
  const blueprint = getActiveExam(project, examId);
  const byId = new Map(project.bank.map((p) => [p.id, p]));
  const banks: BankProblem[] = [];
  const ids = new Set<string>();

  for (const pid of blueprint.problemIds) {
    const bank = byId.get(pid);
    if (!bank) continue;
    banks.push(bank);
    for (const assetId of bank.assetIds ?? []) ids.add(assetId);
  }

  for (const bank of banks) {
    for (const imgPath of extractMarkdownImagePaths(bank.markdown)) {
      const asset = project.assets.find((a) => {
        const mount = mountPathForAsset(a);
        return (
          mount === imgPath ||
          a.path === imgPath ||
          a.path === `./${imgPath}` ||
          a.name === imgPath
        );
      });
      if (asset) ids.add(asset.id);
    }
  }

  return [...ids];
}

type LegacyProject = AuthoringProject & {
  exam?: ExamBlueprint;
  exams?: ExamBlueprint[];
  activeExamId?: string;
};

/** Migrate singular `exam` → `exams[]` + `activeExamId`. */
export function normalizeProjectExams(
  raw: LegacyProject,
): Pick<AuthoringProject, 'exams' | 'activeExamId'> {
  let exams: ExamBlueprint[] = Array.isArray(raw.exams)
    ? raw.exams.map((e) =>
        createEmptyExamBlueprint({
          ...e,
          problemIds: Array.isArray(e.problemIds) ? e.problemIds : [],
          maxRunSeconds:
            typeof e.maxRunSeconds === 'number' ? e.maxRunSeconds : 60,
        }),
      )
    : [];
  if (!exams.length && raw.exam) {
    exams = [
      createEmptyExamBlueprint({
        ...raw.exam,
        problemIds: Array.isArray(raw.exam.problemIds)
          ? raw.exam.problemIds
          : [],
        maxRunSeconds:
          typeof raw.exam.maxRunSeconds === 'number'
            ? raw.exam.maxRunSeconds
            : 60,
      }),
    ];
  }
  if (!exams.length) {
    exams = [
      createEmptyExamBlueprint({
        title: raw.title ? `${raw.title} 시험` : '새 시험지',
      }),
    ];
  }
  const activeExamId =
    raw.activeExamId && exams.some((e) => e.id === raw.activeExamId)
      ? raw.activeExamId
      : exams[0].id;
  return { exams, activeExamId };
}

export function validateProject(data: unknown): AuthoringProject {
  if (!data || typeof data !== 'object') throw new Error('Invalid project JSON');
  const raw = data as LegacyProject;
  if (raw.schemaVersion !== 1 || raw.kind !== 'project') {
    throw new Error('Unsupported project schema (expect kind: project)');
  }
  if (!Array.isArray(raw.assets) || !Array.isArray(raw.bank)) {
    throw new Error('Invalid project: assets/bank required');
  }
  if (!Array.isArray(raw.exams) && !raw.exam) {
    throw new Error('Invalid project: exams (or legacy exam) required');
  }

  const { exams, activeExamId } = normalizeProjectExams(raw);
  const bank = raw.bank.map((b) => ({
    ...b,
    taskType: (b.taskType === 1 || b.taskType === 2 || b.taskType === 3
      ? b.taskType
      : guessTaskType(b.id, b.number, b.title)) as 1 | 2 | 3,
    note: b.note ?? '',
    showNoteOnExam: Boolean(b.showNoteOnExam),
    answerCode: {
      python: b.answerCode?.python ?? '',
      r: b.answerCode?.r ?? '',
    },
    shortAnswer: b.shortAnswer ?? '',
    shortAnswers: Array.isArray(b.shortAnswers)
      ? b.shortAnswers.map((s) => String(s ?? ''))
      : undefined,
    gradingCode: {
      python: b.gradingCode?.python ?? '',
      r: b.gradingCode?.r ?? '',
    },
    sourceProblemId:
      typeof b.sourceProblemId === 'string' ? b.sourceProblemId : undefined,
    datasetCode: typeof b.datasetCode === 'string' ? b.datasetCode : undefined,
  }));

  return {
    schemaVersion: 1,
    kind: 'project',
    id: raw.id,
    title: raw.title,
    description: raw.description,
    assets: raw.assets,
    bank,
    exams,
    activeExamId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** Exam-facing title: always `제N유형 M번` (M = order within type in exam). */
export function examDisplayTitle(taskType: 1 | 2 | 3, indexInType: number): string {
  return `제${taskType}유형 ${indexInType}번`;
}

function guessTaskType(id: string, number: string, title: string): 1 | 2 | 3 {
  const s = `${id} ${number} ${title}`.toLowerCase();
  if (/t2|제\s*2|type\s*2|유형\s*2|작업형\s*2/.test(s)) return 2;
  if (/t3|제\s*3|type\s*3|유형\s*3|작업형\s*3/.test(s)) return 3;
  return 1;
}

export async function loadProjectFromStorage(): Promise<AuthoringProject | null> {
  try {
    await ensureIdbReady();
    const data = await idbGet<unknown>('project');
    if (data == null) return null;
    const project = validateProject(data);
    // Migrate legacy inline CSV bodies into assetBodies, keep React RAM lean.
    const { persistExternalAssets } = await import('@/lib/assetStore');
    return persistExternalAssets(project);
  } catch {
    return null;
  }
}

export async function saveProjectToStorage(
  project: AuthoringProject,
): Promise<void> {
  await ensureIdbReady();
  const { persistExternalAssets } = await import('@/lib/assetStore');
  const lean = await persistExternalAssets(project);
  await idbSet('project', {
    ...lean,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadExamSession(): Promise<ExamSet | null> {
  try {
    await ensureIdbReady();
    const exam = await idbGet<ExamSet>('examSession');
    if (!exam || exam.schemaVersion !== 1 || !Array.isArray(exam.quizzes)) {
      return null;
    }
    return validateExam(exam);
  } catch {
    return null;
  }
}

export async function saveExamSession(exam: ExamSet): Promise<void> {
  await ensureIdbReady();
  await idbSet('examSession', {
    ...exam,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearExamSession(): Promise<void> {
  await ensureIdbReady();
  await idbDelete('examSession');
}

export function createEmptyBankProblem(
  partial?: Partial<BankProblem>,
): BankProblem {
  const id = partial?.id ?? `bank-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    number: partial?.number ?? '',
    title: partial?.title ?? '새 문제',
    note: partial?.note ?? '',
    showNoteOnExam: partial?.showNoteOnExam ?? false,
    taskType: partial?.taskType ?? 1,
    kind: partial?.kind ?? 'submit',
    language: partial?.language ?? 'python',
    markdown: partial?.markdown ?? '## 새 문제\n\n문제 내용을 작성하세요.\n',
    starterCode:
      partial?.starterCode ??
      buildStarterCode(partial?.taskType ?? 1, []),
    answerCode: partial?.answerCode ?? { python: '', r: '' },
    shortAnswer: partial?.shortAnswer ?? '',
    shortAnswers: partial?.shortAnswers,
    gradingCode: partial?.gradingCode ?? { python: '', r: '' },
    assetIds: partial?.assetIds ?? [],
    sourceProblemId: partial?.sourceProblemId,
    datasetCode: partial?.datasetCode,
    submitFormat: partial?.submitFormat ?? (partial?.taskType === 2 ? 'csv' : 'short'),
    submitFile: partial?.submitFile ?? (partial?.taskType === 2 ? 'result.csv' : undefined),
    testCases: partial?.testCases,
  };
}

function buildTestCases(bank: BankProblem): NonNullable<BankProblem['testCases']> {
  if (bank.testCases?.length) return bank.testCases;
  const short = bank.shortAnswer?.trim();
  if (short && bank.submitFormat !== 'csv') {
    return [{ id: 'short', name: '단답', expectIncludes: [short] }];
  }
  return [];
}

export function duplicateBankProblem(problem: BankProblem): BankProblem {
  return {
    ...structuredClone(problem),
    id: `bank-${crypto.randomUUID().slice(0, 8)}`,
    title: `${problem.title} (복제)`,
  };
}

export function createProjectAsset(
  file: {
    name: string;
    content: string;
    mimeType?: string;
    encoding?: 'utf-8' | 'base64';
  },
  path?: string,
): ProjectAsset {
  const name = file.name;
  const isImage =
    file.mimeType?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name);
  const rel = normalizeLibraryPath(path || (isImage ? `images/${name}` : `data/${name}`), {
    image: isImage,
    fileName: name,
  });
  const content = file.content;
  return {
    id: `asset-${crypto.randomUUID().slice(0, 8)}`,
    path: rel,
    name,
    encoding: file.encoding ?? (isImage ? 'base64' : 'utf-8'),
    content,
    byteLength: content.length,
    mimeType:
      file.mimeType ||
      (isImage ? 'application/octet-stream' : 'text/csv'),
  };
}

export function resolveAssets(
  project: AuthoringProject,
  assetIds: string[],
): ExamAsset[] {
  const map = new Map(project.assets.map((a) => [a.id, a]));
  const out: ExamAsset[] = [];
  const seenMount = new Set<string>();
  for (const id of assetIds) {
    const a = map.get(id);
    if (!a) continue;
    const mount = mountPathForAsset(a);
    if (seenMount.has(mount)) continue;
    seenMount.add(mount);
    out.push({
      path: mount,
      name: a.name,
      encoding: a.encoding,
      content: a.content,
      mimeType: a.mimeType,
    });
  }
  return out;
}

function collectQuizFiles(
  project: AuthoringProject,
  banks: BankProblem[],
): ExamAsset[] {
  const assetIds = [...new Set(banks.flatMap((b) => b.assetIds))];
  const files = resolveAssets(project, assetIds);
  const seen = new Set(files.map((f) => f.path));
  for (const bank of banks) {
    for (const imgPath of extractMarkdownImagePaths(bank.markdown)) {
      const asset = project.assets.find((a) => {
        const mount = mountPathForAsset(a);
        return (
          mount === imgPath ||
          a.path === imgPath ||
          a.path === `./${imgPath}` ||
          a.name === imgPath
        );
      });
      if (!asset) continue;
      const mount = mountPathForAsset(asset);
      if (seen.has(mount)) continue;
      files.push({
        path: mount,
        name: asset.name,
        encoding: asset.encoding,
        content: asset.content,
        mimeType: asset.mimeType,
      });
      seen.add(mount);
    }
  }
  return files;
}

/**
 * Expected short answers for one bank item.
 * Keep empty strings — they still need an input slot on the 문제 풀이 page.
 * (Filtering blanks previously dropped all slots when keys were unknown.)
 */
function bankExpectedAnswers(bank: BankProblem): string[] {
  if (Array.isArray(bank.shortAnswers) && bank.shortAnswers.length > 0) {
    return bank.shortAnswers.map((s) => String(s ?? '').trim());
  }
  if (bank.shortAnswer != null && String(bank.shortAnswer).length > 0) {
    return [String(bank.shortAnswer).trim()];
  }
  return [''];
}

function buildShortSlots(banks: BankProblem[]): ShortAnswerSlot[] {
  const slots: ShortAnswerSlot[] = [];
  let idx = 0;
  for (const bank of banks) {
    const answers = bankExpectedAnswers(bank);
    const points = shortSlotPoints(bank.taskType, answers.length);
    for (const expected of answers) {
      slots.push({
        id: `${bank.id}-slot-${idx}`,
        label: `답안 ${circledLabel(idx)}`,
        expected: expected || undefined,
        draft: '',
        points,
      });
      idx += 1;
    }
  }
  return slots;
}

function mergeMarkdown(banks: BankProblem[]): string {
  if (banks.length === 1) return banks[0].markdown;
  return banks
    .map((b, i) => {
      const body = b.markdown.replace(/^#+\s+[^\n]+\n?/, '').trim();
      return `## 문제 ${i + 1}\n\n${body}`;
    })
    .join('\n\n');
}

function emptyCodePair(): { python: string; r: string } {
  return { python: '', r: '' };
}

/**
 * Build a take-home ExamSet from one exam paper + bank.
 *
 * DataQ / 제13회 가이드 layout (official 3+1+2):
 * - 제1유형 (풀이용) + 문제 풀이 short-answer submit (3 items × 10점)
 * - 제2유형 code + result.csv submit (1 item × 40점, 5점 단위)
 * - 제3유형 (풀이용) + 문제 풀이 short-answer submit (2 items × 15점)
 */
/** Hydrate external asset bodies needed for one exam, then materialize. */
export async function materializeExamAsync(
  project: AuthoringProject,
  examId?: string,
): Promise<ExamSet> {
  const ids = collectExamAssetIds(project, examId);
  const { withProjectAssetContents } = await import('@/lib/assetStore');
  const hydrated = await withProjectAssetContents(project, ids);
  return materializeExam(hydrated, examId);
}

export function materializeExam(
  project: AuthoringProject,
  examId?: string,
): ExamSet {
  const blueprint = getActiveExam(project, examId);
  const byId = new Map(project.bank.map((p) => [p.id, p]));

  const ordered: BankProblem[] = [];
  for (const pid of blueprint.problemIds) {
    const bank = byId.get(pid);
    if (bank) ordered.push(bank);
  }

  const byType: Record<1 | 2 | 3, BankProblem[]> = { 1: [], 2: [], 3: [] };
  for (const bank of ordered) {
    byType[bank.taskType].push(bank);
  }

  // Preserve type order as first appearance in blueprint
  const typeOrder: Array<1 | 2 | 3> = [];
  for (const bank of ordered) {
    if (!typeOrder.includes(bank.taskType)) typeOrder.push(bank.taskType);
  }

  const quizzes: QuizProblem[] = [];
  const notepads: Record<string, string> = {};
  let submitSeq = 0;

  for (const taskType of typeOrder) {
    const banks = byType[taskType];
    if (!banks.length) continue;
    const group = `t${taskType}`;
    notepads[group] = '';

    if (taskType === 2) {
      for (const bank of banks) {
        submitSeq += 1;
        const files = collectQuizFiles(project, [bank]);
        const filePaths = files.map((f) => f.path);
        const bankStarter = bank.starterCode;
        const hasBankStarter = Boolean(
          bankStarter?.python?.trim() || bankStarter?.r?.trim(),
        );
        quizzes.push({
          id: bank.id,
          number: String(submitSeq).padStart(2, '0'),
          title: '제2유형',
          taskType: 2,
          note: bank.note?.trim() ? bank.note : undefined,
          showNoteOnExam: Boolean(bank.showNoteOnExam && bank.note?.trim()),
          kind: 'submit',
          viewMode: 'code',
          markdown: bank.markdown,
          language: bank.language,
          starterCode: hasBankStarter
            ? { ...bankStarter! }
            : buildStarterCode(2, filePaths),
          answerCode: bank.answerCode ? { ...bank.answerCode } : undefined,
          gradingCode: bank.gradingCode ? { ...bank.gradingCode } : undefined,
          files,
          submitFormat: 'csv',
          submitFile: bank.submitFile || 'result.csv',
          testCases: buildTestCases(bank),
          submitted: false,
          notepadGroup: group,
        });
      }
      continue;
    }

    // Type 1 / 3: practice (code) + short-answer submit page "문제 풀이"
    // Keep asset order aligned with exam problem order so starter loads
    // the selected paper's datasets (문제 1 → first file, …).
    const files = collectQuizFiles(project, banks);
    const orderedPaths: string[] = [];
    const seenPath = new Set<string>();
    for (const bank of banks) {
      for (const f of resolveAssets(project, bank.assetIds)) {
        if (seenPath.has(f.path)) continue;
        seenPath.add(f.path);
        orderedPaths.push(f.path);
      }
    }
    for (const f of files) {
      if (seenPath.has(f.path)) continue;
      seenPath.add(f.path);
      orderedPaths.push(f.path);
    }
    const lang = banks[0]?.language ?? 'python';
    const practiceId = `${blueprint.id || project.id}-t${taskType}-practice`;
    const submitId = `${blueprint.id || project.id}-t${taskType}-submit`;
    const firstStarter = banks[0]?.starterCode;
    const useFirstStarter =
      banks.length === 1 &&
      Boolean(firstStarter?.python?.trim() || firstStarter?.r?.trim());

    quizzes.push({
      id: practiceId,
      number: '',
      title: `제${taskType}유형 (풀이용)`,
      taskType,
      kind: 'practice',
      viewMode: 'code',
      markdown: mergeMarkdown(banks),
      language: lang,
      starterCode: useFirstStarter
        ? { ...firstStarter! }
        : buildStarterCode(taskType, orderedPaths),
      answerCode: banks[0]?.answerCode
        ? { ...banks[0].answerCode }
        : emptyCodePair(),
      files,
      submitted: false,
      notepadGroup: group,
    });

    submitSeq += 1;
    const slots = buildShortSlots(banks);
    quizzes.push({
      id: submitId,
      number: String(submitSeq).padStart(2, '0'),
      title: '문제 풀이',
      taskType,
      note: `제${taskType}유형 단답 제출`,
      showNoteOnExam: false,
      kind: 'submit',
      viewMode: 'short',
      markdown: mergeMarkdown(banks),
      language: lang,
      starterCode: emptyCodePair(),
      shortSlots: slots,
      shortAnswer: slots.map((s) => s.expected ?? '').join('\n'),
      files: [],
      submitFormat: 'short',
      testCases: [],
      submitted: false,
      notepadGroup: group,
    });
  }

  return {
    schemaVersion: 1,
    kind: 'exam',
    id: blueprint.id || `${project.id}-exam`,
    title: blueprint.title || project.title,
    description: blueprint.description ?? project.description,
    timeLimitMinutes: blueprint.timeLimitMinutes,
    maxRunSeconds:
      typeof blueprint.maxRunSeconds === 'number' && blueprint.maxRunSeconds > 0
        ? Math.round(blueprint.maxRunSeconds)
        : OFFICIAL_MAX_RUN_SECONDS,
    quizzes,
    notepads,
    createdAt: blueprint.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function validateExam(data: unknown): ExamSet {
  if (!data || typeof data !== 'object') throw new Error('Invalid exam JSON');
  const exam = data as ExamSet;
  if (exam.schemaVersion !== 1 || !Array.isArray(exam.quizzes)) {
    throw new Error('Unsupported or invalid exam schema');
  }
  if ((data as { kind?: string }).kind === 'project') {
    throw new Error('This is a project file — open it in /project, not /exam');
  }
  const maxRun =
    typeof exam.maxRunSeconds === 'number' && exam.maxRunSeconds > 0
      ? Math.round(exam.maxRunSeconds)
      : OFFICIAL_MAX_RUN_SECONDS;
  // Legacy materialize set answerDraft: '' which hid starter via ?? —
  // treat blank draft as unset so placeholder code shows again.
  const quizzes = exam.quizzes.map((q) =>
    q.answerDraft === '' ? { ...q, answerDraft: undefined } : q,
  );
  return { ...exam, quizzes, maxRunSeconds: maxRun };
}

export function submittedCount(exam: ExamSet): { done: number; total: number } {
  const submitQuizzes = exam.quizzes.filter((q) => q.kind === 'submit');
  const done = submitQuizzes.filter((q) => q.submitted).length;
  return { done, total: submitQuizzes.length };
}
