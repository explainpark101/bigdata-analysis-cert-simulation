/**
 * Live AI chats for exam auto-review, keyed by problem id.
 * ModifyChatDock subscribes so batch review turns are visible on the bank tab.
 */

import type { ChatMessage } from '@/lib/ai/openaiCompatible';
import type { ModifyDraft } from '@/lib/ai/modifyChatStore';

export type AutoReviewChatSession = {
  problemId: string;
  examId: string;
  examTitle: string;
  messages: ChatMessage[];
  draft: ModifyDraft;
  busy: boolean;
  liveStatus: string;
  error: string;
  updatedAt: number;
};

type Listener = (session: AutoReviewChatSession | null) => void;

const sessions = new Map<string, AutoReviewChatSession>();
/** Listeners for a specific problemId, plus '*' for any change. */
const listeners = new Map<string, Set<Listener>>();

function emit(problemId: string, session: AutoReviewChatSession | null): void {
  const specific = listeners.get(problemId);
  if (specific) {
    for (const l of specific) l(session);
  }
  const all = listeners.get('*');
  if (all) {
    for (const l of all) l(session);
  }
}

export function getAutoReviewChat(
  problemId: string,
): AutoReviewChatSession | null {
  return sessions.get(problemId) ?? null;
}

export function listAutoReviewChats(): AutoReviewChatSession[] {
  return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isAutoReviewChatBusy(problemId: string): boolean {
  return Boolean(sessions.get(problemId)?.busy);
}

export function subscribeAutoReviewChat(
  problemId: string | '*',
  listener: Listener,
): () => void {
  let set = listeners.get(problemId);
  if (!set) {
    set = new Set();
    listeners.set(problemId, set);
  }
  set.add(listener);
  if (problemId !== '*') {
    listener(sessions.get(problemId) ?? null);
  }
  return () => {
    set!.delete(listener);
    if (!set!.size) listeners.delete(problemId);
  };
}

export function startAutoReviewChat(opts: {
  problemId: string;
  examId: string;
  examTitle: string;
  draft: ModifyDraft;
  messages?: ChatMessage[];
  liveStatus?: string;
}): AutoReviewChatSession {
  const session: AutoReviewChatSession = {
    problemId: opts.problemId,
    examId: opts.examId,
    examTitle: opts.examTitle,
    messages: opts.messages ?? [],
    draft: opts.draft,
    busy: true,
    liveStatus: opts.liveStatus ?? '자동 검수 시작…',
    error: '',
    updatedAt: Date.now(),
  };
  sessions.set(opts.problemId, session);
  emit(opts.problemId, session);
  return session;
}

export function patchAutoReviewChat(
  problemId: string,
  patch: Partial<
    Pick<
      AutoReviewChatSession,
      'messages' | 'draft' | 'busy' | 'liveStatus' | 'error'
    >
  >,
): AutoReviewChatSession | null {
  const prev = sessions.get(problemId);
  if (!prev) return null;
  const next: AutoReviewChatSession = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  };
  sessions.set(problemId, next);
  emit(problemId, next);
  return next;
}

export function finishAutoReviewChat(
  problemId: string,
  patch?: Partial<
    Pick<AutoReviewChatSession, 'messages' | 'draft' | 'liveStatus' | 'error'>
  >,
): void {
  const prev = sessions.get(problemId);
  if (!prev) return;
  const next: AutoReviewChatSession = {
    ...prev,
    ...patch,
    busy: false,
    liveStatus: patch?.liveStatus ?? '',
    updatedAt: Date.now(),
  };
  sessions.set(problemId, next);
  emit(problemId, next);
}

export function clearAutoReviewChat(problemId: string): void {
  if (!sessions.has(problemId)) return;
  sessions.delete(problemId);
  emit(problemId, null);
}

export function clearAutoReviewChatsForExam(examId: string): void {
  for (const [id, session] of [...sessions.entries()]) {
    if (session.examId !== examId) continue;
    sessions.delete(id);
    emit(id, null);
  }
}
