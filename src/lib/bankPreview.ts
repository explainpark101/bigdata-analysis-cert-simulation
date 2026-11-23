import { extractMarkdownImagePaths } from '@/lib/assetMedia';
import { mountPathForAsset } from '@/lib/assetPaths';
import { resolveAssets } from '@/lib/projectIO';
import type { ExamAsset, QuizProblem } from '@/types/exam';
import type { AuthoringProject, BankProblem } from '@/types/project';

/** Build a QuizProblem view-model for exam-style preview of a bank item. */
export function bankToPreviewQuiz(
  project: AuthoringProject,
  bank: BankProblem,
): QuizProblem {
  const files: ExamAsset[] = resolveAssets(project, bank.assetIds);
  const seen = new Set(files.map((f) => f.path));

  for (const imgPath of extractMarkdownImagePaths(bank.markdown)) {
    const asset = project.assets.find((a) => {
      const mount = mountPathForAsset(a);
      return (
        mount === imgPath ||
        a.path === imgPath ||
        a.path === `./${imgPath}` ||
        a.name === imgPath
      );
    });
    if (!asset) continue;
    const mount = mountPathForAsset(asset);
    if (seen.has(mount)) continue;
    files.push({
      path: mount,
      name: asset.name,
      encoding: asset.encoding,
      content: asset.content,
      mimeType: asset.mimeType,
    });
    seen.add(mount);
  }

  return {
    id: bank.id,
    number: bank.number,
    title: bank.title || `제${bank.taskType}유형`,
    taskType: bank.taskType,
    note: bank.note,
    showNoteOnExam: bank.showNoteOnExam,
    kind: bank.kind,
    markdown: bank.markdown,
    language: bank.language,
    starterCode: bank.starterCode,
    files,
  };
}
