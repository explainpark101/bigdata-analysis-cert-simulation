import {
  chatContentToText,
  createChatCompletion,
  RepetitionLoopError,
  stripThinkingContent,
  stripThinkingFromHistory,
  type ChatMessage,
  type ChatToolDef,
} from '@/lib/ai/openaiCompatible';
import type { AiEndpointSettings } from '@/lib/aiSettings';
import type { VariantDraft } from '@/lib/ai/variantChatStore';
import {
  assistantSkippedRequiredTools,
  authorDifficultyPromptEn,
  authorKatexPromptEn,
  authorRuntimeEnvPromptEn,
  authorStatsResearchPromptEn,
  authorToolContractPromptEn,
  authorType13AnswerFormatPromptEn,
  authorType2BandPromptEn,
  shortAnswersAreFinite,
  stdoutHasNonFiniteAnswer,
  toolCallNudgeMessage,
  validateNumericShortAnswers,
} from '@/lib/ai/authorRuntimePrompt';
import {
  isWebToolName,
  runWebTool,
  WEB_TOOL_DEFS,
} from '@/lib/ai/webTools';
import { mountPathForAsset } from '@/lib/assetPaths';
import { resolveAssets } from '@/lib/projectIO';
import { ensureShortAnswersForSubQuestions } from '@/lib/subQuestions';
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
import type { AuthoringProject, BankProblem, ProjectAsset } from '@/types/project';
import {
  applyCsvRenamesToDraftFields,
  persistGeneratedCsvAssets,
  upsertProjectAssets,
} from '@/lib/ai/csvAssetPersist';
import { prepareDraftForVerifiedSave } from '@/lib/ai/commitVerifiedProblem';
import { linkedCsvAssetIds } from '@/lib/ai/ensureProblemCsv';

const MAX_TOOL_ROUNDS = 12;

/** variant = new bank item; modify = update the same bank item in place. */
export type ProblemEditMode = 'variant' | 'modify';

export interface VariantAgentContext {
  settings: AiEndpointSettings;
  project: AuthoringProject;
  source: BankProblem;
  draft: VariantDraft;
  /** Persist newly created assets into the project */
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
  mode?: ProblemEditMode;
}

export interface VariantAgentResult {
  messages: ChatMessage[];
  draft: VariantDraft;
  assistantText: string;
  savedProblem: BankProblem | null;
}

function systemPrompt(
  source: BankProblem,
  mode: ProblemEditMode,
  toolNames: string[],
): string {
  const type = source.taskType;
  const isModify = mode === 'modify';
  return [
    'You are an exam-authoring agent for 빅데이터분석기사 실기 (DataQ-style).',
    isModify
      ? 'MODIFY the existing bank problem in place. Improve wording, answers, grading, or data only as the user asks — do not invent a separate variant title unless asked.'
      : 'Transform the source problem into a VARIANT that tests related skills.',
    'Never invent final numeric answers yourself. Always write executable code that computes answers, then use tools to run it and set answers from stdout.',
    '',
    authorToolContractPromptEn(toolNames),
    '',
    `Source task type: ${type}`,
    type === 1 || type === 3
      ? [
          'Type 1/3 rules:',
          isModify
            ? '- Keep the SAME dataset assetIds unless the user explicitly asks to change data.'
            : '- Keep the SAME dataset assetIds (do not regenerate CSV unless user insists).',
          isModify
            ? '- Edit markdown / filters / aggregation / round-or-trunc as requested; preserve structure when the user only asks for a small fix.'
            : '- Change the question wording / aggregation / filter / target column / round-or-trunc rule as requested.',
          '- Put computation code in set_answer_code; run_answer_code; then set_short_answers from printed values only.',
          '- CSV load paths in answer_code / markdown MUST be `data/<file>.csv` (flat).',
          '- Short answers MUST be numbers only after 반올림/절사 (e.g. "11.0", "0.12"). Never letters/labels.',
          '- One item may have multiple 소문항 (type1 max 5, type3 max 3). Mark ①②/(1)(2); set_short_answers length = count; print one line each.',
          '- If run_answer_code prints NaN/Inf: do not save — redesign and regenerate until answers are finite.',
        ].join('\n')
      : [
          'Type 2 rules:',
          isModify
            ? '- Prefer editing markdown / gradingCode on the existing assets. Only MUTATE or SYNTHESIZE new CSVs if the user asks for new data.'
            : '- At design time choose MUTATE (preferred if source CSVs exist) or SYNTHESIZE.',
          '- MUTATE: list_project_csvs → preview_csv_asset → set_transform_code (python|r) → run_transform_code(asset_ids=source) → save_generated_assets.',
          '  Read data/<file>.csv; write NEW out/*.csv (rename columns, resample, shift target — not a verbatim copy).',
          '- SYNTHESIZE: set_dataset_code (seeded Python) → run_dataset_code → save_generated_assets.',
          '- save_generated_assets never overwrites an existing library basename — a _<hash> suffix is added when needed.',
          '- SAVE GATE: save/apply re-runs answer code on stored CSV; type 2 must produce result.csv.',
          '- Do NOT paste CSV rows in chat.',
          '- Provide gradingCode via update_draft grading fields with SCORE_BANDS (5pt steps); no short-answer tools.',
          '- Examinee still submits result.csv; do not invent scores.',
        ].join('\n'),
    '',
    authorRuntimeEnvPromptEn(),
    '',
    authorKatexPromptEn(),
    '',
    authorStatsResearchPromptEn(),
    '',
    authorDifficultyPromptEn(),
    '',
    type === 1 || type === 3
      ? authorType13AnswerFormatPromptEn({ taskType: type })
      : '',
    type === 2 ? authorType2BandPromptEn() : '',
    '',
    'Always explain briefly in natural language what you changed.',
    'For stats formulas/metrics: prefer lookup_statistic → fetch_url (or web_search). If ok=false/skip=true, continue with your own knowledge — do not stall. Put formulas in markdown with KaTeX `$...$` / `$$...$$` only.',
    isModify
      ? 'Call apply_changes only when the user asks to apply/save or the draft is ready to write back to the bank item.'
      : 'Call save_variant only when the user asks to save or the draft is complete.',
  ].join('\n');
}

function toolsFor(source: BankProblem, mode: ProblemEditMode): ChatToolDef[] {
  const saveTool =
    mode === 'modify'
      ? {
          type: 'function' as const,
          function: {
            name: 'apply_changes',
            description:
              'Write the draft back onto the same bank problem (in-place update).',
            parameters: {
              type: 'object',
              properties: {
                confirm: { type: 'boolean' },
              },
              required: ['confirm'],
            },
          },
        }
      : {
          type: 'function' as const,
          function: {
            name: 'save_variant',
            description:
              'Persist the draft as a new bank problem linked to the source.',
            parameters: {
              type: 'object',
              properties: {
                confirm: { type: 'boolean' },
              },
              required: ['confirm'],
            },
          },
        };

  const common: ChatToolDef[] = [
    {
      type: 'function',
      function: {
        name: 'update_draft',
        description:
          mode === 'modify'
            ? 'Update modify draft fields (title, note, markdown, language). Do not put final answers here.'
            : 'Update variant draft fields (title, note, markdown, language). Do not put final answers here.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            note: { type: 'string' },
            markdown: { type: 'string' },
            language: { type: 'string', enum: ['python', 'r'] },
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
        description:
          'Set author answer/computation code. Must print the final answer values to stdout.',
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
        description:
          'Execute current answer code against draft assets. Returns stdout/stderr.',
        parameters: {
          type: 'object',
          properties: {
            language: { type: 'string', enum: ['python', 'r'] },
          },
        },
      },
    },
    saveTool,
  ];

  if (source.taskType === 1 || source.taskType === 3) {
    common.splice(3, 0, {
      type: 'function',
      function: {
        name: 'set_short_answers',
        description:
          'Set type 1/3 short-answer keys from executed output. Each array entry is one answer field (one 소문항). Each value must be a single number after round/trunc (e.g. "0.12"). N 소문항 → N entries (type1 max 5, type3 max 3).',
        parameters: {
          type: 'object',
          properties: {
            answers: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['answers'],
        },
      },
    });
  }

  if (source.taskType === 2) {
    common.splice(
      1,
      0,
      {
        type: 'function',
        function: {
          name: 'list_project_csvs',
          description:
            'List project .csv assets; prefer source problem assets for MUTATE.',
          parameters: {
            type: 'object',
            properties: {
              source_only: {
                type: 'boolean',
                description: 'If true, only CSVs on the source problem.',
              },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'preview_csv_asset',
          description: 'Preview header + first rows of a CSV asset.',
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
            'MUTATE path: python and/or r code that reads data/*.csv and writes NEW out/*.csv.',
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
            'Mount source CSV asset_ids and run transformCode; lists out/*.csv.',
          parameters: {
            type: 'object',
            properties: {
              asset_ids: { type: 'array', items: { type: 'string' } },
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
            'SYNTHESIZE path: Python that creates NEW CSVs under out/ with a fixed seed (e.g. out/train.csv, out/test.csv).',
          parameters: {
            type: 'object',
            properties: {
              code: { type: 'string' },
            },
            required: ['code'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'run_dataset_code',
          description:
            'Run datasetCode in Pyodide. Lists files created under out/ and returns stdout.',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'save_generated_assets',
          description:
            'Read listed out/*.csv as-is into the project library and attach to draft.assetIds. Existing basenames get a _<randomHash> suffix (never overwrite).',
          parameters: {
            type: 'object',
            properties: {
              files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Basenames or out/ relative paths, e.g. train.csv or out/train.csv',
              },
              library_folder: {
                type: 'string',
                description: 'Optional library subfolder, e.g. variants/type2',
              },
            },
            required: ['files'],
          },
        },
      },
    );
  }

  return [...WEB_TOOL_DEFS, ...common];
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
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

async function syncWebROutToPyodide(files: string[]): Promise<void> {
  await ensureOutDir();
  const py = await preloadPyodide();
  for (const base of files) {
    const content = await readWebRFileText(`out/${base}`);
    py.FS.writeFile(`out/${base}`, content, { encoding: 'utf8' });
  }
}

async function runAnswer(
  ctx: VariantAgentContext,
  language: 'python' | 'r',
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  // Asset bodies live in IDB/disk (lean project.assets have content: '').
  const { withProjectAssetContents } = await import('@/lib/assetStore');
  const hydrated = await withProjectAssetContents(
    ctx.project,
    ctx.draft.assetIds,
  );
  ctx.project.assets = hydrated.assets;
  const files = resolveAssets(hydrated, ctx.draft.assetIds);
  const source =
    language === 'python'
      ? ctx.draft.answerCode.python
      : ctx.draft.answerCode.r;
  if (!source.trim()) {
    return { ok: false, stdout: '', stderr: 'answer code is empty' };
  }
  const finish = (out: { ok: boolean; stdout: string; stderr: string }) => {
    if (stdoutHasNonFiniteAnswer(out.stdout)) {
      return {
        ok: false,
        stdout: out.stdout,
        stderr: [
          out.stderr,
          'NON_FINITE_ANSWER: stdout contains NaN/Inf. Redesign and regenerate; do not save.',
        ]
          .filter(Boolean)
          .join('\n'),
        nonFinite: true,
        regenerate: true,
      };
    }
    return { ok: out.ok, stdout: out.stdout, stderr: out.stderr };
  };
  if (language === 'python') {
    await preloadPyodide();
    await mountAssetsToPyodide(files);
    return finish(await runPython(source));
  }
  await preloadWebR();
  const { mountAssetsToWebR } = await import('@/runtimes/fsMount');
  await mountAssetsToWebR(files);
  return finish(await runR(source));
}

export async function runVariantAgentTurn(opts: {
  ctx: VariantAgentContext;
  history: ChatMessage[];
  userText: string;
  onDraft?: (draft: VariantDraft) => void;
  onSave?: (problem: Partial<BankProblem>) => BankProblem;
}): Promise<VariantAgentResult> {
  const { onDraft, onSave } = opts;
  const mode: ProblemEditMode = opts.ctx.mode ?? 'variant';
  // Mutable working copy so newly saved assets are visible later in the same turn.
  const ctx: VariantAgentContext = {
    ...opts.ctx,
    mode,
    project: {
      ...opts.ctx.project,
      assets: [...opts.ctx.project.assets],
    },
  };
  let draft = {
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
  const tools = toolsFor(ctx.source, mode);
  const toolNames = tools.map((t) => t.function.name);
  const saveToolName = mode === 'modify' ? 'apply_changes' : 'save_variant';
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(ctx.source, mode, toolNames) },
    ...stripThinkingFromHistory(
      opts.history.filter((m) => m.role !== 'system'),
    ),
    { role: 'user', content: opts.userText },
  ];

  const sourceSummary = [
    `source.id=${ctx.source.id}`,
    `title=${ctx.source.title}`,
    `taskType=${ctx.source.taskType}`,
    `assetIds=${JSON.stringify(ctx.draft.assetIds)}`,
    `markdown:\n${ctx.source.markdown.slice(0, 6000)}`,
    `TOOLS_LIVE=true — tools on this request: ${toolNames.join(', ')}. Never claim tools are disconnected.`,
    'KATEX=use `$...$` / `$$...$$` only in markdown — never `\\[` `\\(` or bare TeX.',
    mode === 'modify'
      ? `CURRENT DRAFT SNAPSHOT:\ntitle=${draft.title}\nnote=${(draft.note ?? '').slice(0, 500)}\nmarkdown:\n${draft.markdown.slice(0, 6000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
  messages.splice(1, 0, {
    role: 'user',
    content: `SOURCE PROBLEM CONTEXT:\n${sourceSummary}`,
  });

  let assistantText = '';
  let savedProblem: BankProblem | null = null;
  let emptyToolNudges = 0;
  const MAX_EMPTY_TOOL_NUDGES = 2;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await createChatCompletion({
      settings: ctx.settings,
      messages,
      tools,
      toolChoice: 'auto',
      onRetry: (attempt, error) => {
        const msg =
          error instanceof Error ? error.message : String(error ?? '');
        const label =
          error instanceof RepetitionLoopError
            ? 'repetition abort'
            : 'retry';
        console.info(
          `[variantAgent] ${label} ${attempt}${msg ? `: ${msg.slice(0, 120)}` : ''}`,
        );
      },
    });
    const msg = completion.message;
    messages.push({
      role: 'assistant',
      content: msg.content,
      tool_calls: msg.tool_calls,
    });
    const text = chatContentToText(msg.content).trim();
    if (text) assistantText = text;

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      const needsWork =
        assistantSkippedRequiredTools(text) ||
        (emptyToolNudges === 0 &&
          /SYNTHESIZE|MUTATE|set_dataset|run_answer|CSV|재생성|검증/i.test(
            text,
          ));
      if (needsWork && emptyToolNudges < MAX_EMPTY_TOOL_NUDGES) {
        emptyToolNudges += 1;
        messages.push({
          role: 'user',
          content: toolCallNudgeMessage(toolNames, {
            saveTool: saveToolName,
          }),
        });
        continue;
      }
      break;
    }

    for (const call of calls) {
      const name = call.function.name;
      const args = parseArgs(call.function.arguments);
      let toolResult = '';

      try {
        if (name === 'update_draft') {
          if (typeof args.title === 'string') draft.title = args.title;
          if (typeof args.note === 'string') draft.note = args.note;
          if (typeof args.markdown === 'string') draft.markdown = args.markdown;
          if (args.language === 'python' || args.language === 'r') {
            draft.language = args.language;
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
          const out = await runAnswer({ ...ctx, draft }, lang);
          toolResult = JSON.stringify(out);
        } else if (name === 'set_short_answers') {
          if (ctx.source.taskType === 2) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'Type 2 cannot set short answers',
            });
          } else {
            const answers = Array.isArray(args.answers)
              ? args.answers.map((a) => String(a ?? ''))
              : [];
            const check = validateNumericShortAnswers(answers, {
              taskType:
                ctx.source.taskType === 1 || ctx.source.taskType === 3
                  ? ctx.source.taskType
                  : undefined,
            });
            if (!check.ok) {
              toolResult = JSON.stringify({
                ok: false,
                error:
                  check.error ??
                  'Type 1/3 answers must be numeric only (after round/trunc).',
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
          if (ctx.source.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else {
            const sourceOnly = Boolean(args.source_only);
            const sourceIds = new Set(ctx.source.assetIds);
            const csvs = ctx.project.assets
              .filter((a) => isCsvAssetName(a.name || a.path))
              .filter((a) => !sourceOnly || sourceIds.has(a.id))
              .map((a) => ({
                id: a.id,
                name: a.name,
                path: a.path,
                mount: mountPathForAsset(a),
                byteLength: a.byteLength ?? a.content?.length ?? 0,
                on_source: sourceIds.has(a.id),
              }));
            toolResult = JSON.stringify({
              ok: true,
              count: csvs.length,
              csvs,
              hint: csvs.some((c) => c.on_source)
                ? 'Prefer MUTATE of source CSVs via set_transform_code.'
                : 'No source CSVs — use SYNTHESIZE (set_dataset_code).',
            });
          }
        } else if (name === 'preview_csv_asset') {
          if (ctx.source.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else {
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
                toolResult = JSON.stringify({
                  ok: true,
                  id: assetId,
                  name: meta.name,
                  mount: mountPathForAsset(meta),
                  ...csvPreviewLines(content, maxRows),
                });
              }
            }
          }
        } else if (name === 'set_transform_code') {
          if (ctx.source.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else {
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
            });
          }
        } else if (name === 'run_transform_code') {
          if (ctx.source.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else {
            const ids = Array.isArray(args.asset_ids)
              ? args.asset_ids.map((x) => String(x))
              : [];
            const lang =
              args.language === 'r' || args.language === 'python'
                ? args.language
                : draft.transformCode.r.trim() &&
                    !draft.transformCode.python.trim()
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
                error: `transformCode.${lang} empty`,
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
                  });
                }
              }
            }
          }
        } else if (name === 'set_dataset_code') {
          if (ctx.source.taskType !== 2) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'dataset code is for type 2 only',
            });
          } else {
            draft.datasetCode = String(args.code ?? '');
            onDraft?.(draft);
            toolResult = JSON.stringify({
              ok: true,
              bytes: draft.datasetCode.length,
            });
          }
        } else if (name === 'run_dataset_code') {
          if (ctx.source.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else if (!draft.datasetCode.trim()) {
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
          if (ctx.source.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else {
            const files = Array.isArray(args.files)
              ? args.files.map((f) => String(f))
              : [];
            const folder =
              typeof args.library_folder === 'string' && args.library_folder.trim()
                ? args.library_folder.trim().replace(/^\/+|\/+$/g, '')
                : `variants/${ctx.source.id}`;
            const bodies: Array<{ basename: string; content: string }> = [];
            for (const raw of files) {
              const base = raw.replace(/^out\//, '').replace(/^.*\//, '');
              if (!base.toLowerCase().endsWith('.csv')) continue;
              bodies.push({
                basename: base,
                content: await readPyodideFileText(`out/${base}`),
              });
            }
            const { added, renames } = await persistGeneratedCsvAssets({
              files: bodies,
              folder,
              existingAssets: ctx.project.assets,
              addProjectAssets: ctx.addProjectAssets,
            });
            upsertProjectAssets(ctx.project.assets, added);
            if (renames.length) {
              draft = applyCsvRenamesToDraftFields(draft, renames);
            }
            draft.assetIds = added.map((a) => a.id);
            onDraft?.(draft);
            toolResult = JSON.stringify({
              ok: true,
              assetIds: draft.assetIds,
              paths: added.map((a) => a.path),
              mount: added.map((a) => mountPathForAsset(a)),
              renamed: renames,
              hint:
                renames.length > 0
                  ? 'Some CSV basenames already existed — saved with _<hash> suffix (no overwrite). Use the returned mount paths.'
                  : 'In answer_code / markdown load via mount paths only (data/<file>.csv).',
            });
          }
        } else if (name === 'save_variant' || name === 'apply_changes') {
          const expectApply = mode === 'modify';
          if (
            (expectApply && name !== 'apply_changes') ||
            (!expectApply && name !== 'save_variant')
          ) {
            toolResult = JSON.stringify({
              ok: false,
              error: expectApply
                ? 'Use apply_changes for in-place edits'
                : 'Use save_variant to create a new variant',
            });
          } else if (!args.confirm) {
            toolResult = JSON.stringify({ ok: false, error: 'confirm=false' });
          } else if (!onSave) {
            toolResult = JSON.stringify({ ok: false, error: 'save unavailable' });
          } else if (
            ctx.source.taskType !== 2 &&
            !shortAnswersAreFinite(draft.shortAnswers, {
              taskType:
                ctx.source.taskType === 1 || ctx.source.taskType === 3
                  ? ctx.source.taskType
                  : undefined,
            })
          ) {
            toolResult = JSON.stringify({
              ok: false,
              error:
                'Answers are missing or NaN/Inf — regenerate until finite numbers, then save.',
              regenerate: true,
            });
          } else {
            const prepared = await prepareDraftForVerifiedSave({
              project: ctx.project,
              draft: {
                title: draft.title,
                markdown: draft.markdown,
                language: draft.language,
                answerCode: draft.answerCode,
                gradingCode: draft.gradingCode,
                shortAnswers: draft.shortAnswers,
                assetIds: draft.assetIds,
                taskType: ctx.source.taskType,
              },
              problemShell: {
                ...ctx.source,
                assetIds: draft.assetIds,
                markdown: draft.markdown,
                title: draft.title,
              },
              addProjectAssets: ctx.addProjectAssets,
            });
            draft.markdown = prepared.draft.markdown;
            draft.assetIds = prepared.draft.assetIds;
            draft.answerCode = prepared.draft.answerCode;
            draft.gradingCode = prepared.draft.gradingCode;
            draft.shortAnswers = prepared.draft.shortAnswers;
            onDraft?.(draft);
            if (!prepared.ok) {
              toolResult = JSON.stringify({
                ok: false,
                error: prepared.error,
                regenerate: prepared.regenerate,
              });
            } else {
              const partial: Partial<BankProblem> = {
                title: draft.title,
                note: draft.note,
                showNoteOnExam:
                  mode === 'modify'
                    ? ctx.source.showNoteOnExam
                    : false,
                taskType: ctx.source.taskType,
                kind: ctx.source.kind,
                language: draft.language,
                markdown: draft.markdown,
                answerCode: draft.answerCode,
                gradingCode: draft.gradingCode,
                datasetCode: draft.datasetCode || undefined,
                assetIds: draft.assetIds,
                ...(mode === 'variant'
                  ? { sourceProblemId: ctx.source.id }
                  : {}),
                submitFormat: ctx.source.taskType === 2 ? 'csv' : 'short',
                submitFile:
                  ctx.source.taskType === 2 ? 'result.csv' : undefined,
                ...(() => {
                  if (ctx.source.taskType === 2) {
                    return { shortAnswers: undefined, shortAnswer: '' };
                  }
                  const shorts = ensureShortAnswersForSubQuestions(
                    draft.markdown,
                    draft.shortAnswers,
                    draft.shortAnswers[0],
                    ctx.source.taskType,
                  );
                  return {
                    shortAnswers: shorts,
                    shortAnswer: shorts[0] ?? '',
                  };
                })(),
              };
              savedProblem = onSave(partial);
              toolResult = JSON.stringify({
                ok: true,
                id: savedProblem.id,
                title: savedProblem.title,
                mode,
                verified: true,
                verifiedLanguage: prepared.verifiedLanguage,
                csvAssetIds: linkedCsvAssetIds(
                  ctx.project,
                  savedProblem.assetIds,
                ),
              });
            }
          }
        } else if (isWebToolName(name)) {
          toolResult = await runWebTool(name, args);
        } else {
          toolResult = JSON.stringify({ ok: false, error: `unknown tool ${name}` });
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
    }
  }

  // Strip the injected SOURCE CONTEXT from returned history for UI
  const uiMessages = messages.filter(
    (m, i) =>
      !(
        i > 0 &&
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.startsWith('SOURCE PROBLEM CONTEXT:')
      ),
  );

  // Persist final answers only — drop think/thought from stored turns.
  return {
    messages: stripThinkingFromHistory(
      uiMessages.filter((m) => m.role !== 'system'),
    ),
    draft,
    assistantText: stripThinkingContent(assistantText),
    savedProblem,
  };
}

function summarizeDraft(draft: VariantDraft) {
  return {
    title: draft.title,
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
