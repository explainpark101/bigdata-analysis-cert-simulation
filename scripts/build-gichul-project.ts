/**
 * Build a local-only AuthoringProject from 문제복원:
 * - `N회_기출.md` — problem text
 * - `codes/chN/*.csv` + `*.ipynb` — datasets and solution notebooks
 *
 * `ch\\d` folder digit = exam round. Output ONLY under ./private/ (gitignored).
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
const OUT_JSON = path.join(PRIVATE_DIR, 'gichul.project.json');
const OUT_ZIP = path.join(PRIVATE_DIR, 'gichul.project.zip');

const DEFAULT_SRC_DIR =
  process.env.GICHUL_SRC_DIR ||
  process.env.GICHUL_MD_DIR ||
  path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    'Documents',
    '빅데이터분석기사',
    '퇴딴짓_기출',
    '문제복원',
  );

/** Rounds with codes/chN data. */
const CODE_ROUNDS = [2, 3, 4, 5, 6, 7, 8, 9] as const;
/** Extra markdown-only rounds (CSV may be missing). */
const EXTRA_ROUNDS = [10, 11] as const;

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

function assertPrivatePath(p: string): void {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(PRIVATE_DIR))) {
    throw new Error(`Refusing to write outside private/: ${resolved}`);
  }
}

/** csvMap keys: `ch2/members.csv` (and aliases `part4/ch2/…`). */
async function loadLocalCsvMap(codesDir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let chapters: string[];
  try {
    chapters = await readdir(codesDir);
  } catch {
    throw new Error(`Cannot read codes dir: ${codesDir}`);
  }
  for (const ch of chapters) {
    if (!/^ch\d+$/i.test(ch)) continue;
    const dir = path.join(codesDir, ch);
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.toLowerCase().endsWith('.csv')) continue;
      const text = await readFile(path.join(dir, f), 'utf8');
      const key = `${ch}/${f}`.replace(/\\/g, '/');
      out.set(key, text);
      out.set(`part4/${key}`, text);
    }
  }
  return out;
}

function cellSource(cell: { source?: string | string[] }): string {
  if (!cell.source) return '';
  return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}

/** Ordered primary CSV basenames from a type1/2/3 solution notebook. */
async function csvOrderFromIpynb(nbPath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(nbPath, 'utf8');
  } catch {
    return [];
  }
  const nb = JSON.parse(raw) as { cells?: Array<{ cell_type?: string; source?: string | string[] }> };
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const cell of nb.cells ?? []) {
    if (cell.cell_type !== 'code') continue;
    const src = cellSource(cell);
    if (!/read_csv/i.test(src)) continue;
    const primary = primaryCsvFromCell(src);
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    ordered.push(primary);
  }
  return ordered;
}

function primaryCsvFromCell(src: string): string | null {
  // Prefer local filename in comments: # df = pd.read_csv("data4-1.csv")
  const commented = [
    ...src.matchAll(
      /#\s*(?:df|train|test|X_train|X_test|y_train)\s*=\s*(?:pd\.)?read_csv\(\s*["']([^"']+\.csv)["']/gi,
    ),
  ];
  for (const m of commented) {
    const base = path.basename(m[1]).toLowerCase();
    if (base === 'result.csv' || base === 'submission.csv') continue;
    return path.basename(m[1]);
  }
  const active = [
    ...src.matchAll(/(?:pd\.)?read_csv\(\s*["']([^"']+\.csv)["']/gi),
  ];
  for (const m of active) {
    const ref = m[1];
    const base = path.basename(ref.split('/').pop() || ref);
    if (/^result\.csv$|^submission\.csv$/i.test(base)) continue;
    return base;
  }
  return null;
}

async function loadIpynbAnswer(
  codesDir: string,
  round: number,
  taskType: 1 | 2 | 3,
): Promise<{ code: string; csvOrder: string[] }> {
  const ch = `ch${round}`;
  const candidates = [
    path.join(codesDir, ch, `p${round}_type${taskType}.ipynb`),
    path.join(codesDir, ch, `p${round}_type${taskType}_r.ipynb`),
  ];
  for (const nbPath of candidates) {
    try {
      const raw = await readFile(nbPath, 'utf8');
      const nb = JSON.parse(raw) as {
        cells?: Array<{ cell_type?: string; source?: string | string[] }>;
      };
      const chunks: string[] = [];
      for (const cell of nb.cells ?? []) {
        if (cell.cell_type !== 'code') continue;
        const src = cellSource(cell).trim();
        if (!src) continue;
        // Skip pure URL-loading demo cells that duplicate a later solution
        chunks.push(src);
      }
      const csvOrder = await csvOrderFromIpynb(nbPath);
      // Prefer the longest non-empty contiguous solution-ish block near the end
      const code = chunks.length ? `${chunks[chunks.length - 1]}\n` : '';
      return { code, csvOrder };
    } catch {
      /* try next */
    }
  }
  return { code: '', csvOrder: [] };
}

function detectLang(code: string, fence?: string): 'python' | 'r' {
  const f = (fence || '').toLowerCase();
  if (f.includes('python') || f === 'py') return 'python';
  if (f.includes('r') || f === 'rscript') return 'r';
  if (/^\s*import\s+pandas|^\s*from\s+\w+|^\s*pd\.|^\s*def\s+/m.test(code)) {
    return 'python';
  }
  if (/<-|library\(|tidyverse|read_csv\(/m.test(code)) return 'r';
  return 'r';
}

function extractCsvRefs(text: string): string[] {
  const refs = new Set<string>();
  const patterns = [
    /(?:read_csv|read\.csv|pd\.read_csv)\(\s*["']([^"']+\.csv)["']/gi,
    /["']((?:part4\/|data\/|data2\/|ch\d+\/)?[\w.\-\/]+\.csv)["']/gi,
    /https?:\/\/[^'"\s]+\/([\w.\-]+\.csv)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const ref = m[1].replace(/\\/g, '/');
      const base = path.basename(ref).toLowerCase();
      // submission / output filenames, not provided data
      if (base === 'result.csv' || base === 'submission.csv') continue;
      refs.add(ref);
      refs.add(path.basename(ref));
    }
  }
  return [...refs];
}

function rewriteCodePaths(
  code: string,
  pathMap: Map<string, string>,
): string {
  let out = code;
  const entries = [...pathMap.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    out = out.split(from).join(to);
  }
  // bare basename → mount path when unique mapping exists
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

function stripMemoSections(md: string): string {
  // Drop study-memo blocks that are not exam problems
  return md
    .replace(/\n##\s*외울 것:[\s\S]*?(?=\n#\s|\n##\s*[^#]|$)/g, '\n')
    .replace(/\n##\s*기억할 것:[\s\S]*?(?=\n#\s|\n##\s*[^#]|$)/g, '\n');
}

interface ParsedBlock {
  taskType: 1 | 2 | 3;
  index: number;
  title: string;
  prompt: string;
  code: string;
  fence: string;
}

function splitTaskSections(md: string): Array<{ taskType: 1 | 2 | 3; body: string }> {
  const cleaned = stripMemoSections(md);
  // Strict major headers only — avoid "# 2-1", "# 1. foo", memo lines.
  const headerRe =
    /^(#{1,3})\s*작업형\s*(?:제\s*)?([123])\s*(?:유형|번)?\s*$|^(#{1,3})\s*\[\s*작업형\s*제?\s*([123])\s*유형\s*\]\s*$|^(#{1,3})\s*제\s*([123])\s*유형\s*$|^(#{1,3})\s*([123])\s*유형\s*$/gm;

  const matches: Array<{ taskType: 1 | 2 | 3; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(cleaned))) {
    const n = Number(m[2] || m[4] || m[6] || m[8]);
    if (n === 1 || n === 2 || n === 3) {
      matches.push({ taskType: n, index: m.index });
    }
  }
  if (!matches.length) {
    return [{ taskType: 1, body: cleaned }];
  }
  const sections: Array<{ taskType: 1 | 2 | 3; body: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;
    const chunk = cleaned.slice(start, end);
    const body = chunk.replace(/^[^\n]*\n/, '');
    sections.push({ taskType: matches[i].taskType, body });
  }
  return sections;
}

function extractCodeBlocks(body: string): Array<{ fence: string; code: string; index: number }> {
  const blocks: Array<{ fence: string; code: string; index: number }> = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const fence = (m[1] || '').trim().toLowerCase();
    if (fence === 'csv' || fence === 'json') continue;
    blocks.push({ fence, code: m[2].replace(/\s+$/, '\n'), index: m.index });
  }
  return blocks;
}

function parseType1Problems(body: string): ParsedBlock[] {
  const out: ParsedBlock[] = [];

  // Prefer ### 문제 N / ## N번 문제 / **문제 N**
  const unitStarts: Array<{ index: number; num: number }> = [];
  const startRe =
    /(?:^|\n)(?:#{2,4}\s*문제\s*(\d+)\b|#{2,4}\s*(\d+)\s*번\s*문제\b|\*\*문제\s*(\d+)\*\*)/gi;
  let sm: RegExpExecArray | null;
  while ((sm = startRe.exec(body))) {
    unitStarts.push({
      index: sm.index + (sm[0].startsWith('\n') ? 1 : 0),
      num: Number(sm[1] || sm[2] || sm[3]),
    });
  }

  if (unitStarts.length) {
    for (let i = 0; i < unitStarts.length; i += 1) {
      const start = unitStarts[i].index;
      const end =
        i + 1 < unitStarts.length ? unitStarts[i + 1].index : body.length;
      const slice = body.slice(start, end);
      const codeBlock = extractCodeBlocks(slice)[0];
      const prompt = slice
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^\s*#{1,4}[^\n]*\n/, '')
        .replace(/^\s*\*\*[^*]+\*\*\s*/, '')
        .trim();
      out.push({
        taskType: 1,
        index: unitStarts[i].num,
        title: `제1유형 ${unitStarts[i].num}번`,
        prompt: prompt || `제1유형 ${unitStarts[i].num}번`,
        code: codeBlock?.code || '',
        fence: codeBlock?.fence || '',
      });
    }
    return out;
  }

  // Fallback: numbered list items `1. …` that each own following code
  const nums: Array<{ n: number; index: number; line: string }> = [];
  const numRe = /(?:^|\n)(\d+)\.\s+([^\n]+)/g;
  let nm: RegExpExecArray | null;
  while ((nm = numRe.exec(body))) {
    const n = Number(nm[1]);
    if (n >= 1 && n <= 5) {
      nums.push({
        n,
        index: nm.index + (nm[0].startsWith('\n') ? 1 : 0),
        line: nm[2],
      });
    }
  }
  // Keep first occurrence of each 1..3 (typical type1 count)
  const firstByN = new Map<number, (typeof nums)[0]>();
  for (const item of nums) {
    if (!firstByN.has(item.n) && item.n <= 3) firstByN.set(item.n, item);
  }
  const ordered = [...firstByN.values()].sort((a, b) => a.index - b.index);
  for (let i = 0; i < ordered.length; i += 1) {
    const item = ordered[i];
    const end = i + 1 < ordered.length ? ordered[i + 1].index : body.length;
    const slice = body.slice(item.index, end);
    const codeBlock = extractCodeBlocks(slice)[0];
    out.push({
      taskType: 1,
      index: item.n,
      title: `제1유형 ${item.n}번`,
      prompt: item.line.trim(),
      code: codeBlock?.code || '',
      fence: codeBlock?.fence || '',
    });
  }
  return out;
}

function parseType23Problems(
  taskType: 2 | 3,
  body: string,
): ParsedBlock[] {
  // Type 2 is almost always a single ML task.
  if (taskType === 2) {
    const codeBlock = extractCodeBlocks(body)[0];
    const prompt = body.replace(/```[\s\S]*?```/g, '').trim().slice(0, 4000);
    return [
      {
        taskType: 2,
        index: 1,
        title: '제2유형',
        prompt: prompt || '제2유형',
        code: codeBlock?.code || '',
        fence: codeBlock?.fence || '',
      },
    ];
  }

  // Type 3: split on ## 문제 N / **문제 N**
  const unitStarts: Array<{ index: number; num: number }> = [];
  const startRe =
    /(?:^|\n)(?:#{2,4}\s*문제\s*(\d+)\b|#{2,4}\s*(\d+)\s*번\b|\*\*문제\s*(\d+)\b[^*]*\*\*)/gi;
  let sm: RegExpExecArray | null;
  while ((sm = startRe.exec(body))) {
    unitStarts.push({
      index: sm.index + (sm[0].startsWith('\n') ? 1 : 0),
      num: Number(sm[1] || sm[2] || sm[3]),
    });
  }

  if (unitStarts.length >= 2) {
    // De-dupe by problem number (nested "### 문제" repeats confuse some md files)
    const byNum = new Map<number, { index: number; num: number }>();
    for (const u of unitStarts) {
      if (!byNum.has(u.num)) byNum.set(u.num, u);
    }
    const unique = [...byNum.values()].sort((a, b) => a.num - b.num);
    return unique.map((u, i) => {
      const end = i + 1 < unique.length ? unique[i + 1].index : body.length;
      // Extend end to next raw unit start if available for fuller slice
      const rawEnd =
        unitStarts.find((x) => x.index > u.index && x.num !== u.num)?.index ??
        end;
      const slice = body.slice(u.index, Math.max(end, rawEnd));
      const codeBlock = extractCodeBlocks(slice)[0];
      const prompt = slice
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^\s*#{1,4}[^\n]*\n/, '')
        .replace(/^\s*\*\*[^*]+\*\*\s*/, '')
        .trim();
      return {
        taskType: 3 as const,
        index: u.num,
        title: `제3유형 ${u.num}번`,
        prompt: prompt || `제3유형 ${u.num}번`,
        code: codeBlock?.code || '',
        fence: codeBlock?.fence || '',
      };
    });
  }

  // Fallback: top-level "1." / "2." items (common in 6·8회 notes)
  const nums: Array<{ n: number; index: number; line: string }> = [];
  const numRe = /(?:^|\n)(\d+)\.\s+([^\n]+)/g;
  let nm: RegExpExecArray | null;
  while ((nm = numRe.exec(body))) {
    const n = Number(nm[1]);
    if (n >= 1 && n <= 2) {
      nums.push({
        n,
        index: nm.index + (nm[0].startsWith('\n') ? 1 : 0),
        line: nm[2],
      });
    }
  }
  const firstByN = new Map<number, (typeof nums)[0]>();
  for (const item of nums) {
    if (!firstByN.has(item.n)) firstByN.set(item.n, item);
  }
  if (firstByN.size >= 2) {
    const ordered = [...firstByN.values()].sort((a, b) => a.index - b.index);
    return ordered.map((item, i) => {
      const end = i + 1 < ordered.length ? ordered[i + 1].index : body.length;
      const slice = body.slice(item.index, end);
      const codeBlock = extractCodeBlocks(slice)[0];
      return {
        taskType: 3 as const,
        index: item.n,
        title: `제3유형 ${item.n}번`,
        prompt: slice.replace(/```[\s\S]*?```/g, '').trim() || item.line,
        code: codeBlock?.code || '',
        fence: codeBlock?.fence || '',
      };
    });
  }

  const codeBlock = extractCodeBlocks(body)[0];
  const prompt = body.replace(/```[\s\S]*?```/g, '').trim().slice(0, 4000);
  return [
    {
      taskType: 3,
      index: 1,
      title: '제3유형',
      prompt: prompt || '제3유형',
      code: codeBlock?.code || '',
      fence: codeBlock?.fence || '',
    },
  ];
}

function parseRound(round: number, md: string): ParsedBlock[] {
  const sections = splitTaskSections(md);
  const problems: ParsedBlock[] = [];
  for (const sec of sections) {
    if (sec.taskType === 1) {
      problems.push(...parseType1Problems(sec.body));
    } else {
      problems.push(...parseType23Problems(sec.taskType, sec.body));
    }
  }
  return problems;
}

function resolveCsvKey(
  ref: string,
  round: number,
  csvMap: Map<string, string>,
): string | null {
  const norm = ref.replace(/\\/g, '/').replace(/^\.\//, '');
  if (csvMap.has(norm)) return norm.startsWith('part4/') ? norm.slice(6) : norm;
  if (csvMap.has(`part4/${norm}`)) return norm;
  const base = path.basename(norm);
  const chKey = `ch${round}/${base}`;
  if (csvMap.has(chKey)) return chKey;
  if (csvMap.has(`part4/${chKey}`)) return chKey;
  for (const key of csvMap.keys()) {
    if (key.startsWith('part4/')) continue;
    if (key.endsWith(`/${base}`) && key.startsWith(`ch${round}/`)) return key;
  }
  return null;
}

async function buildProject(
  srcDir: string,
  codesDir: string,
  csvMap: Map<string, string>,
): Promise<AuthoringProject> {
  const now = new Date().toISOString();
  const assets: ProjectAsset[] = [];
  const assetIdByKey = new Map<string, string>();
  /** alias → runtime mount `data/<basename>` (matches mountPathForAsset). */
  const pathMapGlobal = new Map<string, string>();

  const ensureAsset = (csvKey: string): string => {
    const key = csvKey.replace(/^part4\//, '');
    const existing = assetIdByKey.get(key);
    if (existing) return existing;
    const content = csvMap.get(key) ?? csvMap.get(`part4/${key}`);
    if (content == null) throw new Error(`missing csv ${key}`);
    const round = key.match(/^ch(\d+)\//i)?.[1] ?? 'x';
    const base = path.basename(key);
    const id = `asset-ch${round}-${base.replace(/\W+/g, '-').slice(0, 40)}`;
    const mount = `data/${base}`;
    assets.push({
      id,
      path: `data/ch${round}/${base}`,
      name: base,
      encoding: 'utf-8',
      content,
      mimeType: 'text/csv',
    });
    assetIdByKey.set(key, id);
    pathMapGlobal.set(key, mount);
    pathMapGlobal.set(`part4/${key}`, mount);
    pathMapGlobal.set(base, mount);
    pathMapGlobal.set(`data/${base}`, mount);
    return id;
  };

  // Preload every codes/chN csv once
  for (const rel of csvMap.keys()) {
    if (rel.startsWith('part4/')) continue;
    ensureAsset(rel);
  }

  const bank: BankProblem[] = [];
  const exams: ExamBlueprint[] = [];
  const rounds = [...CODE_ROUNDS, ...EXTRA_ROUNDS];

  // Cache ipynb csv order / answer per round+type
  const ipynbCache = new Map<
    string,
    { code: string; csvOrder: string[] }
  >();
  const ipynbFor = async (round: number, taskType: 1 | 2 | 3) => {
    const k = `${round}:${taskType}`;
    let hit = ipynbCache.get(k);
    if (!hit) {
      hit = await loadIpynbAnswer(codesDir, round, taskType);
      ipynbCache.set(k, hit);
    }
    return hit;
  };

  for (const round of rounds) {
    const mdPath = path.join(srcDir, `${round}회_기출.md`);
    let md: string;
    try {
      md = await readFile(mdPath, 'utf8');
    } catch {
      console.warn(`missing markdown: ${mdPath}`);
      continue;
    }

    const parsed = parseRound(round, md);
    if (!parsed.length) {
      console.warn(`no problems parsed for ${round}회`);
      continue;
    }

    const problemIds: string[] = [];
    let t1 = 0;
    let t2 = 0;
    let t3 = 0;

    for (const p of parsed) {
      if (p.taskType === 1) t1 += 1;
      if (p.taskType === 2) t2 += 1;
      if (p.taskType === 3) t3 += 1;
      const seq =
        p.taskType === 1 ? t1 : p.taskType === 2 ? t2 : t3;

      const nb = await ipynbFor(round, p.taskType);
      const refs = extractCsvRefs(`${p.prompt}\n${p.code}\n${nb.code}`);
      const assetIds: string[] = [];
      const mountFiles: string[] = [];
      const localMap = new Map(pathMapGlobal);

      const attachBase = (baseName: string) => {
        const csvKey = resolveCsvKey(baseName, round, csvMap);
        if (!csvKey) return;
        const id = ensureAsset(csvKey);
        if (!assetIds.includes(id)) assetIds.push(id);
        const mount = pathMapGlobal.get(csvKey)!;
        if (!mountFiles.includes(mount)) mountFiles.push(mount);
        localMap.set(baseName, mount);
        localMap.set(path.basename(baseName), mount);
      };

      // Type1: notebook order — 문제 N ↔ Nth primary csv only
      if (p.taskType === 1 && nb.csvOrder.length) {
        const pick =
          nb.csvOrder[Math.min(seq - 1, nb.csvOrder.length - 1)] ??
          nb.csvOrder[0];
        if (pick) attachBase(pick);
      } else {
        for (const ref of refs) {
          const csvKey = resolveCsvKey(ref, round, csvMap);
          if (!csvKey) {
            console.warn(`  [${round}회] unresolved csv: ${ref}`);
            continue;
          }
          attachBase(path.basename(csvKey));
          localMap.set(ref, pathMapGlobal.get(csvKey)!);
        }
      }

      // Fallbacks by task type when still empty
      if (!assetIds.length && p.taskType === 1) {
        for (const rel of csvMap.keys()) {
          if (rel.startsWith('part4/')) continue;
          if (!rel.startsWith(`ch${round}/`)) continue;
          const base = path.basename(rel).toLowerCase();
          if (
            /^(x_|y_)?train\.csv$|^test\.csv$|^(x_|y_)?test\.csv$|_(train|test)\.csv$/.test(
              base,
            )
          ) {
            continue;
          }
          attachBase(path.basename(rel));
        }
        // If multiple attached via fallback, keep only seq-th
        if (mountFiles.length > 1) {
          const keep = mountFiles[Math.min(seq - 1, mountFiles.length - 1)];
          const keepBase = path.basename(keep);
          assetIds.length = 0;
          mountFiles.length = 0;
          attachBase(keepBase);
        }
      }
      if (!assetIds.length && p.taskType === 2) {
        for (const rel of csvMap.keys()) {
          if (rel.startsWith('part4/')) continue;
          if (!rel.startsWith(`ch${round}/`)) continue;
          const base = path.basename(rel).toLowerCase();
          if (/(train|test)/i.test(base)) attachBase(path.basename(rel));
        }
      }
      if (!assetIds.length && p.taskType === 3) {
        for (const rel of csvMap.keys()) {
          if (rel.startsWith('part4/')) continue;
          if (!rel.startsWith(`ch${round}/`)) continue;
          const base = path.basename(rel).toLowerCase();
          if (!/(train|test)/i.test(base)) attachBase(path.basename(rel));
        }
      }

      const answerSrc = (nb.code.trim() ? nb.code : p.code).trim();
      const lang = detectLang(answerSrc || p.code, p.fence);
      const rewritten = rewriteCodePaths(answerSrc || p.code, localMap);
      // Strip remote URL reads → local mounts when rewrite missed
      const localized = rewritten.replace(
        /(?:pd\.)?read_csv\(\s*["']https?:\/\/[^"']+\/([^/"']+\.csv)["']\s*\)/gi,
        (_m, file: string) => {
          const mount = pathMapGlobal.get(file) ?? `data/${file}`;
          return `pd.read_csv("${mount}")`;
        },
      );
      const mounts = [...new Set(mountFiles)];
      const starter = starterFor(p.taskType, mounts);

      const answerCode = emptyCode();
      if (lang === 'python') answerCode.python = localized;
      else answerCode.r = localized;

      const shorts = shortFieldsFor(p.taskType, answerCode, lang);

      const id = `gichul-r${round}-t${p.taskType}-q${seq}`;
      const markdown = [
        `## 제${p.taskType}유형 ${seq}번`,
        '',
        p.prompt.trim(),
        '',
        assetIds.length
          ? `제공 파일: ${mounts.map((f) => `\`${f}\``).join(', ')}`
          : '> 주의: 이 회차 CSV가 codes/ch 폴더에 없을 수 있습니다.',
      ].join('\n');

      bank.push({
        id,
        number: String(seq).padStart(2, '0'),
        title: `${round}회 · ${p.title}`,
        note: `문제복원 ${round}회 · codes/ch${round}`,
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

    exams.push({
      id: `exam-round-${round}`,
      title: `빅데이터분석기사 실기 제${round}회`,
      description: `codes/ch${round} · 문제복원`,
      timeLimitMinutes: 180,
      maxRunSeconds: 60,
      problemIds,
      createdAt: now,
      updatedAt: now,
    });
    console.log(
      `round ${round}: ${problemIds.length} problems, exam ready`,
    );
  }

  if (!exams.length) {
    throw new Error('No exams built — check GICHUL_SRC_DIR and markdown files');
  }

  return {
    schemaVersion: 1,
    kind: 'project',
    id: 'bigdata-gichul-restore',
    title: '빅데이터분석기사 실기 기출 (문제복원)',
    description:
      'Local-only package: 문제복원 markdown + codes/chN CSVs. Do not publish.',
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

  const srcDir = DEFAULT_SRC_DIR;
  const codesDir = path.join(srcDir, 'codes');
  console.log(`SRC dir: ${srcDir}`);
  console.log(`CODES dir: ${codesDir}`);
  const files = await readdir(srcDir).catch(() => {
    throw new Error(`Cannot read 문제복원 dir: ${srcDir}`);
  });
  console.log(
    `found md: ${files.filter((f) => f.endsWith('.md')).join(', ')}`,
  );

  console.log('loading CSVs from codes/chN…');
  const csvMap = await loadLocalCsvMap(codesDir);
  const csvCount = [...csvMap.keys()].filter((k) => !k.startsWith('part4/'))
    .length;
  console.log(`csv count: ${csvCount}`);

  const project = await buildProject(srcDir, codesDir, csvMap);
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
