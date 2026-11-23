import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ImagePlus, Send, X } from 'lucide-react';

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** data: URL for preview + vision API */
  dataUrl: string;
}

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  attachments: ChatAttachment[];
  onAttachmentsChange: (next: ChatAttachment[]) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  submitLabel?: string;
  /** When false, hide the image attach control (default true). */
  allowImages?: boolean;
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/gif,image/webp';

async function filesToAttachments(files: FileList | File[]): Promise<ChatAttachment[]> {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
  const out: ChatAttachment[] = [];
  for (const file of list) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
    if (!dataUrl) continue;
    out.push({
      id: `img-${crypto.randomUUID().slice(0, 8)}`,
      name: file.name,
      mimeType: file.type || 'image/png',
      dataUrl,
    });
  }
  return out;
}

/**
 * Chat textarea: auto-grows with field-sizing (grid fallback),
 * Enter sends (IME-safe), Shift+Enter inserts a newline, images attachable.
 */
export function ChatComposer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  onSubmit,
  disabled,
  placeholder = '메시지를 입력하세요',
  submitLabel = '전송',
  allowImages = true,
}: ChatComposerProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [supportsFieldSizing, setSupportsFieldSizing] = useState(true);

  useEffect(() => {
    setSupportsFieldSizing(
      typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content'),
    );
  }, []);

  useEffect(() => {
    if (supportsFieldSizing || !wrapRef.current) return;
    wrapRef.current.dataset.replicatedValue = value;
  }, [value, supportsFieldSizing]);

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const next = await filesToAttachments(files);
    if (!next.length) return;
    onAttachmentsChange([...attachments, ...next]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    // IME confirm uses Enter; do not submit while composing (Safari: keyCode 229).
    const native = e.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    if (disabled) return;
    if (!value.trim() && !attachments.length) return;
    onSubmit();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (!value.trim() && !attachments.length) return;
    onSubmit();
  };

  const canSend = !disabled && (Boolean(value.trim()) || attachments.length > 0);

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      {attachments.length ? (
        <ul className="chat-composer__thumbs" aria-label="첨부 이미지">
          {attachments.map((a) => (
            <li key={a.id} className="chat-composer__thumb">
              <img src={a.dataUrl} alt={a.name} />
              <button
                type="button"
                className="chat-composer__thumb-remove"
                aria-label={`${a.name} 제거`}
                disabled={disabled}
                onClick={() =>
                  onAttachmentsChange(attachments.filter((x) => x.id !== a.id))
                }
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        ref={wrapRef}
        className={
          supportsFieldSizing
            ? 'chat-composer__grow'
            : 'chat-composer__grow chat-composer__grow--fallback'
        }
        data-replicated-value={supportsFieldSizing ? undefined : value}
      >
        <label htmlFor={inputId} className="visually-hidden">
          메시지
        </label>
        <textarea
          id={inputId}
          className="chat-composer__input"
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          enterKeyHint="send"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const items = e.clipboardData?.files;
            if (items?.length) {
              void addFiles(items);
            }
          }}
        />
      </div>

      <div className="chat-composer__actions">
        {allowImages ? (
          <>
            <input
              ref={fileRef}
              className="hidden-file"
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={14} />
              이미지
            </button>
          </>
        ) : null}
        <button
          type="submit"
          className="primary-btn btn-with-icon"
          disabled={!canSend}
        >
          <Send size={14} />
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
