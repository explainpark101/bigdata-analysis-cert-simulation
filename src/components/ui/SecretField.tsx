import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface SecretFieldProps {
  label: string;
  value: string;
  hint?: string;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  optional?: boolean;
  onChange: (value: string) => void;
}

/**
 * Masked credential field with an accessible reveal toggle.
 * Paste is allowed; value is never required by the control itself.
 */
export function SecretField({
  label,
  value,
  hint,
  placeholder,
  disabled,
  name,
  optional = true,
  onChange,
}: SecretFieldProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const hintId = `${uid}-hint`;
  const warnId = `${uid}-warn`;
  const [revealed, setRevealed] = useState(false);

  const hintText =
    hint ??
    (optional
      ? '선택 사항 — 키가 필요 없는 로컬 서버는 비워 두세요'
      : undefined);

  return (
    <div className="ce-field ce-secret-field">
      <label className="screen-settings-field" htmlFor={inputId}>
        <span className="ce-field__label-row">
          <span>{label}</span>
          {optional ? (
            <span className="ce-field__optional">선택</span>
          ) : null}
        </span>
        {hintText ? (
          <span id={hintId} className="ce-field__hint">
            {hintText}
          </span>
        ) : null}
        <div className="ce-combobox__control">
          <input
            id={inputId}
            name={name}
            className="ce-field__input"
            type={revealed ? 'text' : 'password'}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={[hintId, warnId].filter(Boolean).join(' ')}
            onChange={(e) => onChange(e.target.value)}
          />
          <button
            type="button"
            className="ce-combobox__toggle ce-secret-field__toggle"
            disabled={disabled}
            aria-pressed={revealed}
            aria-label={revealed ? 'API Key 숨기기' : 'API Key 표시'}
            aria-describedby={warnId}
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
          </button>
        </div>
      </label>
      <span id={warnId} className="visually-hidden">
        주의: 표시하면 화면에 키가 보입니다.
      </span>
    </div>
  );
}
