/**
 * Serialize Pyodide / WebR mount+execute with a visible global queue.
 * Each runtime has its own lane; `both` acquires python then r (stable order).
 * Waiters stay queued until the holder releases — then the next promise resumes.
 */

export type RuntimeKind = 'python' | 'r';

export type RuntimeLockPhase = 'waiting' | 'running';

export type RuntimeLockEntry = {
  id: string;
  runtime: RuntimeKind;
  /** Short action name, e.g. run_answer_code */
  label: string;
  /** Human session, e.g. 출제 AI · 제2유형 */
  session: string;
  phase: RuntimeLockPhase;
  enqueuedAt: number;
  startedAt?: number;
};

export type RuntimeLockLaneState = {
  runtime: RuntimeKind;
  holder: RuntimeLockEntry | null;
  waiters: RuntimeLockEntry[];
};

export type RuntimeLockQueueState = {
  python: RuntimeLockLaneState;
  r: RuntimeLockLaneState;
  updatedAt: number;
};

export type RuntimeLockRequest = {
  /** Which WASM runtime(s) to hold. Default `both` keeps cross-runtime remount safe. */
  runtime?: RuntimeKind | 'both';
  label?: string;
  session?: string;
  signal?: AbortSignal;
  /** Fired when this job is blocked behind another holder (and on enqueue). */
  onWait?: (info: {
    runtime: RuntimeKind;
    position: number;
    holder: RuntimeLockEntry | null;
  }) => void;
};

type Listener = (state: RuntimeLockQueueState) => void;

type Lane = {
  chain: Promise<void>;
  holder: RuntimeLockEntry | null;
  waiters: RuntimeLockEntry[];
};

const listeners = new Set<Listener>();

const lanes: Record<RuntimeKind, Lane> = {
  python: { chain: Promise.resolve(), holder: null, waiters: [] },
  r: { chain: Promise.resolve(), holder: null, waiters: [] },
};

let seq = 0;

function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

function snapshot(): RuntimeLockQueueState {
  return {
    python: {
      runtime: 'python',
      holder: lanes.python.holder,
      waiters: [...lanes.python.waiters],
    },
    r: {
      runtime: 'r',
      holder: lanes.r.holder,
      waiters: [...lanes.r.waiters],
    },
    updatedAt: Date.now(),
  };
}

function emit(): void {
  const state = snapshot();
  for (const listener of listeners) listener(state);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('runtime-lock-change', { detail: state }),
    );
  }
}

export function getRuntimeLockQueue(): RuntimeLockQueueState {
  return snapshot();
}

export function subscribeRuntimeLockQueue(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function countBusyRuntimeLocks(): number {
  let n = 0;
  for (const kind of ['python', 'r'] as RuntimeKind[]) {
    const lane = lanes[kind];
    if (lane.holder) n += 1;
    n += lane.waiters.length;
  }
  return n;
}

export function runtimeKindLabel(kind: RuntimeKind): string {
  return kind === 'python' ? 'Pyodide' : 'WebR';
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new DOMException('Generation aborted', 'AbortError');
}

async function acquireLane(
  kind: RuntimeKind,
  meta: {
    label: string;
    session: string;
    signal?: AbortSignal;
    onWait?: RuntimeLockRequest['onWait'];
  },
): Promise<() => void> {
  throwIfAborted(meta.signal);

  const entry: RuntimeLockEntry = {
    id: newId(kind),
    runtime: kind,
    label: meta.label,
    session: meta.session,
    phase: 'waiting',
    enqueuedAt: Date.now(),
  };

  const lane = lanes[kind];
  lane.waiters = [...lane.waiters, entry];
  meta.onWait?.({
    runtime: kind,
    position: lane.waiters.length,
    holder: lane.holder,
  });
  emit();

  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const waitForTurn = lane.chain;
  lane.chain = gate;

  try {
    // Stay queued until the previous holder finishes, then resume this job
    // (or abort cleanly without running if the session was cancelled).
    await waitForTurn;
    throwIfAborted(meta.signal);

    lane.waiters = lane.waiters.filter((w) => w.id !== entry.id);
    entry.phase = 'running';
    entry.startedAt = Date.now();
    lane.holder = entry;
    emit();

    return () => {
      if (lane.holder?.id === entry.id) lane.holder = null;
      lane.waiters = lane.waiters.filter((w) => w.id !== entry.id);
      emit();
      releaseGate();
    };
  } catch (err) {
    lane.waiters = lane.waiters.filter((w) => w.id !== entry.id);
    if (lane.holder?.id === entry.id) lane.holder = null;
    emit();
    releaseGate();
    throw err;
  }
}

/**
 * Run `fn` while holding the requested runtime lane(s).
 * Waiters are remembered in the global queue and resume automatically when
 * the previous holder releases (promise chain + `runtime-lock-change` event).
 */
export async function withRuntimeLock<T>(
  fn: () => Promise<T>,
  request: RuntimeLockRequest = {},
): Promise<T> {
  const runtime = request.runtime ?? 'both';
  const label = (request.label ?? 'runtime').trim() || 'runtime';
  const session = (request.session ?? '세션').trim() || '세션';
  const kinds: RuntimeKind[] =
    runtime === 'both' ? ['python', 'r'] : [runtime];

  const releases: Array<() => void> = [];
  try {
    for (const kind of kinds) {
      const release = await acquireLane(kind, {
        label,
        session,
        signal: request.signal,
        onWait: request.onWait,
      });
      releases.push(release);
    }
    return await fn();
  } finally {
    for (const release of [...releases].reverse()) {
      try {
        release();
      } catch {
        /* ignore */
      }
    }
  }
}
