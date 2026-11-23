import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}

/**
 * Custom listbox select (no native select) so OS pickers cannot
 * steal focus or dismiss a parent modal mid-interaction.
 */
export function SelectField({
  label,
  value,
  options,
  disabled,
  placeholder = '선택…',
  onChange,
}: SelectFieldProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const buttonId = `${uid}-btn`;
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

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const placeList = () => {
    const trigger = rootRef.current?.querySelector('button');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 8;
    const spaceAbove = rect.top - gap - 8;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(240, openUp ? spaceAbove : spaceBelow));
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node) &&
          !listRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    setActive(idx);
  }, [open, options, value]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onCollapse = () => setOpen(false);
    root.addEventListener('ce-collapse', onCollapse);
    return () => root.removeEventListener('ce-collapse', onCollapse);
  }, []);

  const pick = (opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  return (
    <div
      className="ce-select-field"
      ref={rootRef}
      data-ce-expanded={open ? 'true' : 'false'}
    >
      <span className="screen-settings-field" id={`${uid}-label`}>
        <span>{label}</span>
        <button
          type="button"
          id={buttonId}
          className="ce-select-field__trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={`${uid}-label ${buttonId}`}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(true);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <span className={selected ? undefined : 'ce-select-field__placeholder'}>
            {selected?.label ?? placeholder}
          </span>
          <span aria-hidden="true">▾</span>
        </button>
      </span>
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
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && options[active]) {
              e.preventDefault();
              pick(options[active]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {options.map((opt, i) => (
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
          ))}
        </ul>
      ) : null}
    </div>
  );
}
