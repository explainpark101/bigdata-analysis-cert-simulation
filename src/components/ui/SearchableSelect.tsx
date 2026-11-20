import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface SearchableSelectProps {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  emptyHint?: string;
  onChange: (value: string) => void;
}

/**
 * Single searchable select: filter options, pick one, or keep typed custom value.
 */
export function SearchableSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  emptyHint = '옵션 없음 — 직접 입력하거나 /models 로 불러오세요',
  onChange,
}: SearchableSelectProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputId = `${uid}-input`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const uniq = [...new Set(options.map((o) => o.trim()).filter(Boolean))];
    if (!q) return uniq;
    return uniq.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        onChange(query.trim() || value);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onChange, query, value]);

  useEffect(() => {
    setActive(0);
  }, [filtered.length, query]);

  const commit = (next: string) => {
    const t = next.trim();
    onChange(t);
    setQuery(t);
    setOpen(false);
  };

  return (
    <div className="ce-search-select" ref={rootRef}>
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
            value={query}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              /* commit on outside click via mousedown handler */
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((i) =>
                  Math.min(i + 1, Math.max(0, filtered.length - 1)),
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (open && filtered[active]) commit(filtered[active]);
                else commit(query);
              } else if (e.key === 'Escape') {
                setOpen(false);
                setQuery(value);
              }
            }}
          />
          <button
            type="button"
            className="ce-combobox__toggle"
            tabIndex={-1}
            disabled={disabled}
            aria-label="모델 목록"
            onClick={() => setOpen((v) => !v)}
          >
            ▾
          </button>
        </div>
      </label>
      {open ? (
        <ul id={listId} role="listbox" className="ce-combobox__list">
          {filtered.length === 0 ? (
            <li className="ce-combobox__empty" role="presentation">
              {emptyHint}
            </li>
          ) : (
            filtered.map((opt, i) => (
              <li
                key={opt}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active || opt === value}
                className={
                  i === active
                    ? 'ce-combobox__option ce-combobox__option--active'
                    : 'ce-combobox__option'
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt);
                }}
              >
                {opt}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
