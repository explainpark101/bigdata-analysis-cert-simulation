/**
 * Build a local-only AuthoringProject from Golden Rabbit
 * "09 독자 제공용 파일":
 *   - 3. 기출 변형 문제 (rounds 9–12)
 *   - 4. Level 모의고사 (rounds 1–4)
 *
 * Output is written ONLY under ./private/ (gitignored).
 * Never commit the output or copy 기출 text into src/.
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import {
  defaultGradingCode,
  emptyCode,
  shortFieldsFor,
  starterFor,
} from './lib/bankEnrich.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PRIVATE_DIR = path.join(ROOT, 'private');
const OUT_JSON = path.join(PRIVATE_DIR, 'goldenrabbit.project.json');
const OUT_ZIP = path.join(PRIVATE_DIR, 'goldenrabbit.project.zip');

const DEFAULT_SOURCE_DIR =
  process.env.GOLDEN_SOURCE_DIR ||
  path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    'Documents',
    '빅데이터분석기사',
    '골든래빗_기출',
    '09 독자 제공용 파일',
  );

interface CodeByLanguage {
  python: string;
  r: string;
}

interface ProjectAsset {
  id: string;
  path: string;
  name: string;
  encoding: 'utf-8' | 'base64';
  content: string;
  mimeType?: string;
}

interface BankProblem {
  id: string;
  number: string;
  title: string;
  note?: string;
  showNoteOnExam?: boolean;
  taskType: 1 | 2 | 3;
  kind: 'guide' | 'practice' | 'submit';
  markdown: string;
  language: 'python' | 'r';
  starterCode: CodeByLanguage;
  answerCode?: CodeByLanguage;
  shortAnswer?: string;
  shortAnswers?: string[];
  gradingCode?: CodeByLanguage;
  assetIds: string[];
  submitFormat?: 'short' | 'csv';
  submitFile?: string;
}

interface ExamBlueprint {
  id: string;
  title: string;
  description?: string;
  timeLimitMinutes: number | null;
  maxRunSeconds: number;
  problemIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface AuthoringProject {
  schemaVersion: 1;
  kind: 'project';
  id: string;
  title: string;
  description?: string;
  assets: ProjectAsset[];
  bank: BankProblem[];
  exams: ExamBlueprint[];
  activeExamId: string;
  createdAt?: string;
  updatedAt?: string;
}

interface NbCell {
  cell_type: string;
  source?: string | string[];
}

interface ParsedProblem {
  taskType: 1 | 2 | 3;
  index: number;
  title: string;
  prompt: string;
  code: string;
}

interface ExamUnit {
  examId: string;
  title: string;
  description: string;
  slug: string;
  dir: string;
}

function assertPrivatePath(p: string): void {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(PRIVATE_DIR))) {
    throw new Error(`Refusing to write outside private/: ${resolved}`);
  }
}

function cellSource(cell: NbCell): string {
  const s = cell.source;
  if (Array.isArray(s)) return s.join('');
  return String(s ?? '');
}

function firstLine(src: string): string {
  return src.trim().split(/\r?\n/)[0] ?? '';
}

function detectTaskFromFilename(name: string): 1 | 2 | 3 | null {
  const base = path.basename(name, path.extname(name));
  if (/제?\s*1\s*유형|^1유형$/i.test(base)) return 1;
  if (/제?\s*2\s*유형|^2유형$/i.test(base)) return 2;
  if (/제?\s*3\s*유형|^3유형$/i.test(base)) return 3;
  return null;
}

function detectTaskFromHeader(line: string): 1 | 2 | 3 | null {
  const m = line.match(
    /작업형\s*(?:제\s*)?([123])\s*유형|(?:^|\s)#\s*작업형\s*([123])유형/,
  );
  if (!m) return null;
  const n = Number(m[1] || m[2]);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

function parseProblemHeader(src: string): { num: number | null } | null {
  const line = firstLine(src);
  const m = line.match(/^##\s*문제(?:\s*(\d+))?/);
  if (!m) return null;
  return { num: m[1] ? Number(m[1]) : null };
}

function isSectionBreak(src: string): boolean {
  const line = firstLine(src);
  if (/^#\s+작업형/.test(line)) return true;
  if (/^##\s*문제/.test(line)) return true;
  if (/^##\s*이번 회차/.test(line)) return true;
  return false;
}

function detectLang(code: string): 'python' | 'r' {
  if (/^\s*import\s+pandas|^\s*from\s+\w+|^\s*pd\.|^\s*def\s+/m.test(code)) {
    return 'python';
  }
  if (/<-|library\(|tidyverse|read_csv\(/m.test(code)) return 'r';
  return 'python';
}

function extractCsvRefs(text: string): string[] {
  const refs = new Set<string>();
  const patterns = [
    /(?:read_csv|read\.csv|pd\.read_csv)\(\s*["']([^"']+\.csv)["']/gi,
    /["']([\w.\-\/]+\.csv)["']/gi,
    /\(([\w.\-]+\.csv)\)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const ref = m[1].replace(/\\/g, '/');
      const base = path.basename(ref).toLowerCase();
      if (base === 'result.csv' || base === 'submission.csv') continue;
      refs.add(path.basename(ref));
    }
  }
  return [...refs];
}

function rewriteCodePaths(code: string, pathMap: Map<string, string>): string {
  let out = code;
  const entries = [...pathMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    out = out.split(from).join(to);
  }
  for (const [from, to] of entries) {
    const base = path.basename(from);
    const re = new RegExp(`(["'])(?:\\.\\/)?${escapeReg(base)}\\1`, 'g');
    out = out.replace(re, `$1${to}$1`);
  }
  return out;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listFilesRecursive(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function findExamDir(roundDir: string): Promise<string> {
  const entries = await readdir(roundDir, { withFileTypes: true });
  const nested = entries.find(
    (e) => e.isDirectory() && /기출동형/.test(e.name),
  );
  if (nested) return path.join(roundDir, nested.name);
  return roundDir;
}

function parseNotebookProblems(
  cells: NbCell[],
  defaultTask: 1 | 2 | 3 | null,
): ParsedProblem[] {
  let currentTask: 1 | 2 | 3 = defaultTask ?? 1;
  const out: ParsedProblem[] = [];
  const counters: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell.cell_type !== 'markdown') continue;
    const src = cellSource(cell);
    const headerTask = detectTaskFromHeader(firstLine(src));
    if (headerTask) {
      currentTask = headerTask;
      continue;
    }
    const problemHead = parseProblemHeader(src);
    if (!problemHead) continue;

    const promptBody = src
      .replace(/^##\s*문제[^\n]*\n?/, '')
      .trim();

    let code = '';
    for (let j = i + 1; j < cells.length; j += 1) {
      const next = cells[j];
      const nextSrc = cellSource(next);
      if (next.cell_type === 'markdown' && isSectionBreak(nextSrc)) break;
      if (next.cell_type === 'code') {
        code = nextSrc.trim();
        break;
      }
    }

    counters[currentTask] += 1;
    const seq =
      problemHead.num && problemHead.num > 0
        ? problemHead.num
        : counters[currentTask];
    out.push({
      taskType: currentTask,
      index: seq,
      title: `제${currentTask}유형 ${seq}번`,
      prompt: promptBody || `제${currentTask}유형 ${seq}번`,
      code,
    });
  }
  return out;
}

async function discoverUnits(sourceRoot: string): Promise<ExamUnit[]> {
  const units: ExamUnit[] = [];

  const variantRoot = path.join(sourceRoot, '3. 기출변형 문제');
  try {
    const rounds = await readdir(variantRoot, { withFileTypes: true });
    for (const ent of rounds) {
      if (!ent.isDirectory()) continue;
      const m = ent.name.match(/제\s*(\d+)\s*회/);
      if (!m) continue;
      const round = Number(m[1]);
      const roundDir = path.join(variantRoot, ent.name);
      const examDir = await findExamDir(roundDir);
      units.push({
        examId: `exam-gr-variant-r${round}`,
        title: `골든래빗 제${round}회 기출변형`,
        description: `09 독자제공 · 3. 기출변형 · 제${round}회`,
        slug: `gr_v${round}`,
        dir: examDir,
      });
    }
  } catch {
    console.warn(`missing variant dir: ${variantRoot}`);
  }

  const levelRoot = path.join(sourceRoot, '4. Level 모의고사');
  try {
    const rounds = await readdir(levelRoot, { withFileTypes: true });
    for (const ent of rounds) {
      if (!ent.isDirectory()) continue;
      const m = ent.name.match(/(\d+)\s*회/);
      if (!m) continue;
      const round = Number(m[1]);
      units.push({
        examId: `exam-gr-level-r${round}`,
        title: `골든래빗 수준별 모의고사 ${round}회`,
        description: `09 독자제공 · 4. Level 모의고사 · ${round}회`,
        slug: `gr_lv${round}`,
        dir: path.join(levelRoot, ent.name),
      });
    }
  } catch {
    console.warn(`missing level dir: ${levelRoot}`);
  }

  units.sort((a, b) => a.examId.localeCompare(b.examId, 'en'));
  return units;
}

async function buildProject(sourceRoot: string): Promise<AuthoringProject> {
  const now = new Date().toISOString();
  const units = await discoverUnits(sourceRoot);
  if (!units.length) {
    throw new Error(`No exam units found under ${sourceRoot}`);
  }

  const assets: ProjectAsset[] = [];
  const bank: BankProblem[] = [];
  const exams: ExamBlueprint[] = [];
  const assetByKey = new Map<string, string>();

  for (const unit of units) {
    const files = await listFilesRecursive(unit.dir);
    const notebooks = files.filter((f) => /\.ipynb$/i.test(f));
    const csvFiles = files.filter((f) => {
      const b = path.basename(f).toLowerCase();
      return (
        /\.csv$/i.test(f) &&
        b !== 'result.csv' &&
        b !== 'submission.csv'
      );
    });

    const csvContent = new Map<string, string>();
    for (const csvPath of csvFiles) {
      const base = path.basename(csvPath);
      const text = await readFile(csvPath, 'utf8');
      csvContent.set(base, text);
      csvContent.set(base.toLowerCase(), text);
    }

    const ensureAsset = (basename: string): string | null => {
      const raw =
        csvContent.get(basename) ?? csvContent.get(basename.toLowerCase());
      if (raw == null) return null;
      const key = `${unit.slug}::${basename.toLowerCase()}`;
      const existing = assetByKey.get(key);
      if (existing) return existing;
      const id = `asset-${unit.slug}-${basename.toLowerCase().replace(/[^\w.\-]+/g, '_')}`;
      const mountName = `${unit.slug}_${basename}`;
      const mountPath = `data/${mountName}`;
      assets.push({
        id,
        path: mountPath,
        name: mountName,
        encoding: 'utf-8',
        content: raw,
        mimeType: 'text/csv',
      });
      assetByKey.set(key, id);
      return id;
    };

    const basenameToMount = new Map<string, string>();
    for (const csvPath of csvFiles) {
      const base = path.basename(csvPath);
      const id = ensureAsset(base);
      if (!id) continue;
      const asset = assets.find((a) => a.id === id)!;
      basenameToMount.set(base, asset.path);
      basenameToMount.set(base.toLowerCase(), asset.path);
    }

    const pathMap = new Map<string, string>();
    for (const [base, mount] of basenameToMount) {
      pathMap.set(base, mount);
    }

    const problemIds: string[] = [];
    let seqGlobal = 0;

    // Prefer type-split notebooks first, then combined
    const orderedNb = [...notebooks].sort((a, b) => {
      const ta = detectTaskFromFilename(a) ?? 9;
      const tb = detectTaskFromFilename(b) ?? 9;
      return ta - tb || a.localeCompare(b, 'en');
    });

    for (const nbPath of orderedNb) {
      const defaultTask = detectTaskFromFilename(nbPath);
      let nb: { cells?: NbCell[] };
      try {
        nb = JSON.parse(await readFile(nbPath, 'utf8')) as { cells?: NbCell[] };
      } catch (err) {
        console.warn(`skip notebook ${nbPath}:`, err);
        continue;
      }
      const parsed = parseNotebookProblems(nb.cells ?? [], defaultTask);
      for (const p of parsed) {
        seqGlobal += 1;
        const refs = extractCsvRefs(`${p.prompt}\n${p.code}`);
        const assetIds: string[] = [];
        const mountFiles: string[] = [];

        for (const ref of refs) {
          const id = ensureAsset(ref);
          if (!id) continue;
          if (!assetIds.includes(id)) assetIds.push(id);
          const mount =
            basenameToMount.get(ref) ?? basenameToMount.get(ref.toLowerCase());
          if (mount) mountFiles.push(mount);
        }

        if (p.taskType === 2) {
          for (const base of csvFiles.map((f) => path.basename(f))) {
            if (!/(train|test)/i.test(base)) continue;
            const id = ensureAsset(base);
            if (!id) continue;
            if (!assetIds.includes(id)) assetIds.push(id);
            const mount =
              basenameToMount.get(base) ??
              basenameToMount.get(base.toLowerCase());
            if (mount) mountFiles.push(mount);
          }
        }

        if (!assetIds.length && p.taskType !== 2) {
          for (const ref of refs) {
            const id = ensureAsset(ref);
            if (id && !assetIds.includes(id)) assetIds.push(id);
          }
        }

        const lang = detectLang(p.code);
        const rewritten = rewriteCodePaths(p.code, pathMap);
        const mounts = [...new Set(mountFiles)];
        const starter = starterFor(p.taskType, mounts);
        const answerCode = emptyCode();
        if (lang === 'python') answerCode.python = rewritten;
        else answerCode.r = rewritten;
        const shorts = shortFieldsFor(p.taskType, answerCode, lang);

        const id = `${unit.slug}-t${p.taskType}-q${p.index}-${seqGlobal}`;
        const markdown = [
          `## 제${p.taskType}유형 ${p.index}번`,
          '',
          p.prompt.trim(),
          '',
          mounts.length
            ? `제공 파일: ${mounts.map((f) => `\`${f}\``).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n');

        bank.push({
          id,
          number: String(seqGlobal).padStart(2, '0'),
          title: `${unit.title} · ${p.title}`,
          note: unit.description,
          showNoteOnExam: false,
          taskType: p.taskType,
          kind: 'submit',
          markdown,
          language: lang,
          starterCode: starter,
          answerCode,
          shortAnswer: shorts.shortAnswer,
          shortAnswers: shorts.shortAnswers,
          gradingCode: p.taskType === 2 ? defaultGradingCode() : emptyCode(),
          assetIds,
          submitFormat: p.taskType === 2 ? 'csv' : 'short',
          submitFile: p.taskType === 2 ? 'result.csv' : undefined,
        });
        problemIds.push(id);
      }
    }

    exams.push({
      id: unit.examId,
      title: unit.title,
      description: unit.description,
      timeLimitMinutes: 180,
      maxRunSeconds: 60,
      problemIds,
      createdAt: now,
      updatedAt: now,
    });
    console.log(
      `${unit.title}: ${problemIds.length} problems, csv=${csvFiles.length}, nb=${notebooks.length}`,
    );
  }

  if (!exams.length) {
    throw new Error('No exams built');
  }

  return {
    schemaVersion: 1,
    kind: 'project',
    id: 'bigdata-goldenrabbit-reader',
    title: '골든래빗 독자제공 (기출변형·수준별 모의고사)',
    description:
      'Local-only package from Golden Rabbit 09 reader files. Do not publish to GitHub.',
    assets,
    bank,
    exams,
    activeExamId: exams[0].id,
    createdAt: now,
    updatedAt: now,
  };
}

async function writeZip(project: AuthoringProject): Promise<void> {
  assertPrivatePath(OUT_ZIP);
  const zip = new JSZip();
  const meta = {
    ...project,
    assets: project.assets.map(({ id, path: p, name, encoding, mimeType }) => ({
      id,
      path: p,
      name,
      encoding,
      mimeType,
      content: '',
    })),
  };
  zip.file('project.json', JSON.stringify(meta, null, 2));
  for (const asset of project.assets) {
    zip.file(`files/${asset.id}/${asset.path}`, asset.content);
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  await writeFile(OUT_ZIP, buf);
}

async function main(): Promise<void> {
  await mkdir(PRIVATE_DIR, { recursive: true });
  assertPrivatePath(PRIVATE_DIR);

  const sourceRoot = DEFAULT_SOURCE_DIR;
  const st = await stat(sourceRoot).catch(() => null);
  if (!st?.isDirectory()) {
    throw new Error(`Cannot read Golden Rabbit source dir: ${sourceRoot}`);
  }
  console.log(`source: ${sourceRoot}`);

  const project = await buildProject(sourceRoot);
  assertPrivatePath(OUT_JSON);
  await writeFile(OUT_JSON, JSON.stringify(project, null, 2), 'utf8');
  await writeZip(project);

  console.log(`wrote ${OUT_JSON}`);
  console.log(`wrote ${OUT_ZIP}`);
  console.log(
    `assets=${project.assets.length} bank=${project.bank.length} exams=${project.exams.length}`,
  );
  console.log('NOTE: private/ is gitignored — do not force-add these files.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
