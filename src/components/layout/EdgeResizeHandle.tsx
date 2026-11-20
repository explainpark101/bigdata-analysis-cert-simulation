import { useEdgeResize } from '@/hooks/useEdgeResize';

interface EdgeResizeHandleProps {
  axis: 'x' | 'y';
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  invert?: boolean;
  label: string;
}

/** Thin handle on a panel border only (no overlay chrome). */
export function EdgeResizeHandle({
  axis,
  value,
  onChange,
  min,
  max,
  invert,
  label,
}: EdgeResizeHandleProps) {
  const { onPointerDown } = useEdgeResize({
    axis,
    value,
    onChange,
    min,
    max,
    invert,
  });

  return (
    <div
      className={`edge-handle edge-handle--${axis}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 16;
        if (axis === 'x') {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onChange(Math.max(min, value - (invert ? -step : step)));
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            onChange(Math.min(max, value + (invert ? -step : step)));
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          onChange(Math.max(min, value - (invert ? -step : step)));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(Math.min(max, value + (invert ? -step : step)));
        }
      }}
    />
  );
}
