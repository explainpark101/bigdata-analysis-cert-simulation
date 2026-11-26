/** User-local timezone + locale formatting for activity / report timestamps. */

/** IANA zone from the runtime (e.g. Asia/Seoul). Falls back to UTC. */
export function userTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function toValidDate(input: number | string | Date): Date | null {
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

const LOCAL_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
};

const LOCAL_TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZoneName: 'short',
};

/**
 * Format an absolute instant in the user's local timezone.
 * Prefer this over hard-coded locales so DST / zone offsets stay correct.
 */
export function formatLocalDateTime(input: number | string | Date): string {
  const date = toValidDate(input);
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, {
    ...LOCAL_DATE_TIME,
    timeZone: userTimeZone(),
  }).format(date);
}

/** Time-only (still bound to the user's timezone). */
export function formatLocalTime(input: number | string | Date): string {
  const date = toValidDate(input);
  if (!date) return '—';
  return new Intl.DateTimeFormat(undefined, {
    ...LOCAL_TIME,
    timeZone: userTimeZone(),
  }).format(date);
}

/** ISO-8601 UTC for `<time dateTime>` (machine-readable). */
export function toDateTimeAttr(input: number | string | Date): string {
  const date = toValidDate(input);
  if (!date) return '';
  return date.toISOString();
}
