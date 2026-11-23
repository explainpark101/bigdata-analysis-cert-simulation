import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Save, Sparkles } from 'lucide-react';
import { loadAiSettings } from '@/lib/aiSettings';
import { runAuthorAgentTurn } from '@/lib/ai/authorAgent';
import {
  chatContentToText,
  type ChatMessage,
} from '@/lib/ai/openaiCompatible';
import {
  clearAuthorSession,
  emptyAuthorDraft,
  loadAuthorSession,
  saveAuthorSession,
  type AuthorDraft,
} from '@/lib/ai/authorChatStore';
import type { AuthoringProject, BankProblem, ProjectAsset } from '@/types/project';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import {
  ChatComposer,
  type ChatAttachment,
} from '@/components/ui/ChatComposer';

interface AuthorChatDockProps {
  project: AuthoringProject;
  referenceIds: string[];
  onReferenceIdsChange?: (ids: string[]) => void;
  draft: AuthorDraft;
  onDraftChange: (draft: AuthorDraft) => void;
  width: number;
  onWidthChange: (w: number) => void;
  maxWidth: number;
  addProjectAssets: (assets: ProjectAsset[]) => ProjectAsset[];
  onSaveProblem: (partial: Partial<BankProblem>) => BankProblem;
  onSaved: (problem: BankProblem) => void;
}

function visibleContent(m: ChatMessage): string {
  if (m.role === 'assistant') {
    const parts: string[] = [];
    const text = chatContentToText(m.content).trim();
    if (text) parts.push(text);
    if (m.tool_calls?.length) {
      parts.push(
        `⟪tools: ${m.tool_calls.map((t) => t.function.name).join(', ')}⟫`,
      );
    }
    return parts.join('\n') || '(…)';
  }
  if (m.role === 'user') {
    const text = chatContentToText(m.content);
    const images =
      Array.isArray(m.content)
        ? m.content.filter((p) => p.type === 'image_url').length
        : 0;
    if (images && text) return `${text}\n⟪이미지 ${images}개⟫`;
    if (images) return `⟪이미지 ${images}개⟫`;
    return text;
  }
  if (m.role === 'tool') {
    const raw = chatContentToText(m.content);
    return raw.length > 280 ? `${raw.slice(0, 280)}…` : raw;
  }
  return '';
}

export function AuthorChatDock({
  project,
  referenceIds,
  onReferenceIdsChange,
  draft,
  onDraftChange,
  width,
  onWidthChange,
  maxWidth,
  addProjectAssets,
  onSaveProblem,
  onSaved,
}: AuthorChatDockProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadAuthorSession(project.id);
      if (cancelled) return;
      if (stored) {
        setMessages(stored.messages);
        onDraftChange(stored.draft);
        onReferenceIdsChange?.(stored.referenceIds ?? []);
      } else {
        setMessages([]);
        onDraftChange(emptyAuthorDraft(1));
      }
      setError('');
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Load once per project id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (!ready) return;
    void saveAuthorSession({
      projectId: project.id,
      referenceIds,
      messages,
      draft,
      updatedAt: new Date().toISOString(),
    });
  }, [ready, project.id, referenceIds, messages, draft]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const hint = useMemo(() => {
    const n = referenceIds.length;
    const web =
      '필요하면 웹 검색·문서 조회(web_search / fetch_url)로 자료를 가져옵니다.';
    return n
      ? `참고 문제 ${n}개 선택 · ${web}`
      : `좌측에서 참고 문제를 고르거나, 새 문항 아이디어를 말해 주세요. ${web}`;
  }, [referenceIds.length]);

  const send = async (overrideText?: string) => {
    const trimmed = (overrideText ?? input).trim();
    const images =
      overrideText != null
        ? []
        : attachments.map((a) => ({
            dataUrl: a.dataUrl,
            name: a.name,
          }));
    if ((!trimmed && !images.length) || busy) return;
    setBusy(true);
    setError('');
    if (overrideText == null) {
      setInput('');
      setAttachments([]);
    }
    try {
      const settings = await loadAiSettings();
      const result = await runAuthorAgentTurn({
        ctx: {
          settings,
          project,
          draft: draftRef.current,
          referenceIds,
          addProjectAssets,
        },
        history: messages,
        userText: trimmed || (images.length ? '첨부 이미지를 참고해 주세요.' : ''),
        userImages: images,
        onDraft: onDraftChange,
        onSave: onSaveProblem,
      });
      setMessages(result.messages);
      onDraftChange(result.draft);
      if (result.savedProblem) {
        onSaved(result.savedProblem);
        await clearAuthorSession(project.id);
        setMessages([]);
        onDraftChange(emptyAuthorDraft(result.draft.taskType));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="variant-dock author-dock" style={{ width }} aria-label="문제 제작 AI">
      <div className="variant-dock__inner">
        <header className="variant-dock__head">
          <div>
            <strong className="variant-dock__title">
              <Sparkles size={14} aria-hidden />
              문제 제작 채팅
            </strong>
            <p className="variant-dock__sub">{hint}</p>
          </div>
        </header>

        <div className="variant-dock__draft">
          <div className="variant-dock__draft-title">{draft.title}</div>
          <div className="variant-dock__draft-meta">
            제{draft.taskType}유형 · assets {draft.assetIds.length}
            {draft.taskType !== 2
              ? ` · 단답 ${draft.shortAnswers.filter((s) => s.trim()).length}`
              : draft.datasetCode.trim()
                ? ' · dataset code'
                : ''}
          </div>
        </div>

        <div className="variant-dock__messages">
          {!messages.filter((m) => m.role === 'user' || m.role === 'assistant')
            .length ? (
            <p className="variant-dock__empty">
              예: &quot;참고 1유형처럼 결측 처리 후 중앙값을 묻는 새 문항 만들어줘&quot;
              / 이미지를 첨부해 표·그래프를 설명할 수도 있습니다.
            </p>
          ) : (
            messages
              .filter(
                (m) =>
                  m.role === 'user' ||
                  m.role === 'assistant' ||
                  m.role === 'tool',
              )
              .map((m, i) => (
                <div
                  key={`${m.role}-${i}`}
                  className={`variant-msg variant-msg--${m.role}`}
                >
                  <span className="variant-msg__role">
                    {m.role === 'user'
                      ? '나'
                      : m.role === 'assistant'
                        ? 'Agent'
                        : 'Tool'}
                  </span>
                  <pre className="variant-msg__body">{visibleContent(m)}</pre>
                  {m.role === 'user' && Array.isArray(m.content)
                    ? m.content
                        .filter((p) => p.type === 'image_url')
                        .map((p, j) =>
                          p.type === 'image_url' ? (
                            <img
                              key={j}
                              className="author-dock__msg-image"
                              src={p.image_url.url}
                              alt=""
                            />
                          ) : null,
                        )
                    : null}
                </div>
              ))
          )}
          {busy ? (
            <div className="variant-dock__busy">
              <Loader2 size={14} className="spin" />
              에이전트 작업 중…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        {error ? (
          <p className="variant-dock__error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="variant-dock__foot">
          <ChatComposer
            value={input}
            onChange={setInput}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSubmit={() => void send()}
            disabled={busy}
            placeholder="Enter 전송 · Shift+Enter 줄바꿈 · 이미지 첨부 가능"
          />
          <div className="variant-dock__actions">
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={busy}
              onClick={() =>
                void send(
                  '초안을 검토하고 save_problem(confirm=true)로 문제은행에 저장해 주세요.',
                )
              }
            >
              <Save size={14} />
              저장 요청
            </button>
          </div>
        </footer>
      </div>
      <EdgeResizeHandle
        axis="x"
        value={width}
        onChange={onWidthChange}
        min={280}
        max={maxWidth}
        invert
        label="문제 제작 채팅 Dock 너비 조절"
      />
    </aside>
  );
}
