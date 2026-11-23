import { useId, type InputHTMLAttributes } from 'react';

interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'id'> {
  label: string;
  value: string;
  hint?: string;
  onChange: (value: string) => void;
}

/** Labeled single-line text field used in settings forms. */
export function TextField({
  label,
  value,
  hint,
  onChange,
  className,
  disabled,
  name,
  ...rest
}: TextFieldProps) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const hintId = hint ? `${uid}-hint` : undefined;

  return (
    <div className={className ? `ce-field ${className}` : 'ce-field'}>
      <label className="screen-settings-field" htmlFor={inputId}>
        <span>{label}</span>
        {hint ? (
          <span id={hintId} className="ce-field__hint">
            {hint}
          </span>
        ) : null}
        <input
          id={inputId}
          name={name}
          className="ce-field__input"
          disabled={disabled}
          value={value}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      </label>
    </div>
  );
}
