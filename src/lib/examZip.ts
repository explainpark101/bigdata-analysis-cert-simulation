import JSZip from 'jszip';
import type { ExamAsset, ExamSet, QuizProblem } from '@/types/exam';
import { validateExam } from './projectIO';
import { downloadBlob } from './download';
import { loadZip } from './zipKind';

const EXAM_JSON = 'exam.json';
const ASSETS_PREFIX = 'assets/';

function examMetaForZip(exam: ExamSet): ExamSet {
  return {
    ...exam,
    kind: 'exam',
    quizzes: exam.quizzes.map((q) => ({
      ...q,
      files: (q.files ?? []).map(({ path, name, encoding, mimeType }) => ({
        path,
        name,
        encoding,
        mimeType,
        content: '',
      })),
      answerDraft: undefined,
      notepad: undefined,
      submitted: false,
      submittedCsv: undefined,
      shortSlots: (q.shortSlots ?? []).map((s) => ({
        ...s,
        draft: '',
      })),
    })),
    notepads: Object.fromEntries(
      Object.keys(exam.notepads ?? {}).map((k) => [k, '']),
    ),
  };
}

export async function buildExamZip(exam: ExamSet): Promise<Blob> {
  const zip = new JSZip();
  zip.file(EXAM_JSON, JSON.stringify(examMetaForZip(exam), null, 2));

  for (const quiz of exam.quizzes) {
    for (const file of quiz.files ?? []) {
      const entry = `${ASSETS_PREFIX}${quiz.id}/${file.path}`;
      if (file.encoding === 'base64') {
        zip.file(entry, file.content, { base64: true });
      } else {
        zip.file(entry, file.content);
      }
    }
  }

  return zip.generateAsync({ type: 'blob' });
}

export async function parseExamZipFrom(zip: JSZip): Promise<ExamSet> {
  if (zip.file('project.json')) {
    throw new Error(
      'This ZIP is a project (project.json). Use the exam ZIP loader to pick an exam paper, or open it under /project.',
    );
  }
  const metaFile = zip.file(EXAM_JSON);
  if (!metaFile) {
    throw new Error('ZIP must contain exam.json');
  }
  const exam = validateExam(JSON.parse(await metaFile.async('string')));

  const quizzes: QuizProblem[] = [];
  for (const quiz of exam.quizzes) {
    const files: ExamAsset[] = [];
    const prefix = `${ASSETS_PREFIX}${quiz.id}/`;
    const listed = Object.keys(zip.files).filter(
      (p) => p.startsWith(prefix) && !zip.files[p].dir,
    );

    if (listed.length) {
      for (const full of listed) {
        const rel = full.slice(prefix.length);
        const entry = zip.file(full);
        if (!entry) continue;
        const meta = (quiz.files ?? []).find((f) => f.path === rel);
        const encoding = meta?.encoding ?? 'utf-8';
        const content =
          encoding === 'base64'
            ? await entry.async('base64')
            : await entry.async('string');
        files.push({
          path: rel,
          name: meta?.name ?? rel.split('/').pop() ?? rel,
          encoding,
          content,
          mimeType: meta?.mimeType,
        });
      }
    } else {
      for (const f of quiz.files ?? []) {
        if (f.content) files.push(f);
      }
    }

    quizzes.push({ ...quiz, files });
  }

  return { ...exam, kind: 'exam', quizzes };
}

export async function parseExamZip(blob: Blob | ArrayBuffer): Promise<ExamSet> {
  return parseExamZipFrom(await loadZip(blob));
}

export async function exportExamZip(exam: ExamSet): Promise<void> {
  const blob = await buildExamZip(exam);
  downloadBlob(`${exam.id || 'exam'}.exam.zip`, blob);
}

export async function readCsvFile(file: File): Promise<{
  name: string;
  content: string;
  mimeType: string;
}> {
  return {
    name: file.name,
    content: await file.text(),
    mimeType: file.type || 'text/csv',
  };
}
