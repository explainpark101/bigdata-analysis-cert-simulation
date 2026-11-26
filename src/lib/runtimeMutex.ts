/**
 * Serialize Pyodide / WebR mount+execute — both are process-wide singletons.
 * Hold the lock across mount + run so another job cannot remount mid-flight.
 */

let chain: Promise<void> = Promise.resolve();

export async function withRuntimeLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitForTurn = chain;
  chain = gate;

  await waitForTurn;
  try {
    return await fn();
  } finally {
    release();
  }
}
