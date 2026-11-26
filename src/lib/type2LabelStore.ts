import { ensureIdbReady, idbGet, idbSet } from '@/lib/idb';
import { TYPE2_LABEL_BASENAME } from '@/lib/type2Assets';
import type { ExamAsset } from '@/types/exam';

export interface Type2LabelRecord {
  problemId: string;
  csv: string;
  source: string;
  name: string;
  at: number;
}

/** problemId (bank/quiz id) → persisted grading label CSV */
export type Type2LabelsMap = Record<string, Type2LabelRecord>;

async function loadMap(): Promise<Type2LabelsMap> {
  await ensureIdbReady();
  const map = await idbGet<Type2LabelsMap>('type2Labels');
  return map && typeof map === 'object' ? map : {};
}

async function saveMap(map: Type2LabelsMap): Promise<void> {
  await ensureIdbReady();
  await idbSet('type2Labels', map);
}

/** Persist a synthesized / AI test_label for a problem (survives re-grade). */
export async function saveType2Label(opts: {
  problemId: string;
  csv: string;
  source: string;
  name?: string;
}): Promise<Type2LabelRecord> {
  const record: Type2LabelRecord = {
    problemId: opts.problemId,
    csv: opts.csv,
    source: opts.source,
    name: opts.name || TYPE2_LABEL_BASENAME,
    at: Date.now(),
  };
  const map = await loadMap();
  map[opts.problemId] = record;
  await saveMap(map);
  return record;
}

export async function loadType2Label(
  problemId: string,
): Promise<Type2LabelRecord | undefined> {
  const map = await loadMap();
  return map[problemId];
}

export function type2LabelRecordToAsset(
  record: Type2LabelRecord,
): ExamAsset {
  const name = record.name || TYPE2_LABEL_BASENAME;
  return {
    path: `data/${name}`,
    name,
    encoding: 'utf-8',
    content: record.csv,
    mimeType: 'text/csv',
  };
}
