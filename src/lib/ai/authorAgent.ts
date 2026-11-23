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
  isWebToolName,
  runWebTool,
  WEB_TOOL_DEFS,
} from '@/lib/ai/webTools';
import { resolveAssets, createProjectAsset } from '@/lib/projectIO';
import { mountAssetsToPyodide } from '@/runtimes/fsMount';
import {
  preloadPyodide,
  runPython,
  readPyodideFileText,
} from '@/runtimes/pyodideRuntime';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';

const MAX_TOOL_ROUNDS = 12;

export interface AuthorAgentContext {
  settings: AiEndpointSettings;
  project: AuthoringProject;
  draft: AuthorDraft;
  referenceIds: string[];
  addProjectAssets: (assets: ProjectAsset[]) => ProjectAsset[];
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

function systemPrompt(): string {
  return [
    'You are an exam-authoring agent for 빅데이터분석기사 실기 (DataQ-style).',
    'Create NEW problems. Use selected REFERENCE problems as style/skill inspiration — do not copy them verbatim.',
    'Never invent final numeric answers yourself. Write executable code, run tools, then set answers from stdout.',
    '',
    'Type 1/3: short-answer; set_answer_code → run_answer_code → set_short_answers.',
    'Type 2: synthesize NEW CSVs via set_dataset_code (seeded rules under out/), run_dataset_code, save_generated_assets; grading via update_draft.',
    'Call list_references / get_reference when you need details from selected references.',
    'When you need external facts, library docs, formulas, or examples: use web_search, then fetch_url on the best links.',
    'Do not invent API signatures or numeric exam keys — look them up or compute with tools.',
    'Call save_problem only when the user asks to save or the draft is complete.',
    'Respond briefly in Korean about what you changed.',
  ].join('\n');
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
      description: 'Set short-answer keys (type 1/3 only) from executed output.',
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
      name: 'set_dataset_code',
      description:
        'Type 2: Python that writes new CSVs under out/ with a fixed seed.',
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
      description: 'Run datasetCode in Pyodide and list out/*.csv.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_generated_assets',
      description: 'Persist out/*.csv into the project library and draft.assetIds.',
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
      description: 'Attach existing project asset ids to the draft.',
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

async function runAnswer(
  ctx: AuthorAgentContext,
  language: 'python' | 'r',
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const files = resolveAssets(ctx.project, ctx.draft.assetIds);
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
}): Promise<AuthorAgentResult> {
  const { onDraft, onSave, onProgress, signal } = opts;
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
    { role: 'system', content: systemPrompt() },
    {
      role: 'user',
      content: [
        'AUTHORING CONTEXT',
        `draft=${JSON.stringify(summarizeDraft(draft))}`,
        `selected references (${ctx.referenceIds.length}):`,
        refBrief || '(none)',
        'Use list_references / get_reference for full text.',
      ].join('\n'),
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    throwIfAborted();
    report({
      kind: 'status',
      text: `모델 응답 생성 중… (${round + 1}/${MAX_TOOL_ROUNDS})`,
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
            draft.shortAnswers = answers.length ? answers : [''];
            onDraft?.(draft);
            toolResult = JSON.stringify({ ok: true, answers: draft.shortAnswers });
          }
        } else if (name === 'set_dataset_code') {
          if (draft.taskType !== 2) {
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
          if (draft.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else if (!draft.datasetCode.trim()) {
            toolResult = JSON.stringify({
              ok: false,
              error: 'datasetCode empty',
            });
          } else {
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
          if (draft.taskType !== 2) {
            toolResult = JSON.stringify({ ok: false, error: 'type 2 only' });
          } else {
            const files = Array.isArray(args.files)
              ? args.files.map((f) => String(f))
              : [];
            const folder =
              typeof args.library_folder === 'string' && args.library_folder.trim()
                ? args.library_folder.trim().replace(/^\/+|\/+$/g, '')
                : 'authored/type2';
            const created: ProjectAsset[] = [];
            for (const raw of files) {
              const base = raw.replace(/^out\//, '').replace(/^.*\//, '');
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
            const added = ctx.addProjectAssets(created);
            for (const a of added) {
              const idx = ctx.project.assets.findIndex((x) => x.id === a.id);
              if (idx >= 0) ctx.project.assets[idx] = a;
              else ctx.project.assets.push(a);
            }
            draft.assetIds = added.map((a) => a.id);
            onDraft?.(draft);
            toolResult = JSON.stringify({
              ok: true,
              assetIds: draft.assetIds,
              paths: added.map((a) => a.path),
            });
          }
        } else if (name === 'use_project_assets') {
          const ids = Array.isArray(args.asset_ids)
            ? args.asset_ids.map((x) => String(x))
            : [];
          const valid = ids.filter((id) =>
            ctx.project.assets.some((a) => a.id === id),
          );
          draft.assetIds = valid;
          onDraft?.(draft);
          toolResult = JSON.stringify({ ok: true, assetIds: draft.assetIds });
        } else if (name === 'save_problem') {
          if (!args.confirm) {
            toolResult = JSON.stringify({ ok: false, error: 'confirm=false' });
          } else if (!onSave) {
            toolResult = JSON.stringify({ ok: false, error: 'save unavailable' });
          } else {
            const partial: Partial<BankProblem> = {
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
              sourceProblemId: ctx.referenceIds[0],
              submitFormat: draft.taskType === 2 ? 'csv' : 'short',
              submitFile: draft.taskType === 2 ? 'result.csv' : undefined,
              shortAnswers:
                draft.taskType === 2 ? undefined : draft.shortAnswers,
              shortAnswer:
                draft.taskType === 2 ? '' : (draft.shortAnswers[0] ?? ''),
            };
            savedProblem = onSave(partial);
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
