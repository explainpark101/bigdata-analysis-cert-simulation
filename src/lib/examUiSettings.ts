/** Exam screen settings (goorm DataQ–style), persisted in localStorage. */

export type ExamEditorTheme = 'dark' | 'light';
export type ExamKeymap = 'default' | 'sublime' | 'vim' | 'emacs';
export type ExamIndentUnit = 'tab' | 'space';

export interface ExamUiSettings {
  /** Problem panel line-height as percent (e.g. 200 → 2.0) */
  contentLineHeightPct: number;
  /** Problem panel zoom / font scale percent */
  contentZoomPct: number;
  /** Editor line-height percent */
  editorLineHeightPct: number;
  /** Editor font size in px */
  editorFontSize: number;
  editorTheme: ExamEditorTheme;
  editorKeymap: ExamKeymap;
  indentUnit: ExamIndentUnit;
  tabSize: number;
}

export const DEFAULT_EXAM_UI_SETTINGS: ExamUiSettings = {
  contentLineHeightPct: 200,
  contentZoomPct: 100,
  editorLineHeightPct: 150,
  editorFontSize: 14,
  editorTheme: 'dark',
  editorKeymap: 'sublime',
  indentUnit: 'tab',
  tabSize: 2,
};

export const CONTENT_ZOOM_OPTIONS = [
  70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
] as const;

export const LINE_HEIGHT_OPTIONS = [100, 125, 150, 175, 200] as const;

export const EDITOR_FONT_OPTIONS = [
  11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const;

/** @deprecated Tab size is a free number input (min 0). Kept for older imports. */
export const TAB_SIZE_OPTIONS = [2, 4, 8] as const;

const LS_KEY = 'bks.examUi.v1';
const TAB_SIZE_MAX = 64;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function normalizeExamUiSettings(
  raw: Partial<ExamUiSettings> | null | undefined,
): ExamUiSettings {
  const d = DEFAULT_EXAM_UI_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };
  return {
    contentLineHeightPct: clamp(
      Number(raw.contentLineHeightPct) || d.contentLineHeightPct,
      100,
      300,
    ),
    contentZoomPct: clamp(
      Number(raw.contentZoomPct) || d.contentZoomPct,
      70,
      160,
    ),
    editorLineHeightPct: clamp(
      Number(raw.editorLineHeightPct) || d.editorLineHeightPct,
      100,
      300,
    ),
    editorFontSize: clamp(
      Number(raw.editorFontSize) || d.editorFontSize,
      11,
      24,
    ),
    editorTheme: raw.editorTheme === 'light' ? 'light' : 'dark',
    editorKeymap:
      raw.editorKeymap === 'vim' ||
      raw.editorKeymap === 'emacs' ||
      raw.editorKeymap === 'default' ||
      raw.editorKeymap === 'sublime'
        ? raw.editorKeymap
        : d.editorKeymap,
    indentUnit: raw.indentUnit === 'space' ? 'space' : 'tab',
    tabSize: clamp(
      Number.isFinite(Number(raw.tabSize))
        ? Math.floor(Number(raw.tabSize))
        : d.tabSize,
      0,
      TAB_SIZE_MAX,
    ),
  };
}

export function loadExamUiSettings(): ExamUiSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_EXAM_UI_SETTINGS };
    return normalizeExamUiSettings(JSON.parse(raw) as Partial<ExamUiSettings>);
  } catch {
    return { ...DEFAULT_EXAM_UI_SETTINGS };
  }
}

export const EXAM_UI_SETTINGS_EVENT = 'bks-exam-ui-settings';

export function saveExamUiSettings(settings: ExamUiSettings): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify(normalizeExamUiSettings(settings)),
    );
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(EXAM_UI_SETTINGS_EVENT));
    }
  } catch {
    /* quota / private mode */
  }
}
