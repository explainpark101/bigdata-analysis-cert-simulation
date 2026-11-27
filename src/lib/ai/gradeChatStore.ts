import { idbGet, idbSet } from '@/lib/idb';
import type { ChatMessage } from '@/lib/ai/openaiCompatible';

export interface GradeChatSession {
  quizId: string;
  messages: ChatMessage[];
  updatedAt: string;
}

type GradeChatMap = Record<string, GradeChatSession>;

export async function loadGradeChatMap(): Promise<GradeChatMap> {
  try {
    const raw = await idbGet<GradeChatMap>('gradeChats');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export async function loadGradeSession(
  quizId: string,
): Promise<GradeChatSession | null> {
  const map = await loadGradeChatMap();
  return map[quizId] ?? null;
}

export async function saveGradeSession(
  session: GradeChatSession,
): Promise<void> {
  const map = await loadGradeChatMap();
  map[session.quizId] = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
  await idbSet('gradeChats', map);
}

export async function clearGradeSession(quizId: string): Promise<void> {
  const map = await loadGradeChatMap();
  delete map[quizId];
  await idbSet('gradeChats', map);
}
