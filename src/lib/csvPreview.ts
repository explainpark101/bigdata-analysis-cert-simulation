/** Memory-safe CSV preview: capped rows/cols/cell size. Never parse entire huge blob into DOM. */

export const CSV_PREVIEW_MAX_ROWS = 1000;
export const CSV_PREVIEW_MAX_COLS = 24;
export const CSV_PREVIEW_MAX_CELL = 64;
/** Scan enough bytes to usually cover 1000 data rows. */
export const CSV_PREVIEW_MAX_CHARS = 2_000_000;

export interface CsvPreviewTable {
  headers: string[];
  rows: string[][];
  truncatedRows: boolean;
  truncatedCols: boolean;
  truncatedFile: boolean;
  totalLinesEstimate: number;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function clipCell(s: string): string {
  if (s.length <= CSV_PREVIEW_MAX_CELL) return s;
  return `${s.slice(0, CSV_PREVIEW_MAX_CELL)}…`;
}

/**
 * Build a small preview table from CSV text without holding large arrays long-term.
 */
export function buildCsvPreview(content: string): CsvPreviewTable {
  const truncatedFile = content.length > CSV_PREVIEW_MAX_CHARS;
  const slice = truncatedFile ? content.slice(0, CSV_PREVIEW_MAX_CHARS) : content;
  const lines = slice.split(/\r?\n/).filter((l, idx, arr) => {
    // drop trailing empty from split
    return !(idx === arr.length - 1 && l === '');
  });

  const totalLinesEstimate = truncatedFile
    ? Math.max(lines.length, Math.floor(content.length / Math.max(1, slice.length / lines.length)))
    : lines.length;

  if (!lines.length) {
    return {
      headers: [],
      rows: [],
      truncatedRows: false,
      truncatedCols: false,
      truncatedFile,
      totalLinesEstimate: 0,
    };
  }

  const headerRaw = splitCsvLine(lines[0]);
  const truncatedCols = headerRaw.length > CSV_PREVIEW_MAX_COLS;
  const headers = headerRaw.slice(0, CSV_PREVIEW_MAX_COLS).map(clipCell);

  const body = lines.slice(1, 1 + CSV_PREVIEW_MAX_ROWS);
  const truncatedRows = lines.length - 1 > CSV_PREVIEW_MAX_ROWS || truncatedFile;
  const rows = body.map((line) => {
    const cells = splitCsvLine(line);
    const padded = Array.from({ length: headers.length }, (_, i) =>
      clipCell(cells[i] ?? ''),
    );
    return padded;
  });

  return {
    headers,
    rows,
    truncatedRows,
    truncatedCols,
    truncatedFile,
    totalLinesEstimate,
  };
}
