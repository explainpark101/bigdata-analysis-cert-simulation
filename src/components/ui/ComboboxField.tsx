import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxFieldProps {
  label: string;
  value: string;
  options: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Text input + suggestion list (ARIA combobox).
 * Choosing an option fills the input; free text is always allowed.
 */
export function ComboboxField({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: ComboboxFieldProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputId = `${uid}-input`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [filtered.length, value]);

  const pick = (opt: ComboboxOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  return (
    <div className="ce-combobox" ref={rootRef}>
      <label className="screen-settings-field" htmlFor={inputId}>
        <span>{label}</span>
        <div className="ce-combobox__control">
          <input
            id={inputId}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              open && filtered[active] ? `${uid}-opt-${active}` : undefined
            }
            disabled={disabled}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && open && filtered[active]) {
                e.preventDefault();
                pick(filtered[active]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            className="ce-combobox__toggle"
            tabIndex={-1}
            disabled={disabled}
            aria-label="제안 목록"
            onClick={() => setOpen((v) => !v)}
          >
            ▾
          </button>
        </div>
      </label>
      {open && filtered.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="ce-combobox__list"
        >
          {filtered.map((opt, i) => (
            <li
              key={`${opt.value}-${opt.label}`}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={
                i === active
                  ? 'ce-combobox__option ce-combobox__option--active'
                  : 'ce-combobox__option'
              }
              onMouseDown={(e) => {
                e.preventDefault();
                pick(opt);
              }}
            >
              <strong>{opt.label}</strong>
              <span>{opt.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
