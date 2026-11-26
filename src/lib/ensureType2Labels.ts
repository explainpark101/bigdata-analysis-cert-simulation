import {
  chatContentToText,
  createChatCompletion,
} from '@/lib/ai/openaiCompatible';
import { loadAiSettings } from '@/lib/aiSettings';
import {
  examineeDataFiles,
  findType2LabelAsset,
  TYPE2_LABEL_BASENAME,
  type2LabelAliasPaths,
} from '@/lib/type2Assets';
import type { ExamAsset, QuizProblem, RunResult } from '@/types/exam';
import { mountAssetsToPyodide, mountAssetsToWebR } from '@/runtimes/fsMount';
import {
  preloadPyodide,
  readPyodideFileText,
  runPython,
} from '@/runtimes/pyodideRuntime';
import {
  readWebRFileText,
  runR,
  writeWebRFile,
} from '@/runtimes/webrRuntime';

export type EnsureType2LabelsResult = {
  /** Label CSV body (empty if unresolved). */
  csv: string;
  /** How labels were obtained. */
  source: 'existing' | 'answer_code' | 'ai_from_answer' | 'ai_generate' | 'none';
  note: string;
  /** Synthetic asset to merge into quiz.files for grading. */
  asset?: ExamAsset;
};

const LABEL_MISSING_RE =
  /(?:no such file|filenotfounderror|cannot open|does not exist)[\s\S]{0,80}test_labels?\.csv/i;

/** True when runtime/grading error looks like missing test_label(s).csv. */
export function isMissingType2LabelError(blob: string): boolean {
  if (LABEL_MISSING_RE.test(blob)) return true;
  return (
    /test_labels?\.csv/i.test(blob) &&
    /no such file|filenotfounderror|cannot open/i.test(blob)
  );
}

function decodeAssetText(file: ExamAsset): string {
  if (file.encoding === 'base64') {
    try {
      return atob(file.content);
    } catch {
      return file.content;
    }
  }
  return file.content;
}

function csvHead(text: string, maxLines = 12): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n');
}

/** Infer y_true column name from grading code `…test_label…["col"]`. */
export function inferLabelColumnFromGrading(grading: string): string | null {
  const patterns = [
    /test_labels?\.csv["']\s*\)\s*\[\s*["']([^"']+)["']\s*\]/i,
    /test_labels?\.csv["']\s*\)\s*\[["']([^"']+)["']\]/i,
    /read\.csv\([^)]*test_labels?[^)]*\)[\s\S]{0,120}\$?([A-Za-z_][\w]*)/i,
    /\[["']([^"']+)["']\]\s*(?:\.to_numpy|\.values)/i,
  ];
  for (const re of patterns) {
    const m = grading.match(re);
    if (m?.[1] && !/^(pred|prediction)$/i.test(m[1])) return m[1];
  }
  return null;
}

/**
 * Rename the primary prediction column of answer result.csv into a label CSV
 * that grading code can read.
 */
export function reshapeAnswerResultToLabels(
  resultCsv: string,
  gradingCode: string,
): string {
  const raw = resultCsv.replace(/\r\n/g, '\n').trim();
  if (!raw) return '';
  const lines = raw.split('\n').filter((l) => l.length > 0);
  if (!lines.length) return '';
  const headerCells = lines[0]
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, ''));
  const wanted =
    inferLabelColumnFromGrading(gradingCode) ||
    (headerCells.length === 1 ? headerCells[0] : null) ||
    'y';

  let valueIdx = headerCells.findIndex((c) =>
    /^(pred|prediction|label|y|target)$/i.test(c),
  );
  if (valueIdx < 0) {
    // Prefer non-id column
    valueIdx = headerCells.findIndex((c) => !/^(id|index|unnamed)/i.test(c));
  }
  if (valueIdx < 0) valueIdx = headerCells.length - 1;

  const idIdx = headerCells.findIndex((c) => /^id$/i.test(c));
  const out: string[] = [];
  if (idIdx >= 0 && idIdx !== valueIdx) {
    out.push(`id,${wanted}`);
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      out.push(`${cells[idIdx] ?? ''},${cells[valueIdx] ?? ''}`);
    }
  } else {
    out.push(wanted);
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      out.push(cells[valueIdx] ?? '');
    }
  }
  return `${out.join('\n')}\n`;
}

function extractCsvFromAiText(text: string): string | null {
  const fenced = text.match(/```(?:csv|text)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  if (!body.includes(',') && !body.includes('\n')) return null;
  const lines = body.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  // Drop accidental prose before header
  const start = lines.findIndex((l) => /[A-Za-z_]/.test(l) && l.includes(','));
  const csvLines = start >= 0 ? lines.slice(start) : lines;
  if (csvLines.length < 2) return null;
  return `${csvLines.join('\n')}\n`;
}

function extractPythonFromAiText(text: string): string | null {
  const m = text.match(/```(?:python|py)\s*([\s\S]*?)```/i);
  return m?.[1]?.trim() || null;
}

async function writeRuntimeFile(
  language: 'python' | 'r',
  path: string,
  content: string,
): Promise<void> {
  if (language === 'python') {
    const py = await preloadPyodide();
    const FS = (
      py as unknown as {
        FS: {
          writeFile: (p: string, d: string, opts?: { encoding?: string }) => void;
          analyzePath: (p: string) => { exists: boolean };
          mkdir: (p: string) => void;
        };
      }
    ).FS;
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      const dir = path.slice(0, slash);
      const parts = dir.split('/').filter(Boolean);
      let cur = '';
      for (const part of parts) {
        cur = cur ? `${cur}/${part}` : part;
        try {
          if (!FS.analyzePath(cur).exists) FS.mkdir(cur);
        } catch {
          try {
            FS.mkdir(cur);
          } catch {
            /* exists */
          }
        }
      }
    }
    FS.writeFile(path, content, { encoding: 'utf8' });
    return;
  }
  await writeWebRFile(path, content);
}

async function readRuntimeText(
  language: 'python' | 'r',
  path: string,
): Promise<string | null> {
  try {
    if (language === 'python') {
      const text = await readPyodideFileText(path);
      return text.trim() ? text : null;
    }
    const text = await readWebRFileText(path);
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

async function mountExamineeFiles(
  language: 'python' | 'r',
  files: ExamAsset[] | undefined,
): Promise<void> {
  const visible = examineeDataFiles(files);
  if (!visible.length) return;
  if (language === 'python') await mountAssetsToPyodide(visible);
  else await mountAssetsToWebR(visible);
}

async function runAnswerCode(
  quiz: QuizProblem,
  language: 'python' | 'r',
  timeoutMs: number,
): Promise<{ out: RunResult; resultCsv: string | null }> {
  const code =
    quiz.answerCode?.[language]?.trim() ||
    quiz.answerCode?.[language === 'python' ? 'r' : 'python']?.trim() ||
    '';
  const lang: 'python' | 'r' =
    quiz.answerCode?.[language]?.trim()
      ? language
      : quiz.answerCode?.python?.trim()
        ? 'python'
        : 'r';

  await mountExamineeFiles(lang, quiz.files);
  if (!code) {
    return {
      out: {
        ok: false,
        stdout: '',
        stderr: 'answerCode empty',
        durationMs: 0,
      },
      resultCsv: null,
    };
  }
  const out =
    lang === 'python'
      ? await runPython(code, { timeoutMs })
      : await runR(code, { timeoutMs });
  const resultCsv =
    (await readRuntimeText(lang, 'result.csv')) ||
    (await readRuntimeText(lang, quiz.submitFile || 'result.csv'));
  return { out, resultCsv };
}

function fileSnippets(files: ExamAsset[] | undefined): string {
  const visible = examineeDataFiles(files);
  return visible
    .slice(0, 4)
    .map((f) => {
      const body = decodeAssetText(f);
      return `### ${f.path}\n\`\`\`csv\n${csvHead(body, 10)}\n\`\`\``;
    })
    .join('\n\n');
}

async function aiReshapeOrGenerateLabels(opts: {
  quiz: QuizProblem;
  answerResultCsv: string | null;
  answerError: string;
  mode: 'reshape' | 'generate';
}): Promise<string | null> {
  let settings;
  try {
    settings = await loadAiSettings();
  } catch {
    return null;
  }
  if (!settings.baseUrl?.trim()) return null;
  // Allow keyless local gateways; remote endpoints need a key.
  if (
    !settings.apiKey?.trim() &&
    !/localhost|127\.0\.0\.1/i.test(settings.baseUrl)
  ) {
    return null;
  }

  const grading =
    opts.quiz.gradingCode?.[opts.quiz.language]?.trim() ||
    opts.quiz.gradingCode?.python?.trim() ||
    opts.quiz.gradingCode?.r?.trim() ||
    '';
  const answer =
    opts.quiz.answerCode?.[opts.quiz.language]?.trim() ||
    opts.quiz.answerCode?.python?.trim() ||
    opts.quiz.answerCode?.r?.trim() ||
    '';

  const wanted = inferLabelColumnFromGrading(grading);

  const system =
    opts.mode === 'reshape'
      ? [
          'You help grade 빅데이터분석기사 type-2 exams.',
          'Convert the answer-model result.csv into test_labels.csv (true labels / reference targets for the test rows).',
          'Output ONLY one fenced csv block. No prose.',
          wanted
            ? `The grading code expects column "${wanted}".`
            : 'Use a clear target column name matching the grading code if possible (y, label, or the train target name).',
        ].join(' ')
      : [
          'You help grade 빅데이터분석기사 type-2 exams.',
          'test_labels.csv is missing. Using the answer/reference code and train/test CSV heads, produce test_labels.csv for the test set.',
          'Prefer emitting a fenced ```csv block with the full label file.',
          'If the CSV would be too long, emit a fenced ```python block that reads data/*.csv and writes data/test_labels.csv (and data/test_label.csv) then stops.',
          'Do not invent columns that contradict the train schema. No prose outside fences.',
        ].join(' ');

  const user = [
    `문제: ${opts.quiz.title}`,
    opts.quiz.markdown?.trim() ? `## 문제\n${opts.quiz.markdown.trim().slice(0, 4000)}` : '',
    `## 정답 코드\n\`\`\`\n${answer.slice(0, 8000)}\n\`\`\``,
    grading
      ? `## 채점 코드\n\`\`\`\n${grading.slice(0, 6000)}\n\`\`\``
      : '',
    '## 제공 CSV 미리보기',
    fileSnippets(opts.quiz.files) || '(없음)',
    opts.answerResultCsv
      ? `## 정답 코드 result.csv\n\`\`\`csv\n${csvHead(opts.answerResultCsv, 40)}\n\`\`\``
      : '',
    opts.answerError
      ? `## 정답 코드 실행 오류\n\`\`\`\n${opts.answerError.slice(0, 3000)}\n\`\`\``
      : '',
    wanted ? `채점 코드가 기대하는 라벨 칼럼: ${wanted}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const completion = await createChatCompletion({
      settings,
      temperature: 0.1,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const text = chatContentToText(completion.message.content);
    const csv = extractCsvFromAiText(text);
    if (csv) return csv;
    return text;
  } catch {
    return null;
  }
}

async function tryRunAiPythonGenerator(
  language: 'python' | 'r',
  aiText: string,
  timeoutMs: number,
): Promise<string | null> {
  const py = extractPythonFromAiText(aiText);
  if (!py) return null;
  // Prefer python runtime for generator scripts
  const lang = language === 'r' && !py ? 'r' : 'python';
  if (lang !== 'python') return null;
  await preloadPyodide();
  const out = await runPython(py, { timeoutMs });
  if (!out.ok) return null;
  return (
    (await readRuntimeText('python', 'data/test_labels.csv')) ||
    (await readRuntimeText('python', 'data/test_label.csv')) ||
    (await readRuntimeText('python', 'test_labels.csv')) ||
    (await readRuntimeText('python', 'test_label.csv'))
  );
}

function toLabelAsset(csv: string): ExamAsset {
  return {
    path: `data/${TYPE2_LABEL_BASENAME}`,
    name: TYPE2_LABEL_BASENAME,
    encoding: 'utf-8',
    content: csv,
    mimeType: 'text/csv',
  };
}

/** Write label CSV under all alias paths used by grading scripts. */
export async function mountSynthesizedType2Labels(
  language: 'python' | 'r',
  csv: string,
): Promise<void> {
  if (!csv.trim()) return;
  for (const alias of type2LabelAliasPaths(`data/${TYPE2_LABEL_BASENAME}`)) {
    try {
      await writeRuntimeFile(language, alias, csv);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Ensure type-2 grading has test_label(s).csv available.
 * Prefer existing asset → answerCode result reshaped → AI fix/generate.
 */
export async function ensureType2LabelsForGrading(
  quiz: QuizProblem,
  opts: { timeoutMs: number; force?: boolean },
): Promise<EnsureType2LabelsResult> {
  const existing = findType2LabelAsset(quiz.files);
  if (existing && !opts.force) {
    const csv = decodeAssetText(existing);
    if (csv.trim()) {
      return {
        csv,
        source: 'existing',
        note: `기존 ${existing.name} 사용`,
        asset: existing,
      };
    }
  }

  const language = quiz.language ?? 'python';
  const grading =
    quiz.gradingCode?.[language]?.trim() ||
    quiz.gradingCode?.python?.trim() ||
    quiz.gradingCode?.r?.trim() ||
    '';

  // 1) Run answer / reference code to produce result.csv
  let answerError = '';
  let answerResult: string | null = null;
  try {
    const { out, resultCsv } = await runAnswerCode(
      quiz,
      language,
      opts.timeoutMs,
    );
    answerResult = resultCsv;
    if (!out.ok) {
      answerError = [out.stderr, out.stdout].filter(Boolean).join('\n');
    }
  } catch (err) {
    answerError = err instanceof Error ? err.message : String(err);
  }

  if (answerResult?.trim()) {
    const reshaped = reshapeAnswerResultToLabels(answerResult, grading);
    if (reshaped.trim()) {
      let csv = reshaped;
      let usedAi = false;
      const ai = await aiReshapeOrGenerateLabels({
        quiz,
        answerResultCsv: answerResult,
        answerError: '',
        mode: 'reshape',
      });
      if (ai) {
        const extracted =
          extractCsvFromAiText(ai) ||
          (ai.includes('\n') && ai.includes(',') ? ai : null);
        if (extracted?.trim()) {
          csv = extracted;
          usedAi = true;
        }
      }
      return {
        csv,
        source: usedAi ? 'ai_from_answer' : 'answer_code',
        note: usedAi
          ? '정답 코드 result.csv → AI가 test_labels.csv로 변환'
          : '정답 코드 result.csv → test_labels.csv로 변환',
        asset: toLabelAsset(csv),
      };
    }
  }

  // 2) Answer code failed or produced nothing — AI generate
  const aiText = await aiReshapeOrGenerateLabels({
    quiz,
    answerResultCsv: answerResult,
    answerError: answerError || 'result.csv missing',
    mode: 'generate',
  });
  if (aiText) {
    const csvDirect = extractCsvFromAiText(aiText);
    if (csvDirect?.trim()) {
      return {
        csv: csvDirect,
        source: 'ai_generate',
        note: '정답 코드 실행 실패 → AI가 test_labels.csv 생성',
        asset: toLabelAsset(csvDirect),
      };
    }
    await mountExamineeFiles(language, quiz.files);
    const fromScript = await tryRunAiPythonGenerator(
      language,
      aiText,
      opts.timeoutMs,
    );
    if (fromScript?.trim()) {
      return {
        csv: fromScript,
        source: 'ai_generate',
        note: '정답 코드 실행 실패 → AI 생성 스크립트로 test_labels.csv 작성',
        asset: toLabelAsset(fromScript),
      };
    }
  }

  return {
    csv: '',
    source: 'none',
    note: answerError
      ? `test_labels 확보 실패 (정답 코드 오류: ${answerError.slice(0, 200)})`
      : 'test_labels 확보 실패 (정답 코드·AI 모두 실패)',
  };
}
