/**
 * Compare short-answer tokens: numeric values match when equal
 * (e.g. "0.000" vs "0"), otherwise trimmed string equality.
 */
export function shortAnswersEqual(a: string, b: string): boolean {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (!sa || !sb) return sa === sb;

  const na = Number(sa);
  const nb = Number(sb);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) {
    return sa === sb;
  }
  const scale = Math.max(1, Math.abs(na), Math.abs(nb));
  return Math.abs(na - nb) <= 1e-9 * scale;
}
