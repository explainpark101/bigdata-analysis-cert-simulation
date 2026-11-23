import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

interface SearchableSelectProps {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  emptyHint?: string;
  hint?: string;
  onChange: (value: string) => void;
}

/**
 * Single searchable select: filter options, pick one, or keep typed custom value.
 * Fixed overlay list avoids modal overflow clipping / accidental light dismiss.
 */
export function SearchableSelect({
  label,
  value,
  options,
  placeholder,
  disabled,
  emptyHint = '옵션 없음 — 직접 입력하거나 /models 로 불러오세요',
  hint,
  onChange,
}: SearchableSelectProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputId = `${uid}-input`;
  const hintId = hint ? `${uid}-hint` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [active, setActive] = useState(0);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const uniq = [...new Set(options.map((o) => o.trim()).filter(Boolean))];
    if (!q) return uniq;
    return uniq.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const placeList = () => {
    const control = rootRef.current?.querySelector('.ce-combobox__control');
    if (!control) return;
    const rect = control.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(220, openUp ? spaceAbove : spaceBelow));
    setCoords({
      top: openUp ? rect.top - gap - maxHeight : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  };

  useEffect(() => {
    if (!open) return;
    placeList();
    const onReposition = () => placeList();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, filtered.length, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) {
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

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onCollapse = () => {
      setOpen(false);
      setQuery(value);
    };
    root.addEventListener('ce-collapse', onCollapse);
    return () => root.removeEventListener('ce-collapse', onCollapse);
  }, [value]);

  const commit = (next: string) => {
    const t = next.trim();
    onChange(t);
    setQuery(t);
    setOpen(false);
  };

  const closeFromEscape = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    setQuery(value);
  };

  return (
    <div
      className="ce-search-select"
      ref={rootRef}
      data-ce-expanded={open ? 'true' : 'false'}
    >
      <label className="screen-settings-field" htmlFor={inputId}>
        <span>{label}</span>
        {hint ? (
          <span id={hintId} className="ce-field__hint">
            {hint}
          </span>
        ) : null}
        <div className="ce-combobox__control">
          <input
            id={inputId}
            className="ce-field__input"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-describedby={hintId}
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
              } else if (e.key === 'Escape' && open) {
                closeFromEscape(e);
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
      {open && coords ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          data-ce-overlay=""
          className="ce-combobox__list ce-combobox__list--fixed"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
          }}
        >
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
                  e.stopPropagation();
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
