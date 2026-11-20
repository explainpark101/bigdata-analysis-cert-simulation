import { useCallback, useEffect, useRef } from 'react';

type Axis = 'x' | 'y';

interface UseEdgeResizeOptions {
  axis: Axis;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  /** Invert drag direction (e.g. grow when dragging left/up) */
  invert?: boolean;
}

/**
 * Pointer-drag resize bound to an edge handle only.
 */
export function useEdgeResize({
  axis,
  value,
  onChange,
  min,
  max,
  invert = false,
}: UseEdgeResizeOptions) {
  const startRef = useRef({ pointer: 0, size: 0 });
  const dragging = useRef(false);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const pos = axis === 'x' ? e.clientX : e.clientY;
      const delta = pos - startRef.current.pointer;
      const signed = invert ? -delta : delta;
      const next = Math.min(max, Math.max(min, startRef.current.size + signed));
      onChange(next);
    },
    [axis, invert, max, min, onChange],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    document.body.classList.remove('is-resizing-x', 'is-resizing-y');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  useEffect(() => () => onPointerUp(), [onPointerUp]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      startRef.current = {
        pointer: axis === 'x' ? e.clientX : e.clientY,
        size: value,
      };
      document.body.classList.add(axis === 'x' ? 'is-resizing-x' : 'is-resizing-y');
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [axis, onPointerMove, onPointerUp, value],
  );

  return { onPointerDown };
}
