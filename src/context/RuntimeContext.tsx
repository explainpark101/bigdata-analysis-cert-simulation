import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { RuntimeStatus } from '@/types/exam';
import { preloadPyodide } from '@/runtimes/pyodideRuntime';
import { preloadWebR } from '@/runtimes/webrRuntime';

interface RuntimeContextValue {
  runtime: RuntimeStatus;
  /** Re-attempt preload (safe if already ready — shared promises). */
  ensureRuntimes: () => void;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

/**
 * Preload Pyodide + webR as soon as the app boots so exam/project runs
 * do not wait on first click.
 */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<RuntimeStatus>({
    python: 'idle',
    r: 'idle',
  });

  const ensureRuntimes = useCallback(() => {
    setRuntime((s) => ({
      python: s.python === 'ready' ? 'ready' : 'loading',
      r: s.r === 'ready' ? 'ready' : 'loading',
      message: undefined,
    }));

    void preloadPyodide()
      .then(() => {
        setRuntime((s) => ({ ...s, python: 'ready' }));
      })
      .catch((err) => {
        setRuntime((s) => ({
          ...s,
          python: 'error',
          message: err instanceof Error ? err.message : String(err),
        }));
      });

    void preloadWebR()
      .then(() => {
        setRuntime((s) => ({ ...s, r: 'ready' }));
      })
      .catch((err) => {
        setRuntime((s) => ({
          ...s,
          r: 'error',
          message: err instanceof Error ? err.message : String(err),
        }));
      });
  }, []);

  useEffect(() => {
    ensureRuntimes();
  }, [ensureRuntimes]);

  const value = useMemo(
    () => ({ runtime, ensureRuntimes }),
    [runtime, ensureRuntimes],
  );

  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) {
    throw new Error('useRuntime must be used within RuntimeProvider');
  }
  return ctx;
}
