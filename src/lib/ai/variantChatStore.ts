import { idbGet, idbSet } from '@/lib/idb';
import type { ChatMessage } from '@/lib/ai/openaiCompatible';
import type { CodeByLanguage } from '@/types/exam';

export interface VariantDraft {
  title: string;
  note: string;
  markdown: string;
  language: 'python' | 'r';
  answerCode: CodeByLanguage;
  shortAnswers: string[];
  gradingCode: CodeByLanguage;
  datasetCode: string;
  /** Mutate source CSVs → out/*.csv (type 2 alternative to datasetCode). */
  transformCode: CodeByLanguage;
  /** Newly generated asset ids attached to the draft (type 2) */
  assetIds: string[];
}

export interface VariantChatSession {
  sourceProblemId: string;
  messages: ChatMessage[];
  draft: VariantDraft;
  updatedAt: string;
}

type VariantChatMap = Record<string, VariantChatSession>;

export function emptyVariantDraft(
  source: {
    title: string;
    note?: string;
    markdown: string;
    language: 'python' | 'r';
    answerCode?: CodeByLanguage;
    shortAnswers?: string[];
    shortAnswer?: string;
    gradingCode?: CodeByLanguage;
    datasetCode?: string;
    assetIds: string[];
  },
): VariantDraft {
  const shorts =
    source.shortAnswers?.length
      ? [...source.shortAnswers]
      : source.shortAnswer?.trim()
        ? [source.shortAnswer.trim()]
        : [''];
  return {
    title: `${source.title} (변형)`,
    note: source.note ? `${source.note}\n(AI 변형)` : 'AI 변형',
    markdown: source.markdown,
    language: source.language,
    answerCode: {
      python: source.answerCode?.python ?? '',
      r: source.answerCode?.r ?? '',
    },
    shortAnswers: shorts,
    gradingCode: {
      python: source.gradingCode?.python ?? '',
      r: source.gradingCode?.r ?? '',
    },
    datasetCode: source.datasetCode ?? '',
    transformCode: { python: '', r: '' },
    assetIds: [...source.assetIds],
  };
}

export async function loadVariantChatMap(): Promise<VariantChatMap> {
  try {
    const raw = await idbGet<VariantChatMap>('variantChats');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function normalizeVariantDraft(draft: VariantDraft): VariantDraft {
  return {
    ...draft,
    answerCode: {
      python: draft.answerCode?.python ?? '',
      r: draft.answerCode?.r ?? '',
    },
    gradingCode: {
      python: draft.gradingCode?.python ?? '',
      r: draft.gradingCode?.r ?? '',
    },
    transformCode: {
      python: draft.transformCode?.python ?? '',
      r: draft.transformCode?.r ?? '',
    },
    datasetCode: draft.datasetCode ?? '',
    shortAnswers:
      draft.shortAnswers?.length > 0 ? [...draft.shortAnswers] : [''],
    assetIds: [...(draft.assetIds ?? [])],
  };
}

export async function loadVariantSession(
  sourceProblemId: string,
): Promise<VariantChatSession | null> {
  const map = await loadVariantChatMap();
  return map[sourceProblemId] ?? null;
}

export async function saveVariantSession(
  session: VariantChatSession,
): Promise<void> {
  const map = await loadVariantChatMap();
  map[session.sourceProblemId] = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  await idbSet('variantChats', map);
}

export async function clearVariantSession(
  sourceProblemId: string,
): Promise<void> {
  const map = await loadVariantChatMap();
  delete map[sourceProblemId];
  await idbSet('variantChats', map);
}
