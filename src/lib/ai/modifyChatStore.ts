import { idbGet, idbSet } from '@/lib/idb';
import type { ChatMessage } from '@/lib/ai/openaiCompatible';
import {
  normalizeAuthorDraft,
  type AuthorDraft,
} from '@/lib/ai/authorChatStore';
import type { BankProblem } from '@/types/project';

export type ModifyDraft = AuthorDraft;

export interface ModifyChatSession {
  problemId: string;
  messages: ChatMessage[];
  draft: ModifyDraft;
  updatedAt: string;
}

type ModifyChatMap = Record<string, ModifyChatSession>;

/** Seed draft from the bank problem as-is (in-place edit). */
export function emptyModifyDraft(problem: BankProblem): ModifyDraft {
  const shorts =
    problem.shortAnswers?.length
      ? [...problem.shortAnswers]
      : problem.shortAnswer?.trim()
        ? [problem.shortAnswer.trim()]
        : [''];
  return normalizeAuthorDraft({
    title: problem.title,
    note: problem.note ?? '',
    taskType: problem.taskType,
    markdown: problem.markdown,
    language: problem.language === 'r' ? 'r' : 'python',
    answerCode: {
      python: problem.answerCode?.python ?? '',
      r: problem.answerCode?.r ?? '',
    },
    shortAnswers: shorts,
    gradingCode: {
      python: problem.gradingCode?.python ?? '',
      r: problem.gradingCode?.r ?? '',
    },
    datasetCode: problem.datasetCode ?? '',
    transformCode: { python: '', r: '' },
    assetIds: [...problem.assetIds],
  });
}

export const normalizeModifyDraft = normalizeAuthorDraft;

export async function loadModifyChatMap(): Promise<ModifyChatMap> {
  try {
    const raw = await idbGet<ModifyChatMap>('modifyChats');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export async function loadModifySession(
  problemId: string,
): Promise<ModifyChatSession | null> {
  const map = await loadModifyChatMap();
  return map[problemId] ?? null;
}

export async function saveModifySession(
  session: ModifyChatSession,
): Promise<void> {
  const map = await loadModifyChatMap();
  map[session.problemId] = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  await idbSet('modifyChats', map);
}

export async function clearModifySession(problemId: string): Promise<void> {
  const map = await loadModifyChatMap();
  delete map[problemId];
  await idbSet('modifyChats', map);
}
