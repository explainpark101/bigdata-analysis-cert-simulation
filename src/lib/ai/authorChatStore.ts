import { idbGet, idbSet } from '@/lib/idb';
import type { ChatMessage } from '@/lib/ai/openaiCompatible';
import type { CodeByLanguage } from '@/types/exam';
import type { TaskType } from '@/types/project';

export interface AuthorDraft {
  title: string;
  note: string;
  taskType: TaskType;
  markdown: string;
  language: 'python' | 'r';
  answerCode: CodeByLanguage;
  shortAnswers: string[];
  gradingCode: CodeByLanguage;
  datasetCode: string;
  assetIds: string[];
}

export interface AuthorChatSession {
  projectId: string;
  referenceIds: string[];
  messages: ChatMessage[];
  draft: AuthorDraft;
  updatedAt: string;
}

type AuthorChatMap = Record<string, AuthorChatSession>;

export function emptyAuthorDraft(taskType: TaskType = 1): AuthorDraft {
  return {
    title: `제${taskType}유형 · 새 문제`,
    note: 'AI 문제 제작',
    taskType,
    markdown: '## 새 문제\n\n문제 내용을 작성하세요.\n',
    language: 'python',
    answerCode: { python: '', r: '' },
    shortAnswers: [''],
    gradingCode: { python: '', r: '' },
    datasetCode: '',
    assetIds: [],
  };
}

export async function loadAuthorSession(
  projectId: string,
): Promise<AuthorChatSession | null> {
  try {
    const map = (await idbGet<AuthorChatMap>('authorChats')) ?? {};
    return map[projectId] ?? null;
  } catch {
    return null;
  }
}

export async function saveAuthorSession(
  session: AuthorChatSession,
): Promise<void> {
  const map = (await idbGet<AuthorChatMap>('authorChats')) ?? {};
  map[session.projectId] = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  await idbSet('authorChats', map);
}

export async function clearAuthorSession(projectId: string): Promise<void> {
  const map = (await idbGet<AuthorChatMap>('authorChats')) ?? {};
  delete map[projectId];
  await idbSet('authorChats', map);
}
