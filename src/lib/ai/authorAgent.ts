import {
  chatContentToText,
  createChatCompletion,
  type ChatContentPart,
  type ChatMessage,
  type ChatToolDef,
} from '@/lib/ai/openaiCompatible';
import type { AiEndpointSettings } from '@/lib/aiSettings';
import type { AuthorDraft } from '@/lib/ai/authorChatStore';
import {
  authorDifficultyPromptEn,
  authorRuntimeEnvPromptEn,
  authorType13AnswerFormatPromptEn,
  authorType2BandPromptEn,
  validateNumericShortAnswers,
} from '@/lib/ai/authorRuntimePrompt';
import {
  isWebToolName,
  runWebTool,
  WEB_TOOL_DEFS,
} from '@/lib/ai/webTools';
import { mountPathForAsset } from '@/lib/assetPaths';
import { resolveAssets, createProjectAsset } from '@/lib/projectIO';
import { mountAssetsToPyodide } from '@/runtimes/fsMount';
import {
  preloadPyodide,
  runPython,
  readPyodideFileText,
} from '@/runtimes/pyodideRuntime';
import {
  ensureWebRDir,
  preloadWebR,
  readWebRFileText,
  runR,
  WEBR_HOME,
} from '@/runtimes/webrRuntime';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';

const MAX_TOOL_ROUNDS = 14;
const MAX_TOOL_ROUNDS_REQUIRE_SAVE = 20;

export interface AuthorAgentContext {
  settings: AiEndpointSettings;
  project: AuthoringProject;
  draft: AuthorDraft;
  referenceIds: string[];
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
}

export interface AuthorAgentResult {
  messages: ChatMessage[];
  draft: AuthorDraft;
  assistantText: string;
  savedProblem: BankProblem | null;
}

export type AuthorAgentProgress =
  | { kind: 'status'; text: string }
  | { kind: 'assistant_delta'; text: string }
  | { kind: 'tool'; name: string; phase: 'start' | 'done' };

function systemPrompt(requireSave: boolean): string {
  const lines = [
    'You are an exam-authoring agent for 빅데이터분석기사 실기 (DataQ / 한국데이터산업진흥원 style).',
    'Your job is to author ORIGINAL exam items that a real candidate could meet on the practical test — not toy drills.',
    '',
    '## Reference analysis (mandatory when references are selected)',
    '1) Call list_references, then get_reference for each selected id (or the most relevant ones per target task type).',
    '2) Analyze: task type, narrative domain, data schema (columns/dtypes), required skills (groupby, missing, encoding, model metrics, hypothesis tests, etc.), answer format, and difficulty.',
    '3) Infer a NEW problem: same skill family / exam intent, but different story, different column names, different seed/distribution, and different wording.',
    '4) NEVER copy reference markdown, filenames, column names, numbers, or answers verbatim.',
    '',
    '## Exam realism (anti-toy)',
    '- Prefer multi-step pipelines: cleaning → transform/feature → aggregate or model/test → report a formatted value.',
    '- Avoid one-liner arithmetic on a tiny hand-typed table with no CSV (e.g. "3+5 평균").',
    '- Type 1: preprocessing / aggregation / ranking / missing / datetime / string handling on tabular CSV; short **numeric** answers only (after round/trunc).',
    '- Type 2: train/test (or similar) CSVs, modeling or scoring workflow, submit a result CSV; include clear submission column/file rules.',
    '- Type 3: statistical inference on CSV (tests, CI, correlation, etc.); short **numeric** answers only (after round/trunc).',
    '- Write problem markdown in clear Korean exam tone: given files, what to compute, round/trunc rules, submission notes.',
    '',
    authorRuntimeEnvPromptEn(),
    '',
    authorDifficultyPromptEn(),
    '',
    authorType13AnswerFormatPromptEn(),
    '',
    authorType2BandPromptEn(),
    '',
    '## Data files = CSV only',
    '- Every data file attached to the draft MUST be a .csv (UTF-8). No xlsx, parquet, json, txt tables, or images-as-data.',
    '- use_project_assets may only attach EXISTING .csv as-is (rare). Prefer MUTATE or SYNTHESIZE so the exam file is original.',
    '- Mention the exact CSV filenames in the problem markdown.',
    '',
    '## Design decision (mandatory before producing data)',
    'After analyzing references, choose ONE path and state it briefly in Korean:',
    'A) MUTATE existing CSVs (preferred when project/reference CSVs exist):',
    '   list_project_csvs → preview_csv_asset → set_transform_code (python or r) → run_transform_code → save_generated_assets.',
    '   Mounted sources appear as data/<filename>.csv. Transform code MUST write NEW files under out/*.csv',
    '   (rename columns, inject missingness, resample, shift distributions, re-split train/test — keep skill intent, change content).',
    'B) SYNTHESIZE from scratch (when no suitable CSV exists):',
    '   set_dataset_code (fixed seed, Python) → run_dataset_code → save_generated_assets.',
    '',
    '## Workflow',
    'Type 1/3: CSV ready (mutate or synthesize) → update_draft → set_answer_code → run_answer_code → set_short_answers.',
    'Type 2: CSV ready → update_draft with markdown 구간표 + grading_python/r (SCORE_BANDS) → verify.',
    'Never invent final numeric answers yourself — compute via tools, then set answers from stdout.',
    'When you need external facts/docs: web_search then fetch_url. Do not invent API signatures.',
  ];
  if (requireSave) {
    lines.push(
      'MANDATORY: Before you finish this turn you MUST call save_problem(confirm=true).',
      'Do not end with only a text reply. Saving is required.',
    );
  } else {
    lines.push(
      'Call save_problem only when the user asks to save or the draft is complete.',
    );
  }
  lines.push('Respond briefly in Korean about what you changed and which skills the new item targets.');
  return lines.join('\n');
}

function draftToBankPartial(
  draft: AuthorDraft,
  referenceIds: string[],
): Partial<BankProblem> {
  return {
    title: draft.title,
    note: draft.note,
    showNoteOnExam: false,
    taskType: draft.taskType,
    kind: 'submit',
    language: draft.language,
    markdown: draft.markdown,
    answerCode: draft.answerCode,
    gradingCode: draft.gradingCode,
    datasetCode: draft.datasetCode || undefined,
    assetIds: draft.assetIds,
    sourceProblemId: referenceIds[0],
    submitFormat: draft.taskType === 2 ? 'csv' : 'short',
    submitFile: draft.taskType === 2 ? 'result.csv' : undefined,
    shortAnswers: draft.taskType === 2 ? undefined : draft.shortAnswers,
    shortAnswer: draft.taskType === 2 ? '' : (draft.shortAnswers[0] ?? ''),
  };
}

/** Heuristic: draft has been filled beyond the empty template. */
export function isDraftReadyForSave(draft: AuthorDraft): boolean {
  const md = draft.markdown.trim();
  if (md.length < 80) return false;
  if (md.includes('문제 내용을 작성하세요')) return false;
  if (draft.taskType === 2) {
    const transformBytes =
      (draft.transformCode?.python?.trim().length ?? 0) +
      (draft.transformCode?.r?.trim().length ?? 0);
    return (
      draft.assetIds.length > 0 ||
      draft.datasetCode.trim().length > 40 ||
      transformBytes > 40 ||
      md.length > 200
    );
  }
  const hasAnswer = draft.shortAnswers.some((s) => s.trim().length > 0);
  const hasCode =
    draft.answerCode.python.trim().length > 0 ||
    draft.answerCode.r.trim().length > 0;
  return hasAnswer || hasCode || md.length > 200;
}

const TOOLS: ChatToolDef[] = [
  ...WEB_TOOL_DEFS,
  {
    type: 'function',
    function: {
      name: 'list_references',
      description: 'List selected reference problems (id, title, taskType).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reference',
      description: 'Fetch one reference problem markdown and meta by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_draft',
      description:
        'Update draft fields (title, note, markdown, language, taskType, grading).',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          note: { type: 'string' },
          markdown: { type: 'string' },
          language: { type: 'string', enum: ['python', 'r'] },
          task_type: { type: 'integer', enum: [1, 2, 3] },
          grading_python: { type: 'string' },
          grading_r: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_answer_code',
      description: 'Set computation code that prints final answers to stdout.',
      parameters: {
        type: 'object',
        properties: {
          python: { type: 'string' },
          r: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_answer_code',
      description: 'Execute answer code against draft assets.',
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', enum: ['python', 'r'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_short_answers',
      description:
        'Set type 1/3 short-answer keys from executed output. Each answer must be a single number string after round/trunc (e.g. "0.12"). No letters or multi-values.',
      parameters: {
        type: 'object',
        properties: {
          answers: { type: 'array', items: { type: 'string' } },
        },
        required: ['answers'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_project_csvs',
      description:
        'List project .csv assets (id, name, mount path data/<file>, bytes, used_by reference ids). Use before deciding MUTATE vs SYNTHESIZE.',
      parameters: {
        type: 'object',
        properties: {
          reference_only: {
            type: 'boolean',
            description:
              'If true, only CSVs attached to selected reference problems.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_csv_asset',
      description:
        'Hydrate one CSV asset and return header + first rows for transform design.',
      parameters: {
        type: 'object',
        properties: {
          asset_id: { type: 'string' },
          max_rows: { type: 'integer' },
        },
        required: ['asset_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_transform_code',
      description:
        'Set Pyodide (python) and/or webR (r) code that reads mounted source CSVs (data/*.csv) and writes NEW exam CSVs under out/*.csv. Prefer this over set_dataset_code when mutating existing data.',
      parameters: {
        type: 'object',
        properties: {
          python: { type: 'string' },
          r: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_transform_code',
      description:
        'Mount given source CSV asset_ids, run transformCode in python or r, list out/*.csv. Then call save_generated_assets.',
      parameters: {
        type: 'object',
        properties: {
          asset_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Source CSV asset ids to mount (not the output).',
          },
          language: { type: 'string', enum: ['python', 'r'] },
        },
        required: ['asset_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_dataset_code',
      description:
        'SYNTHESIZE path: Python that writes NEW exam CSVs under out/ from scratch (fixed seed). No source mounts. Filenames must end with .csv only.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_dataset_code',
      description: 'Run datasetCode in Pyodide and list out/*.csv only.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_generated_assets',
      description:
        'Persist out/*.csv into the project library and draft.assetIds. Non-csv paths are rejected.',
      parameters: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' } },
          library_folder: { type: 'string' },
        },
        required: ['files'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'use_project_assets',
      description:
        'Attach existing project CSV asset ids to the draft AS-IS (.csv only). Prefer mutate/synthesize for original exam files.',
      parameters: {
        type: 'object',
        properties: {
          asset_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['asset_ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_problem',
      description: 'Persist draft as a new bank problem.',
      parameters: {
        type: 'object',
        properties: { confirm: { type: 'boolean' } },
        required: ['confirm'],
      },
    },
  },
];

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarizeDraft(draft: AuthorDraft) {
  return {
    title: draft.title,
    taskType: draft.taskType,
    note: draft.note?.slice(0, 200),
    markdownChars: draft.markdown.length,
    language: draft.language,
    shortAnswers: draft.shortAnswers,
    assetIds: draft.assetIds,
    hasAnswerPy: Boolean(draft.answerCode.python.trim()),
    hasDatasetCode: Boolean(draft.datasetCode.trim()),
    hasTransformPy: Boolean(draft.transformCode?.python?.trim()),
    hasTransformR: Boolean(draft.transformCode?.r?.trim()),
  };
}

function isCsvAssetName(nameOrPath: string): boolean {
  return nameOrPath.toLowerCase().endsWith('.csv');
}

function csvPreviewLines(
  content: string,
  maxRows: number,
): { header: string; rows: string[]; lineCount: number } {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return {
    header: lines[0] ?? '',
    rows: lines.slice(1, 1 + Math.max(1, maxRows)),
    lineCount: lines.length,
  };
}

async function ensureOutDir(): Promise<void> {
  const py = await preloadPyodide();
  if (!py.FS.analyzePath('out').exists) {
    py.FS.mkdir('out');
  }
}

async function listOutFiles(): Promise<string[]> {
  const py = await preloadPyodide();
  if (!py.FS.analyzePath('out').exists) return [];
  const listed = await runPython(
    'import os, json\nprint(json.dumps(os.listdir("out") if os.path.isdir("out") else []))',
  );
  try {
    const list = JSON.parse(listed.stdout.trim() || '[]') as string[];
    return list.filter((n) => n.toLowerCase().endsWith('.csv'));
  } catch {
    return [];
  }
}

async function clearPyodideOutCsvs(): Promise<void> {
  await ensureOutDir();
  const prev = await listOutFiles();
  const py = await preloadPyodide();
  for (const f of prev) {
    try {
      py.FS.unlink(`out/${f}`);
    } catch {
      /* ignore */
    }
  }
}

async function ensureWebROutDir(): Promise<void> {
  const relHome = WEBR_HOME.replace(/^\//, '');
  await ensureWebRDir(`${relHome}/out`);
}

async function listOutFilesWebR(): Promise<string[]> {
  await preloadWebR();
  await ensureWebROutDir();
  const listed = await runR(
    [
      'files <- list.files("out", pattern = "\\\\.csv$", ignore.case = TRUE)',
      'cat(paste(files, collapse = "\\n"))',
    ].join('\n'),
  );
  const text = listed.stdout.trim();
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((n) => n.toLowerCase().endsWith('.csv'));
}

async function clearWebROutCsvs(): Promise<void> {
  const prev = await listOutFilesWebR();
  if (!prev.length) return;
  const quoted = prev
    .map((f) => `"out/${f.replace(/\\/g, '/').replace(/"/g, '')}"`)
    .join(', ');
  await runR(`invisible(file.remove(c(${quoted})))`);
}

/** After R transform, mirror out/*.csv into Pyodide so save_generated_assets stays unchanged. */
async function syncWebROutToPyodide(files: string[]): Promise<void> {
  await ensureOutDir();
  const py = await preloadPyodide();
  for (const base of files) {
    const content = await readWebRFileText(`out/${base}`);
    py.FS.writeFile(`out/${base}`, content, { encoding: 'utf8' });
  }
}

async function runAnswer(
  ctx: AuthorAgentContext,
  language: 'python' | 'r',
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  // Asset bodies live in IDB/disk (lean project.assets have content: '').
  // Hydrate before mounting — same pattern as AnswerAuthorPanel.
  const { withProjectAssetContents } = await import('@/lib/assetStore');
  const hydrated = await withProjectAssetContents(
    ctx.project,
    ctx.draft.assetIds,
  );
  // Keep hydrated bodies on the turn-local project so later tools reuse them.
  ctx.project.assets = hydrated.assets;
  const files = resolveAssets(hydrated, ctx.draft.assetIds);
  const source =
    language === 'python'
      ? ctx.draft.answerCode.python
      : ctx.draft.answerCode.r;
  if (!source.trim()) {
    return { ok: false, stdout: '', stderr: 'answer code is empty' };
  }
  if (language === 'python') {
    await preloadPyodide();
    await mountAssetsToPyodide(files);
    const out = await runPython(source);
    return { ok: out.ok, stdout: out.stdout, stderr: out.stderr };
  }
  await preloadWebR();
  const { mountAssetsToWebR } = await import('@/runtimes/fsMount');
  await mountAssetsToWebR(files);
  const out = await runR(source);
  return { ok: out.ok, stdout: out.stdout, stderr: out.stderr };
}

function refsOf(ctx: AuthorAgentContext): BankProblem[] {
  const set = new Set(ctx.referenceIds);
  return ctx.project.bank.filter((b) => set.has(b.id));
}

export async function runAuthorAgentTurn(opts: {
  ctx: AuthorAgentContext;
  history: ChatMessage[];
  userText: string;
  userImages?: Array<{ dataUrl: string; name?: string }>;
  onDraft?: (draft: AuthorDraft) => void;
  onSave?: (problem: Partial<BankProblem>) => BankProblem;
  onProgress?: (event: AuthorAgentProgress) => void;
  signal?: AbortSignal;
  /** Auto-generate / batch: must finish by calling save_problem (with fallbacks). */
  requireSave?: boolean;
}): Promise<AuthorAgentResult> {
  const { onDraft, onSave, onProgress, signal, requireSave = false } = opts;
  const report = (event: AuthorAgentProgress) => onProgress?.(event);
  const ctx: AuthorAgentContext = {
    ...opts.ctx,
    project: {
      ...opts.ctx.project,
      assets: [...opts.ctx.project.assets],
    },
  };
  let draft: AuthorDraft = {
    ...ctx.draft,
    answerCode: { ...ctx.draft.answerCode },
    gradingCode: { ...ctx.draft.gradingCode },
    transformCode: {
      python: ctx.draft.transformCode?.python ?? '',
      r: ctx.draft.transformCode?.r ?? '',
    },
    datasetCode: ctx.draft.datasetCode ?? '',
    shortAnswers: [...ctx.draft.shortAnswers],
    assetIds: [...ctx.draft.assetIds],
  };

  const userParts: ChatContentPart[] = [];
  if (opts.userText.trim()) {
    userParts.push({ type: 'text', text: opts.userText.trim() });
  }
  for (const img of opts.userImages ?? []) {
    userParts.push({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    });
  }
  if (!userParts.length) {
    userParts.push({ type: 'text', text: '(empty)' });
  }

  const refBrief = refsOf(ctx)
    .map((r) => `- ${r.id} · t${r.taskType} · ${r.title}`)
    .join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(requireSave) },
    {
      role: 'user',
      content: [
        'AUTHORING CONTEXT',
        `draft=${JSON.stringify(summarizeDraft(draft))}`,
        `selected references (${ctx.referenceIds.length}):`,
        refBrief || '(none)',
        'Analyze references with list_references / get_reference, then invent a NEW exam-realistic item.',
        'DATA_POLICY=csv_only — choose MUTATE (list_project_csvs / transform) or SYNTHESIZE (dataset_code) at design time.',
        'RUNTIME=python(pandas,numpy,scipy.stats,statsmodels,sklearn,xgboost,lightgbm) | r(tidyverse,broom,lubridate).',
        'DIFFICULTY=hard formula items allowed (e.g. pooled variance) — implement formula in answer_code, never invent numbers.',
        'TYPE1_3_ANSWERS=numeric only after 반올림 or 절사; never letters/labels.',
        requireSave
          ? 'REQUIRE_SAVE=true — end this turn with save_problem(confirm=true).'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
    ...opts.history.filter((m) => m.role !== 'system'),
    {
      role: 'user',
      content: userParts.length === 1 && userParts[0].type === 'text'
        ? userParts[0].text
        : userParts,
    },
  ];

  let assistantText = '';
  let savedProblem: BankProblem | null = null;

  const throwIfAborted = () => {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    throw new DOMException('Generation aborted', 'AbortError');
  };

  const maxRounds = requireSave
    ? MAX_TOOL_ROUNDS_REQUIRE_SAVE
    : MAX_TOOL_ROUNDS;

  for (let round = 0; round < maxRounds; round++) {
    throwIfAborted();
    report({
      kind: 'status',
      text: `모델 응답 생성 중… (${round + 1}/${maxRounds})`,
    });
    const completion = await createChatCompletion({
      settings: ctx.settings,
      messages,
      tools: TOOLS,
      toolChoice: 'auto',
      signal,
      onDelta: (delta) => {
        if (delta.content) {
          report({ kind: 'assistant_delta', text: delta.content });
        }
        if (delta.toolCallNames?.length) {
          report({
            kind: 'status',
            text: `도구 준비: ${delta.toolCallNames.join(', ')}`,
          });
        }
      },
    });
    throwIfAborted();
    const msg = completion.message;
    messages.push({
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.tool_calls,
    });
    const text = chatContentToText(msg.content).trim();
    if (text) assistantText = text;

    const calls = msg.tool_calls ?? [];
    if (!calls.length) break;

    for (const call of calls) {
      throwIfAborted();
      const name = call.function.name;
      report({ kind: 'tool', name, phase: 'start' });
      report({ kind: 'status', text: `도구 실행: ${name}` });
      const args = parseArgs(call.function.arguments);
      let toolResult = '';

      try {
        if (name === 'list_references') {
          toolResult = JSON.stringify({
            ok: true,
            references: refsOf(ctx).map((r) => ({
              id: r.id,
              title: r.title,
              taskType: r.taskType,
              assetCount: r.assetIds.length,
            })),
          });
        } else if (name === 'get_reference') {
          const id = String(args.id ?? '');
          const ref = ctx.project.bank.find((b) => b.id === id);
          if (!ref || !ctx.referenceIds.includes(id)) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'reference not selected or missing',
            });
          } else {
            toolResult = JSON.stringify({
              ok: true,
              id: ref.id,
              title: ref.title,
              taskType: ref.taskType,
              language: ref.language,
              assetIds: ref.assetIds,
              markdown: ref.markdown.slice(0, 8000),
              note: ref.note ?? '',
            });
          }
        } else if (name === 'update_draft') {
          if (typeof args.title === 'string') draft.title = args.title;
          if (typeof args.note === 'string') draft.note = args.note;
          if (typeof args.markdown === 'string') draft.markdown = args.markdown;
          if (args.language === 'python' || args.language === 'r') {
            draft.language = args.language;
          }
          if (args.task_type === 1 || args.task_type === 2 || args.task_type === 3) {
            draft.taskType = args.task_type as TaskType;
          }
          if (typeof args.grading_python === 'string') {
            draft.gradingCode = {
              ...draft.gradingCode,
              python: args.grading_python,
            };
          }
          if (typeof args.grading_r === 'string') {
            draft.gradingCode = { ...draft.gradingCode, r: args.grading_r };
          }
          onDraft?.(draft);
          toolResult = JSON.stringify({ ok: true, draft: summarizeDraft(draft) });
        } else if (name === 'set_answer_code') {
          draft.answerCode = {
            python:
              typeof args.python === 'string'
                ? args.python
                : draft.answerCode.python,
            r: typeof args.r === 'string' ? args.r : draft.answerCode.r,
          };
          onDraft?.(draft);
          toolResult = JSON.stringify({ ok: true });
        } else if (name === 'run_answer_code') {
          const lang =
            args.language === 'r' || args.language === 'python'
              ? args.language
              : draft.language;
          toolResult = JSON.stringify(
            await runAnswer({ ...ctx, draft }, lang),
          );
        } else if (name === 'set_short_answers') {
          if (draft.taskType === 2) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'Type 2 cannot set short answers',
            });
          } else {
            const answers = Array.isArray(args.answers)
              ? args.answers.map((a) => String(a ?? ''))
              : [];
            const check = validateNumericShortAnswers(answers);
            if (!check.ok) {
              toolResult = JSON.stringify({
                ok: false,
                error:
                  'Type 1/3 answers must be numeric only (after round/trunc). Reject letters, units, commas, or empty.',
                rejected: check.rejected,
                answers: check.answers,
              });
            } else {
              draft.shortAnswers = check.answers;
              onDraft?.(draft);
              toolResult = JSON.stringify({
                ok: true,
                answers: draft.shortAnswers,
              });
            }
          }
        } else if (name === 'list_project_csvs') {
          const referenceOnly = Boolean(args.reference_only);
          const refAssetIds = new Set(
            refsOf(ctx).flatMap((r) => r.assetIds),
          );
          const usedBy = new Map<string, string[]>();
          for (const ref of refsOf(ctx)) {
            for (const id of ref.assetIds) {
              const list = usedBy.get(id) ?? [];
              list.push(ref.id);
              usedBy.set(id, list);
            }
          }
          const csvs = ctx.project.assets
            .filter((a) => isCsvAssetName(a.name || a.path))
            .filter((a) => !referenceOnly || refAssetIds.has(a.id))
            .map((a) => ({
              id: a.id,
              name: a.name,
              path: a.path,
              mount: mountPathForAsset(a),
              byteLength: a.byteLength ?? a.content?.length ?? 0,
              used_by_references: usedBy.get(a.id) ?? [],
            }));
          toolResult = JSON.stringify({
            ok: true,
            count: csvs.length,
            csvs,
            hint: csvs.length
              ? 'Prefer MUTATE via set_transform_code / run_transform_code when these fit the skill.'
              : 'No CSV sources — use SYNTHESIZE (set_dataset_code).',
          });
        } else if (name === 'preview_csv_asset') {
          const assetId = String(args.asset_id ?? '');
          const maxRows =
            typeof args.max_rows === 'number' && args.max_rows > 0
              ? Math.min(40, Math.floor(args.max_rows))
              : 12;
          const meta = ctx.project.assets.find((a) => a.id === assetId);
          if (!meta || !isCsvAssetName(meta.name || meta.path)) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'csv asset not found',
            });
          } else {
            const { withProjectAssetContents } = await import(
              '@/lib/assetStore'
            );
            const hydrated = await withProjectAssetContents(ctx.project, [
              assetId,
            ]);
            ctx.project.assets = hydrated.assets;
            const asset = hydrated.assets.find((a) => a.id === assetId);
            const content = asset?.content ?? '';
            if (!content) {
              toolResult = JSON.stringify({
                ok: false,
                error: 'asset content empty after hydrate',
              });
            } else {
              const preview = csvPreviewLines(content, maxRows);
              toolResult = JSON.stringify({
                ok: true,
                id: assetId,
                name: meta.name,
                mount: mountPathForAsset(meta),
                ...preview,
              });
            }
          }
        } else if (name === 'set_transform_code') {
          draft.transformCode = {
            python:
              typeof args.python === 'string'
                ? args.python
                : draft.transformCode.python,
            r:
              typeof args.r === 'string' ? args.r : draft.transformCode.r,
          };
          onDraft?.(draft);
          toolResult = JSON.stringify({
            ok: true,
            bytes: {
              python: draft.transformCode.python.length,
              r: draft.transformCode.r.length,
            },
            hint: 'Read data/<file>.csv; write only out/*.csv with changed content (not a verbatim copy).',
          });
        } else if (name === 'run_transform_code') {
          const ids = Array.isArray(args.asset_ids)
            ? args.asset_ids.map((x) => String(x))
            : [];
          const lang =
            args.language === 'r' || args.language === 'python'
              ? args.language
              : draft.transformCode.r.trim() && !draft.transformCode.python.trim()
                ? 'r'
                : draft.language;
          const code =
            lang === 'r'
              ? draft.transformCode.r
              : draft.transformCode.python;
          if (!ids.length) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'asset_ids required',
            });
          } else if (!code.trim()) {
            toolResult = JSON.stringify({
              ok: false,
              error: `transformCode.${lang} empty — call set_transform_code first`,
            });
          } else {
            const csvIds: string[] = [];
            const rejected: string[] = [];
            for (const id of ids) {
              const asset = ctx.project.assets.find((a) => a.id === id);
              if (!asset || !isCsvAssetName(asset.name || asset.path)) {
                rejected.push(id);
              } else {
                csvIds.push(id);
              }
            }
            if (!csvIds.length) {
              toolResult = JSON.stringify({
                ok: false,
                error: 'no valid csv asset_ids',
                rejected,
              });
            } else {
              const { withProjectAssetContents } = await import(
                '@/lib/assetStore'
              );
              const hydrated = await withProjectAssetContents(
                ctx.project,
                csvIds,
              );
              ctx.project.assets = hydrated.assets;
              const files = resolveAssets(hydrated, csvIds);
              const mounted = files.map((f) => f.path);
              if (lang === 'python') {
                await preloadPyodide();
                await clearPyodideOutCsvs();
                await mountAssetsToPyodide(files);
                const out = await runPython(code);
                const outFiles = await listOutFiles();
                toolResult = JSON.stringify({
                  ok: out.ok,
                  language: lang,
                  stdout: out.stdout,
                  stderr: out.stderr,
                  mounted,
                  files: outFiles,
                  rejected,
                  hint: outFiles.length
                    ? 'Call save_generated_assets with these out/*.csv basenames.'
                    : 'No out/*.csv written — fix transform code.',
                });
              } else {
                await preloadWebR();
                await clearWebROutCsvs();
                const { mountAssetsToWebR } = await import(
                  '@/runtimes/fsMount'
                );
                await mountAssetsToWebR(files);
                await ensureWebROutDir();
                const out = await runR(code);
                const outFiles = await listOutFilesWebR();
                if (outFiles.length) {
                  await syncWebROutToPyodide(outFiles);
                }
                toolResult = JSON.stringify({
                  ok: out.ok,
                  language: lang,
                  stdout: out.stdout,
                  stderr: out.stderr,
                  mounted,
                  files: outFiles,
                  rejected,
                  hint: outFiles.length
                    ? 'Call save_generated_assets with these out/*.csv basenames.'
                    : 'No out/*.csv written — fix transform code.',
                });
              }
            }
          }
        } else if (name === 'set_dataset_code') {
          draft.datasetCode = String(args.code ?? '');
          onDraft?.(draft);
          toolResult = JSON.stringify({
            ok: true,
            bytes: draft.datasetCode.length,
            hint: 'Write only .csv under out/ with a fixed seed.',
          });
        } else if (name === 'run_dataset_code') {
          if (!draft.datasetCode.trim()) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'datasetCode empty',
            });
          } else {
            await clearPyodideOutCsvs();
            const out = await runPython(draft.datasetCode);
            const files = await listOutFiles();
            toolResult = JSON.stringify({
              ok: out.ok,
              stdout: out.stdout,
              stderr: out.stderr,
              files,
            });
          }
        } else if (name === 'save_generated_assets') {
          const files = Array.isArray(args.files)
            ? args.files.map((f) => String(f))
            : [];
          const csvFiles = files.filter((f) =>
            f.replace(/^out\//, '').toLowerCase().endsWith('.csv'),
          );
          const rejected = files.filter((f) => !csvFiles.includes(f));
          if (!csvFiles.length) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'only .csv files are allowed under out/',
              rejected,
            });
          } else {
            const folder =
              typeof args.library_folder === 'string' && args.library_folder.trim()
                ? args.library_folder.trim().replace(/^\/+|\/+$/g, '')
                : `authored/type${draft.taskType}`;
            const created: ProjectAsset[] = [];
            for (const raw of csvFiles) {
              const base = raw.replace(/^out\//, '').replace(/^.*\//, '');
              if (!base.toLowerCase().endsWith('.csv')) continue;
              const content = await readPyodideFileText(`out/${base}`);
              created.push(
                createProjectAsset(
                  {
                    name: base,
                    content,
                    encoding: 'utf-8',
                    mimeType: 'text/csv',
                  },
                  `${folder}/${base}`,
                ),
              );
            }
            const added = await ctx.addProjectAssets(created);
            // addProjectAssets returns lean assets (content stripped). Keep the
            // just-read CSV bodies on the turn-local project for run_answer.
            for (let i = 0; i < added.length; i++) {
              const lean = added[i];
              const full: ProjectAsset = {
                ...lean,
                content: created[i]?.content ?? lean.content,
              };
              const idx = ctx.project.assets.findIndex((x) => x.id === lean.id);
              if (idx >= 0) ctx.project.assets[idx] = full;
              else ctx.project.assets.push(full);
            }
            draft.assetIds = added.map((a) => a.id);
            onDraft?.(draft);
            toolResult = JSON.stringify({
              ok: true,
              assetIds: draft.assetIds,
              paths: added.map((a) => a.path),
              rejected,
            });
          }
        } else if (name === 'use_project_assets') {
          const ids = Array.isArray(args.asset_ids)
            ? args.asset_ids.map((x) => String(x))
            : [];
          const csvIds: string[] = [];
          const rejected: string[] = [];
          for (const id of ids) {
            const asset = ctx.project.assets.find((a) => a.id === id);
            if (!asset) {
              rejected.push(id);
              continue;
            }
            const name = (asset.name || asset.path || '').toLowerCase();
            if (name.endsWith('.csv')) csvIds.push(id);
            else rejected.push(id);
          }
          draft.assetIds = csvIds;
          onDraft?.(draft);
          toolResult = JSON.stringify({
            ok: rejected.length === 0,
            assetIds: draft.assetIds,
            rejected,
            error: rejected.length
              ? 'only .csv assets may be attached'
              : undefined,
          });
        } else if (name === 'save_problem') {
          if (!args.confirm) {
            toolResult = JSON.stringify({ ok: false, error: 'confirm=false' });
          } else if (!onSave) {
            toolResult = JSON.stringify({ ok: false, error: 'save unavailable' });
          } else {
            savedProblem = onSave(
              draftToBankPartial(draft, ctx.referenceIds),
            );
            toolResult = JSON.stringify({
              ok: true,
              id: savedProblem.id,
              title: savedProblem.title,
            });
          }
        } else if (isWebToolName(name)) {
          toolResult = await runWebTool(name, args);
        } else {
          toolResult = JSON.stringify({
            ok: false,
            error: `unknown tool ${name}`,
          });
        }
      } catch (err) {
        toolResult = JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolResult,
      });
      report({ kind: 'tool', name, phase: 'done' });
    }
  }

  // Auto-batch: if the model forgot save_problem, force it once, then fall back.
  if (requireSave && !savedProblem && onSave) {
    throwIfAborted();
    report({ kind: 'status', text: '저장 강제 호출 중…' });
    messages.push({
      role: 'user',
      content:
        '초안 작업은 끝났습니다. 지금 즉시 save_problem(confirm=true)만 호출하세요. 다른 도구는 쓰지 마세요.',
    });
    try {
      const forced = await createChatCompletion({
        settings: ctx.settings,
        messages,
        tools: TOOLS.filter((t) => t.function.name === 'save_problem'),
        toolChoice: {
          type: 'function',
          function: { name: 'save_problem' },
        },
        signal,
      });
      messages.push({
        role: 'assistant',
        content: forced.message.content,
        tool_calls: forced.message.tool_calls,
      });
      for (const call of forced.message.tool_calls ?? []) {
        if (call.function.name !== 'save_problem') continue;
        const args = parseArgs(call.function.arguments);
        let toolResult = '';
        // Forced save: treat missing confirm as true (model often omits it).
        if (args.confirm === false) {
          toolResult = JSON.stringify({ ok: false, error: 'confirm=false' });
        } else {
          report({ kind: 'tool', name: 'save_problem', phase: 'start' });
          savedProblem = onSave(
            draftToBankPartial(draft, ctx.referenceIds),
          );
          toolResult = JSON.stringify({
            ok: true,
            id: savedProblem.id,
            title: savedProblem.title,
          });
          report({ kind: 'tool', name: 'save_problem', phase: 'done' });
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolResult,
        });
      }
    } catch (err) {
      // Forced tool_choice may be unsupported by some gateways — fall through.
      if (
        !(err instanceof DOMException && err.name === 'AbortError') &&
        !(err instanceof Error && err.name === 'AbortError')
      ) {
        report({
          kind: 'status',
          text: '강제 저장 호출 실패 — 초안 직접 저장 시도',
        });
      } else {
        throw err;
      }
    }

    if (!savedProblem && isDraftReadyForSave(draft)) {
      report({ kind: 'status', text: '초안을 직접 저장합니다…' });
      savedProblem = onSave(draftToBankPartial(draft, ctx.referenceIds));
      messages.push({
        role: 'assistant',
        content: `save_problem이 누락되어 초안을 직접 저장했습니다: ${savedProblem.title}`,
      });
    }
  }

  report({ kind: 'status', text: '응답 정리 중…' });

  const uiMessages = messages.filter(
    (m, i) =>
      !(
        i > 0 &&
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.startsWith('AUTHORING CONTEXT')
      ),
  );

  return {
    messages: uiMessages.filter((m) => m.role !== 'system'),
    draft,
    assistantText,
    savedProblem,
  };
}
