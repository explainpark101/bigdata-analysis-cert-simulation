import {
  runtimeKindLabel,
  type RuntimeKind,
  type RuntimeLockEntry,
} from '@/lib/runtimeMutex';

/** Status line when a tool is queued behind another runtime holder. */
export function runtimeWaitStatus(info: {
  runtime: RuntimeKind;
  position: number;
  holder: RuntimeLockEntry | null;
}): string {
  const rt = runtimeKindLabel(info.runtime);
  if (info.holder) {
    return `${rt} 대기열 ${info.position}번 · 사용 중: ${info.holder.session} · ${info.holder.label}`;
  }
  return `${rt} 대기열 ${info.position}번 · 해제 대기…`;
}

export function runtimeSessionLabel(opts: {
  mode?: 'author' | 'modify' | 'variant' | 'verify' | 'exam';
  title?: string;
  taskType?: number;
}): string {
  const mode =
    opts.mode === 'modify'
      ? '수정 AI'
      : opts.mode === 'variant'
        ? '변형 AI'
        : opts.mode === 'verify'
          ? '검증'
          : opts.mode === 'exam'
            ? '응시 실행'
            : '출제 AI';
  const type =
    opts.taskType != null ? `제${opts.taskType}유형` : '';
  const title = (opts.title ?? '').trim();
  return [mode, type, title].filter(Boolean).join(' · ');
}
