import type { AuthoringProject, BankProblem } from '@/types/project';
import type { ExamSet } from '@/types/exam';
import { maybeUploadViaWebhook } from '@/lib/discordWebhook';
import { buildProblemZip } from '@/lib/problemZip';
import { buildExamZip } from '@/lib/examZip';
import { materializeExamAsync } from '@/lib/projectIO';

/**
 * If a Discord webhook is configured, upload one generated problem ZIP.
 * Never throws — soft-fails so generation can continue.
 */
export async function autoUploadGeneratedProblem(
  project: AuthoringProject,
  problem: BankProblem,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const { blob, filename } = await buildProblemZip(project, problem);
    const result = await maybeUploadViaWebhook({
      filename,
      blob,
      content: `문제 · 제${problem.taskType}유형 · ${problem.title || problem.id}`,
      signal,
    });
    if (result.skipped) return null;
    return result.ok ? result.message : `Webhook: ${result.message}`;
  } catch (err) {
    return `Webhook: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Upload a materialized exam ZIP when webhook is set. Soft-fail. */
export async function autoUploadGeneratedExam(
  exam: ExamSet,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const blob = await buildExamZip(exam);
    const filename = `${exam.id || 'exam'}.exam.zip`;
    const result = await maybeUploadViaWebhook({
      filename,
      blob,
      content: `시험지 · ${exam.title || exam.id}`,
      signal,
    });
    if (result.skipped) return null;
    return result.ok ? result.message : `Webhook: ${result.message}`;
  } catch (err) {
    return `Webhook: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Materialize blueprint then upload exam ZIP. Soft-fail. */
export async function autoUploadExamFromProject(
  project: AuthoringProject,
  examId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const exam = await materializeExamAsync(project, examId);
    return autoUploadGeneratedExam(exam, signal);
  } catch (err) {
    return `Webhook: ${err instanceof Error ? err.message : String(err)}`;
  }
}
