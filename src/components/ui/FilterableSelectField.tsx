import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SelectOption } from '@/components/ui/SelectField';

interface FilterableSelectFieldProps {
  label: string;
  /** Currently selected value (highlight only; search query is independent). */
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyHint?: string;
  hint?: string;
  onChange: (value: string) => void;
}

/**
 * Dropdown for picking from a list: trigger shows the pick action,
 * search filters the list only and does not rewrite the selected value
 * until the user chooses an option.
 */
export function FilterableSelectField({
  label,
  value,
  options,
  disabled,
  placeholder = '목록에서 선택…',
  searchPlaceholder = '목록 검색…',
  emptyHint = '옵션 없음',
  hint,
  onChange,
}: FilterableSelectFieldProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const buttonId = `${uid}-btn`;
  const searchId = `${uid}-search`;
  const hintId = hint ? `${uid}-hint` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.description?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  const placeList = () => {
    const trigger = rootRef.current?.querySelector('button');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, Math.min(280, openUp ? spaceAbove : spaceBelow));
    setCoords({
      top: openUp ? rect.top - gap - maxHeight : rect.bottom + gap,
      left: rect.left,
      width: Math.max(rect.width, 240),
      maxHeight,
    });
  };

  useEffect(() => {
    if (!open) return;
    placeList();
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    const onReposition = () => placeList();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [filtered.length, query]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onCollapse = () => {
      setOpen(false);
      setQuery('');
    };
    root.addEventListener('ce-collapse', onCollapse);
    return () => root.removeEventListener('ce-collapse', onCollapse);
  }, []);

  const pick = (opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <div
      className="ce-select-field ce-filter-select"
      ref={rootRef}
      data-ce-expanded={open ? 'true' : 'false'}
    >
      <span className="screen-settings-field" id={`${uid}-label`}>
        <span>{label}</span>
        {hint ? (
          <span id={hintId} className="ce-field__hint">
            {hint}
          </span>
        ) : null}
        <button
          type="button"
          id={buttonId}
          className="ce-select-field__trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-describedby={hintId}
          aria-labelledby={`${uid}-label ${buttonId}`}
          onClick={() =>
            setOpen((v) => {
              if (v) setQuery('');
              return !v;
            })
          }
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setQuery('');
            }
          }}
        >
          <span className="ce-select-field__placeholder">
            {placeholder}
            {selectedLabel ? ` · 현재: ${selectedLabel}` : null}
          </span>
          <span aria-hidden="true">▾</span>
        </button>
      </span>

      {open && coords ? (
        <div
          ref={panelRef}
          data-ce-overlay=""
          className="ce-filter-select__panel ce-combobox__list--fixed"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
          }}
        >
          <label className="ce-filter-select__search" htmlFor={searchId}>
            <span className="visually-hidden">목록 검색</span>
            <input
              ref={searchRef}
              id={searchId}
              className="ce-field__input"
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((i) =>
                    Math.min(i + 1, Math.max(0, filtered.length - 1)),
                  );
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter' && filtered[active]) {
                  e.preventDefault();
                  pick(filtered[active]);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  setQuery('');
                }
              }}
            />
          </label>
          <ul
            id={listId}
            role="listbox"
            className="ce-filter-select__list"
            aria-label={label}
          >
            {filtered.length === 0 ? (
              <li className="ce-combobox__empty" role="presentation">
                {emptyHint}
              </li>
            ) : (
              filtered.map((opt, i) => (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={opt.value === value}
                  className={
                    i === active
                      ? 'ce-combobox__option ce-combobox__option--active'
                      : 'ce-combobox__option'
                  }
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    pick(opt);
                  }}
                >
                  <strong>{opt.label}</strong>
                  {opt.description ? <span>{opt.description}</span> : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
