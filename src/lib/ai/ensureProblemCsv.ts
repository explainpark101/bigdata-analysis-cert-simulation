import { createProjectAsset } from '@/lib/projectIO';
import type {
  AuthoringProject,
  BankProblem,
  ProjectAsset,
  TaskType,
} from '@/types/project';

function isCsvAsset(asset: ProjectAsset | undefined): boolean {
  if (!asset) return false;
  return (asset.name || asset.path || '').toLowerCase().endsWith('.csv');
}

/** CSV asset ids currently linked to the problem (images etc. ignored). */
export function linkedCsvAssetIds(
  project: AuthoringProject,
  assetIds: string[],
): string[] {
  return assetIds.filter((id) =>
    isCsvAsset(project.assets.find((a) => a.id === id)),
  );
}

export function problemDependsOnCsv(
  project: AuthoringProject,
  problem: Pick<BankProblem, 'assetIds'>,
): boolean {
  return linkedCsvAssetIds(project, problem.assetIds).length > 0;
}

function type13CsvContent(): string {
  const rows = [
    'id,group,value,flag',
    '1,A,12.5,0',
    '2,A,8.0,1',
    '3,B,15.2,0',
    '4,B,9.7,1',
    '5,A,11.1,0',
    '6,B,14.0,1',
    '7,A,10.3,0',
    '8,B,13.8,0',
    '9,A,7.5,1',
    '10,B,16.1,0',
  ];
  return `${rows.join('\n')}\n`;
}

function type2TrainCsv(): string {
  const header = 'id,x1,x2,x3,y';
  const rows: string[] = [header];
  for (let i = 1; i <= 40; i++) {
    const x1 = (i % 7) + 1;
    const x2 = (i % 5) * 0.5;
    const x3 = i % 2;
    const y = x1 * 1.2 + x2 - x3 + (i % 3) * 0.1;
    rows.push(`${i},${x1},${x2},${x3},${y.toFixed(2)}`);
  }
  return `${rows.join('\n')}\n`;
}

function type2TestCsv(): string {
  const header = 'id,x1,x2,x3';
  const rows: string[] = [header];
  for (let i = 101; i <= 120; i++) {
    const x1 = (i % 7) + 1;
    const x2 = (i % 5) * 0.5;
    const x3 = i % 2;
    rows.push(`${i},${x1},${x2},${x3}`);
  }
  return `${rows.join('\n')}\n`;
}

function forcedCsvSpecs(taskType: TaskType): Array<{ name: string; content: string }> {
  if (taskType === 2) {
    return [
      { name: 'train.csv', content: type2TrainCsv() },
      { name: 'test.csv', content: type2TestCsv() },
    ];
  }
  return [{ name: 'data.csv', content: type13CsvContent() }];
}

/**
 * If the problem has no linked .csv assets, synthesize CSV(s), add them to the
 * project library, and return the ids to attach. Non-CSV assets are kept.
 */
export async function ensureProblemHasCsv(opts: {
  project: AuthoringProject;
  problem: BankProblem;
  addProjectAssets: (assets: ProjectAsset[]) => Promise<ProjectAsset[]>;
}): Promise<{
  assetIds: string[];
  created: ProjectAsset[];
  changed: boolean;
  csvNames: string[];
}> {
  const { project, problem, addProjectAssets } = opts;
  const existingCsv = linkedCsvAssetIds(project, problem.assetIds);
  if (existingCsv.length > 0) {
    return {
      assetIds: [...problem.assetIds],
      created: [],
      changed: false,
      csvNames: existingCsv
        .map((id) => project.assets.find((a) => a.id === id)?.name)
        .filter((n): n is string => Boolean(n)),
    };
  }

  const folder = `bank/${problem.id}`;
  const specs = forcedCsvSpecs(problem.taskType);
  const pending = specs.map((s) =>
    createProjectAsset(
      {
        name: s.name,
        content: s.content,
        encoding: 'utf-8',
        mimeType: 'text/csv',
      },
      `${folder}/${s.name}`,
    ),
  );
  const created = await addProjectAssets(pending);
  const nonCsv = problem.assetIds.filter(
    (id) => !isCsvAsset(project.assets.find((a) => a.id === id)),
  );
  const assetIds = [...nonCsv, ...created.map((a) => a.id)];
  return {
    assetIds,
    created,
    changed: true,
    csvNames: created.map((a) => a.name),
  };
}

/** Append a short data-file note to markdown when forced CSVs were attached. */
export function appendCsvMountNote(
  markdown: string,
  csvNames: string[],
): string {
  if (!csvNames.length) return markdown;
  const mounts = csvNames.map((n) => `\`data/${n}\``).join(', ');
  const note = `\n\n> (자동) 이 문항은 CSV에 의존합니다. 제공 파일: ${mounts}\n`;
  if (markdown.includes('(자동) 이 문항은 CSV에 의존합니다')) return markdown;
  return `${markdown.trimEnd()}${note}`;
}
