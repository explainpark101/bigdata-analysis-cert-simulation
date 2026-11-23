import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

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
  hint?: string;
  onChange: (value: string) => void;
}

/**
 * Text input + suggestion list (ARIA combobox).
 * Choosing an option fills the input; free text is always allowed.
 * List is fixed-positioned so parent modal overflow cannot clip or
 * mis-route clicks to a light-dismiss backdrop.
 */
export function ComboboxField({
  label,
  value,
  options,
  placeholder,
  disabled,
  hint,
  onChange,
}: ComboboxFieldProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputId = `${uid}-input`;
  const hintId = hint ? `${uid}-hint` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, value]);

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
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [filtered.length, value]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onCollapse = () => setOpen(false);
    root.addEventListener('ce-collapse', onCollapse);
    return () => root.removeEventListener('ce-collapse', onCollapse);
  }, []);

  const pick = (opt: ComboboxOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  const closeFromEscape = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  };

  return (
    <div
      className="ce-combobox"
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
                setActive((i) =>
                  Math.min(i + 1, Math.max(0, filtered.length - 1)),
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && open && filtered[active]) {
                e.preventDefault();
                pick(filtered[active]);
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
            aria-label="제안 목록"
            onClick={() => setOpen((v) => !v)}
          >
            ▾
          </button>
        </div>
      </label>
      {open && filtered.length > 0 && coords ? (
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
                e.stopPropagation();
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
