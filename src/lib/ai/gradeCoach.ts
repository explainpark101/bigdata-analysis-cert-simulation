import { loadAiSettings } from '@/lib/aiSettings';
import {
  chatContentToText,
  createChatCompletion,
} from '@/lib/ai/openaiCompatible';
import type { GradeItem } from '@/lib/examGrade';

/** 1-based line map so the model can cite concrete locations. */
function numberedCode(code: string, language: string): string {
  const body = code.trim() || '(코드 없음)';
  const lines = body.split(/\r?\n/);
  const numbered = lines
    .map((line, i) => `${String(i + 1).padStart(3, ' ')}| ${line}`)
    .join('\n');
  return ['```' + language, numbered, '```'].join('\n');
}

export async function askGradeCoach(item: GradeItem): Promise<string> {
  const settings = await loadAiSettings();
  const language = item.language ?? 'python';
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

  const result = await createChatCompletion({
    settings,
    temperature: 0.3,
    messages: [
      {
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
        ].join(' '),
      },
      {
        role: 'user',
        content: [
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
          '## 내 코드 (줄번호 포함 — 이 번호로 잘못된 곳을 지적하세요)',
          numberedCode(item.userCode ?? '', language),
          item.submittedCsvPreview
            ? `\n## 제출 CSV 미리보기\n${item.submittedCsvPreview}`
            : '',
          '',
          '왜 틀렸는지, **내 코드의 몇 번째 줄이 문제인지** 인용하고, 그 부분을 어떻게 고치면 되는지 알려주세요.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  return chatContentToText(result.message.content).trim() || '(빈 응답)';
}
