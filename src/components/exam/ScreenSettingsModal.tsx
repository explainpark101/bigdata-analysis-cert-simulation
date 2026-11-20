import { useEffect } from 'react';
import { X } from 'lucide-react';
import {
  CONTENT_ZOOM_OPTIONS,
  EDITOR_FONT_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  type ExamIndentUnit,
  type ExamKeymap,
  type ExamEditorTheme,
  type ExamUiSettings,
} from '@/lib/examUiSettings';

interface ScreenSettingsModalProps {
  open: boolean;
  value: ExamUiSettings;
  onClose: () => void;
  /** Called on every change — settings apply immediately (no Apply button). */
  onChange: (next: ExamUiSettings) => void;
}

function SelectList<T extends number | string>({
  options,
  value,
  onChange,
  format = String,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div className="screen-settings__list" role="listbox">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          role="option"
          aria-selected={opt === value}
          className={`screen-settings__list-item ${opt === value ? 'active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {format(opt)}
        </button>
      ))}
    </div>
  );
}

export function ScreenSettingsModal({
  open,
  value,
  onClose,
  onChange,
}: ScreenSettingsModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (p: Partial<ExamUiSettings>) => {
    onChange({ ...value, ...p });
  };

  return (
    <div className="screen-settings-backdrop" role="presentation" onClick={onClose}>
      <div
        className="screen-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="screen-settings-modal__head">
          <h2 id="screen-settings-title">화면설정</h2>
          <button
            type="button"
            className="icon-btn screen-settings-modal__close"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="screen-settings-modal__body">
          <section className="screen-settings-col">
            <h3>컨텐츠 영역</h3>
            <label className="screen-settings-field">
              <span>줄 간격</span>
              <select
                value={value.contentLineHeightPct}
                onChange={(e) =>
                  patch({ contentLineHeightPct: Number(e.target.value) })
                }
              >
                {LINE_HEIGHT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
            <div className="screen-settings-field">
              <span>확대/축소(%)</span>
              <SelectList
                options={CONTENT_ZOOM_OPTIONS}
                value={
                  CONTENT_ZOOM_OPTIONS.includes(
                    value.contentZoomPct as (typeof CONTENT_ZOOM_OPTIONS)[number],
                  )
                    ? (value.contentZoomPct as (typeof CONTENT_ZOOM_OPTIONS)[number])
                    : 100
                }
                onChange={(v) => patch({ contentZoomPct: v })}
              />
            </div>
          </section>

          <section className="screen-settings-col">
            <h3>에디터 영역</h3>
            <label className="screen-settings-field">
              <span>줄 간격 (기본 150%)</span>
              <select
                value={value.editorLineHeightPct}
                onChange={(e) =>
                  patch({ editorLineHeightPct: Number(e.target.value) })
                }
              >
                {LINE_HEIGHT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
            <div className="screen-settings-field">
              <span>글자크기</span>
              <SelectList
                options={EDITOR_FONT_OPTIONS}
                value={
                  EDITOR_FONT_OPTIONS.includes(
                    value.editorFontSize as (typeof EDITOR_FONT_OPTIONS)[number],
                  )
                    ? (value.editorFontSize as (typeof EDITOR_FONT_OPTIONS)[number])
                    : 14
                }
                onChange={(v) => patch({ editorFontSize: v })}
              />
            </div>
            <label className="screen-settings-field">
              <span>화면 모드</span>
              <select
                value={value.editorTheme}
                onChange={(e) =>
                  patch({ editorTheme: e.target.value as ExamEditorTheme })
                }
              >
                <option value="dark">다크 모드</option>
                <option value="light">라이트 모드</option>
              </select>
            </label>
            <label className="screen-settings-field">
              <span>단축키맵</span>
              <select
                value={value.editorKeymap}
                onChange={(e) =>
                  patch({ editorKeymap: e.target.value as ExamKeymap })
                }
              >
                <option value="sublime">Sublime Text</option>
                <option value="default">Default</option>
                <option value="vim">Vim</option>
                <option value="emacs">Emacs</option>
              </select>
            </label>
            <label className="screen-settings-field">
              <span>인덴트 단위</span>
              <select
                value={value.indentUnit}
                onChange={(e) =>
                  patch({ indentUnit: e.target.value as ExamIndentUnit })
                }
              >
                <option value="tab">탭</option>
                <option value="space">스페이스</option>
              </select>
            </label>
            <label className="screen-settings-field">
              <span>탭 사이즈</span>
              <input
                type="number"
                className="screen-settings__number"
                min={0}
                step={1}
                value={value.tabSize}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    patch({ tabSize: 0 });
                    return;
                  }
                  const n = Number(raw);
                  if (!Number.isFinite(n)) return;
                  patch({ tabSize: Math.max(0, Math.floor(n)) });
                }}
              />
            </label>
          </section>
        </div>

        <footer className="screen-settings-modal__foot">
          <button type="button" className="primary-btn" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
