import { loadAiSettings } from '@/lib/aiSettings';
import {
  chatContentToText,
  createChatCompletion,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';
import type { GradeItem } from '@/lib/examGrade';

/** Default first-turn prompt when the examinee opens the coach dock. */
export const GRADE_WHY_WRONG_PROMPT =
  '왜 틀렸는지, **내 코드의 몇 번째 줄이 문제인지** 인용하고, 그 부분을 어떻게 고치면 되는지 알려주세요.';

/** 1-based line map so the model can cite concrete locations. */
function numberedCode(code: string, language: string): string {
  const body = code.trim() || '(코드 없음)';
  const lines = body.split(/\r?\n/);
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(3, ' ')}| ${line}`)
    .join('\n');
  return ['```' + language, numbered, '```'].join('\n');
}

function gradeContextBlock(item: GradeItem): string {
  const language = item.language ?? 'python';
  const pythonCode =
    item.userCodes?.python ??
    (language === 'python' ? item.userCode : undefined) ??
    '';
  const rCode =
    item.userCodes?.r ??
    (language === 'r' ? item.userCode : undefined) ??
    '';
  const answerBlock =
    item.answers
      ?.map(
        (a) =>
          `- ${a.label}: expected=${JSON.stringify(a.expected)} submitted=${JSON.stringify(a.submitted)} (${a.ok ? 'OK' : 'WRONG'})`,
      )
      .join('\n') ?? '(no short answers)';

  const scoreBlock = item.type2Score
    ? `ml=${item.type2Score.mlKind} metric=${item.type2Score.label}(${item.type2Score.direction}) student=${item.type2Score.achieved} ref=${item.type2Score.expected} y_scale=${item.type2Score.yScale} gap=${item.type2Score.gap} earnedRatio=${item.type2Score.earnedRatio}`
    : '';

  return [
    `문제 제목: ${item.title}`,
    item.taskType ? `유형: 제${item.taskType}유형` : '',
    '',
    '## 문제',
    item.markdown?.trim() || '(없음)',
    '',
    '## 채점 결과',
    `status=${item.status} score=${item.earned}/${item.max}`,
    item.detail || '',
    scoreBlock,
    '',
    '## 단답 비교',
    answerBlock,
    '',
    '## 내 코드 — Python (줄번호 포함)',
    numberedCode(pythonCode, 'python'),
    '',
    '## 내 코드 — R (줄번호 포함)',
    numberedCode(rCode, 'r'),
    item.submittedCsvPreview
      ? `\n## 제출 CSV 미리보기\n${item.submittedCsvPreview}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildSystemMessage(item: GradeItem): ChatMessage {
  return {
    role: 'system',
    content: [
      'You are a tutor for 빅데이터분석기사 실기.',
      'Explain in Korean why the examinee is wrong.',
      'ALWAYS inspect the numbered source code and point out the faulty location:',
      '- Cite line numbers (e.g. L12–L14) and quote the bad snippet in a fenced code block.',
      '- Say what is wrong there (logic, API misuse, wrong column, missing step, wrong round/trunc, wrong submit shape, etc.).',
      '- Give a concrete corrected snippet for that part (not a full rewrite unless necessary).',
      'If short answers are wrong, also map which code print/output caused each wrong slot.',
      'Be concrete and concise. Do not invent files, columns, or APIs that are not in the problem or code.',
      'Structure the reply as: (1) 원인 요약 (2) 코드에서 잘못된 위치 (3) 고치는 방법.',
      'On follow-up questions, stay grounded in the grade context and code below.',
      '',
      '--- GRADE CONTEXT (fixed for this chat) ---',
      gradeContextBlock(item),
    ].join('\n'),
  };
}

/**
 * Multi-turn grade coach. `history` is prior user/assistant turns only
 * (no system). Returns the updated visible history including the new turn.
 * `onDelta` receives the accumulating assistant text for live UI streaming.
 */
export async function askGradeCoachTurn(opts: {
  item: GradeItem;
  history: ChatMessage[];
  userText: string;
  signal?: AbortSignal;
  onDelta?: (accumulated: string) => void;
}): Promise<{ reply: string; messages: ChatMessage[] }> {
  const settings = await loadAiSettings();
  const trimmed = opts.userText.trim() || '(empty)';
  const userMsg: ChatMessage = { role: 'user', content: trimmed };
  const apiMessages: ChatMessage[] = [
    buildSystemMessage(opts.item),
    ...opts.history,
    userMsg,
  ];

  let accumulated = '';
  const result = await createChatCompletion({
    settings,
    temperature: 0.3,
    messages: apiMessages,
    signal: opts.signal,
    onRetry: () => {
      accumulated = '';
      opts.onDelta?.('');
    },
    onDelta: (delta) => {
      if (!delta.content) return;
      accumulated += delta.content;
      opts.onDelta?.(accumulated);
    },
  });

  const reply =
    chatContentToText(result.message.content).trim() ||
    accumulated.trim() ||
    '(빈 응답)';
  const assistantMsg: ChatMessage = { role: 'assistant', content: reply };
  return {
    reply,
    messages: [...opts.history, userMsg, assistantMsg],
  };
}

/** One-shot helper (opens with the default why-wrong prompt). */
export async function askGradeCoach(item: GradeItem): Promise<string> {
  const { reply } = await askGradeCoachTurn({
    item,
    history: [],
    userText: GRADE_WHY_WRONG_PROMPT,
  });
  return reply;
}
