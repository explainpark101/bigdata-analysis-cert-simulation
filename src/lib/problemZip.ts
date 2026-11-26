import type { AuthoringProject, BankProblem } from '@/types/project';
import { createEmptyProject } from '@/lib/projectIO';
import { buildProjectZip } from '@/lib/projectZip';
import { downloadBlob } from '@/lib/download';

function safeFilenameStem(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'problem';
}

/**
 * Build a mini authoring project ZIP that contains exactly one bank problem
 * and its linked assets. Importable via mergeBankZips / 문제 불러오기.
 */
export async function buildProblemZip(
  project: AuthoringProject,
  problem: BankProblem,
): Promise<{ blob: Blob; filename: string }> {
  const assetIdSet = new Set(problem.assetIds ?? []);
  const assets = project.assets.filter((a) => assetIdSet.has(a.id));
  const mini = createEmptyProject({
    id: `prob-${problem.id}`,
    title: problem.title || `제${problem.taskType}유형`,
    description: `Single problem export · 제${problem.taskType}유형`,
  });
  // Drop the default empty exam from the export — bank-only package.
  const pack: AuthoringProject = {
    ...mini,
    assets,
    bank: [structuredClone(problem)],
    exams: [
      {
        ...mini.exams[0],
        title: `${problem.title || problem.id} (단건)`,
        problemIds: [problem.id],
        description: 'Single-problem package',
      },
    ],
    activeExamId: mini.exams[0].id,
  };

  const blob = await buildProjectZip(pack);
  const stem = safeFilenameStem(
    problem.title || `t${problem.taskType}-${problem.id}`,
  );
  return { blob, filename: `${stem}.problem.zip` };
}

export async function exportProblemZip(
  project: AuthoringProject,
  problem: BankProblem,
): Promise<void> {
  const { blob, filename } = await buildProblemZip(project, problem);
  downloadBlob(filename, blob);
}
