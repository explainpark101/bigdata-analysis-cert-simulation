import { useEffect, useState } from 'react';

/**
 * While `running` is true, expose elapsed milliseconds updated every 100ms.
 * When not running, holds the last elapsed value (or 0 if never started).
 */
export function useRunElapsed(running: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!running) return;
    const started = performance.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(performance.now() - started);
    }, 100);
    return () => {
      window.clearInterval(id);
      setElapsedMs(performance.now() - started);
    };
  }, [running]);

  return elapsedMs;
}

/** Format as `03.4/60초` (tenths + max seconds). */
export function formatRunClock(elapsedMs: number, maxSeconds: number): string {
  const max = Math.max(1, Math.round(maxSeconds) || 60);
  const sec = Math.max(0, elapsedMs) / 1000;
  const whole = Math.floor(sec);
  const tenths = Math.floor((sec - whole) * 10);
  const left = `${String(whole).padStart(2, '0')}.${tenths}`;
  return `${left}/${max}초`;
}
