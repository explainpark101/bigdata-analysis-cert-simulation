import { loadAiSettings } from '@/lib/aiSettings';
import { createChatCompletion } from '@/lib/ai/openaiCompatible';
import type { GradeItem } from '@/lib/examGrade';

export async function askGradeCoach(item: GradeItem): Promise<string> {
  const settings = await loadAiSettings();
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
        content:
          'You are a tutor for 빅데이터분석기사 실기. Explain in Korean why the examinee is wrong and exactly what to change in their code or answers. Be concrete and concise. Do not invent files that are not mentioned.',
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
          '## 내 코드',
          '```' + (item.language ?? 'python'),
          item.userCode?.trim() || '(코드 없음)',
          '```',
          item.submittedCsvPreview
            ? `\n## 제출 CSV 미리보기\n${item.submittedCsvPreview}`
            : '',
          '',
          '왜 틀렸는지, 코드를/답안을 어디에 어떻게 고치면 되는지 알려주세요.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  return (result.message.content ?? '').trim() || '(빈 응답)';
}
