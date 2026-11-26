import { ensureIdbReady, idbGet, idbSet } from '@/lib/idb';

export interface Type2QuizSubmission {
  quizId: string;
  csv: string;
  submitFile: string;
  at: number;
}

/** examId → quizId → submission (result.csv body captured on submit). */
export type Type2ResultsMap = Record<
  string,
  Record<string, Type2QuizSubmission>
>;

async function loadMap(): Promise<Type2ResultsMap> {
  await ensureIdbReady();
  const map = await idbGet<Type2ResultsMap>('type2Results');
  return map && typeof map === 'object' ? map : {};
}

async function saveMap(map: Type2ResultsMap): Promise<void> {
  await ensureIdbReady();
  await idbSet('type2Results', map);
}

/** Persist a type-2 result.csv snapshot keyed by exam id + quiz id. */
export async function saveType2Submission(opts: {
  examId: string;
  quizId: string;
  csv: string;
  submitFile?: string;
}): Promise<void> {
  const map = await loadMap();
  const examBucket = { ...(map[opts.examId] ?? {}) };
  examBucket[opts.quizId] = {
    quizId: opts.quizId,
    csv: opts.csv,
    submitFile: opts.submitFile || 'result.csv',
    at: Date.now(),
  };
  map[opts.examId] = examBucket;
  await saveMap(map);
}

export async function loadType2Submission(
  examId: string,
  quizId: string,
): Promise<Type2QuizSubmission | undefined> {
  const map = await loadMap();
  return map[examId]?.[quizId];
}

export async function loadType2ExamSubmissions(
  examId: string,
): Promise<Record<string, Type2QuizSubmission>> {
  const map = await loadMap();
  return { ...(map[examId] ?? {}) };
}

export async function clearType2ExamSubmissions(examId: string): Promise<void> {
  const map = await loadMap();
  if (!map[examId]) return;
  delete map[examId];
  await saveMap(map);
}
