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
 * Uses pointer capture + refs so React re-renders mid-drag cannot drop listeners.
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
  const captureEl = useRef<HTMLElement | null>(null);
  const captureId = useRef<number | null>(null);
  const listening = useRef(false);

  const optsRef = useRef({ axis, invert, min, max, onChange, value });
  optsRef.current = { axis, invert, min, max, onChange, value };

  // Stable window handlers (same identity for add/remove across renders).
  const handlers = useRef({
    move(e: PointerEvent) {
      if (!dragging.current) return;
      const { axis: ax, invert: inv, min: lo, max: hi, onChange: change } =
        optsRef.current;
      const pos = ax === 'x' ? e.clientX : e.clientY;
      const delta = pos - startRef.current.pointer;
      const signed = inv ? -delta : delta;
      const cappedHi = Math.max(lo, hi);
      const next = Math.min(
        cappedHi,
        Math.max(lo, startRef.current.size + signed),
      );
      change(next);
    },
    end() {
      if (!dragging.current && !listening.current) return;
      dragging.current = false;
      document.body.classList.remove('is-resizing-x', 'is-resizing-y');
      const el = captureEl.current;
      const id = captureId.current;
      if (el && id != null) {
        try {
          if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
        } catch {
          /* already released */
        }
      }
      captureEl.current = null;
      captureId.current = null;
      if (listening.current) {
        listening.current = false;
        window.removeEventListener('pointermove', handlers.current.move);
        window.removeEventListener('pointerup', handlers.current.end);
        window.removeEventListener('pointercancel', handlers.current.end);
      }
    },
  });

  useEffect(() => () => handlers.current.end(), []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();

    handlers.current.end();

    const { axis: ax, value: size } = optsRef.current;
    dragging.current = true;
    startRef.current = {
      pointer: ax === 'x' ? e.clientX : e.clientY,
      size,
    };

    const el = e.currentTarget;
    captureEl.current = el;
    captureId.current = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    document.body.classList.add(ax === 'x' ? 'is-resizing-x' : 'is-resizing-y');

    listening.current = true;
    window.addEventListener('pointermove', handlers.current.move);
    window.addEventListener('pointerup', handlers.current.end);
    window.addEventListener('pointercancel', handlers.current.end);
  }, []);

  return { onPointerDown };
}
