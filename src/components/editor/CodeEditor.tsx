import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { StreamLanguage, indentUnit } from '@codemirror/language';
import { monokaiInit } from '@uiw/codemirror-theme-monokai';
import {
  indentWithTab,
  history,
  defaultKeymap,
  historyKeymap,
} from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { keymap, EditorView } from '@codemirror/view';
import { useMemo } from 'react';
import type { ExamLanguage } from '@/types/exam';
import type {
  ExamEditorTheme,
  ExamIndentUnit,
  ExamKeymap,
} from '@/lib/examUiSettings';
import { useTheme } from '@/context/ThemeContext';
import { useExamUiSettings } from '@/hooks/useExamUiSettings';

/**
 * Click in the empty region below the last line → caret at end of last line.
 * (DataQ / typical IDE behavior for tall editors.)
 */
const clickBelowMovesToEnd = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.defaultPrevented) return false;
    const lastLine = view.state.doc.line(view.state.doc.lines);
    const lastCoords = view.coordsAtPos(lastLine.to, 1);
    if (!lastCoords) return false;
    // Only intercept clicks clearly below the last line's box.
    if (event.clientY <= lastCoords.bottom + 2) return false;
    event.preventDefault();
    view.dispatch({
      selection: EditorSelection.cursor(lastLine.to),
      scrollIntoView: true,
    });
    view.focus();
    return true;
  },
});

/**
 * DataQ examApp uses CodeMirror with `cm-s-monokai` + wrap.
 */
const dataqMonokai = monokaiInit({
  settings: {
    // Neutral dark (avoid yellow cast so selection can contrast clearly)
    background: '#1e1f22',
    foreground: '#f8f8f2',
    caret: '#f8f8f0',
    // Blue selection — distinct from base / active line
    selection: '#264f78',
    selectionMatch: '#3a5f8a',
    lineHighlight: '#2a2b2e',
    gutterBackground: '#1e1f22',
    gutterForeground: '#c2c2b8',
    gutterBorder: 'transparent',
    fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
  },
});

/** Lightweight R highlighting (no heavy LSP). */
const rLanguage = StreamLanguage.define({
  name: 'r',
  startState: () => ({}),
  token(stream) {
    if (stream.match(/#.*/)) return 'comment';
    if (stream.match(/"(?:[^\\"]|\\.)*"|'(?:[^\\']|\\.)*'/)) return 'string';
    if (
      stream.match(
        /\b(?:function|if|else|for|while|repeat|in|next|break|TRUE|FALSE|NULL|NA|Inf|NaN)\b/,
      )
    ) {
      return 'keyword';
    }
    if (stream.match(/[0-9]+(?:\.[0-9]+)?/)) return 'number';
    if (stream.match(/<-|<<-|->|->>|=/)) return 'operator';
    if (stream.match(/[A-Za-z.][\w.]*/)) return 'variable';
    stream.next();
    return null;
  },
});

export interface CodeEditorPrefs {
  fontSize: number;
  lineHeightPct: number;
  theme: ExamEditorTheme;
  keymap: ExamKeymap;
  indentUnit: ExamIndentUnit;
  tabSize: number;
}

interface CodeEditorProps {
  value: string;
  language: ExamLanguage;
  onChange: (value: string) => void;
  readOnly?: boolean;
  prefs?: Partial<CodeEditorPrefs>;
}

const DEFAULT_PREFS: CodeEditorPrefs = {
  fontSize: 14,
  lineHeightPct: 150,
  theme: 'dark',
  keymap: 'default',
  indentUnit: 'tab',
  tabSize: 2,
};

export function CodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
  prefs: prefsIn,
}: CodeEditorProps) {
  const { theme: appTheme } = useTheme();
  const { settings: uiSettings } = useExamUiSettings();
  // Defaults: line-height 150% (and other editor prefs) from screen settings / localStorage.
  const prefs: CodeEditorPrefs = {
    ...DEFAULT_PREFS,
    fontSize: uiSettings.editorFontSize,
    lineHeightPct: uiSettings.editorLineHeightPct,
    keymap: uiSettings.editorKeymap,
    indentUnit: uiSettings.indentUnit,
    tabSize: uiSettings.tabSize,
    ...prefsIn,
  };
  // App light/dark mode drives editor colors (prefs.theme is optional override).
  const colorTheme: ExamEditorTheme =
    prefsIn?.theme ?? (appTheme === 'light' ? 'light' : 'dark');
  const lh = (prefs.lineHeightPct || 150) / 100;
  const indentStr =
    prefs.indentUnit === 'space'
      ? ' '.repeat(Math.max(0, prefs.tabSize))
      : '\t';
  const isLight = colorTheme === 'light';

  const editorChrome = useMemo(
    () =>
      EditorView.theme({
        '&': {
          fontSize: `${prefs.fontSize}px`,
          cursor: 'text',
          ...(isLight
            ? { backgroundColor: '#f8fafc', color: '#0f172a' }
            : { backgroundColor: '#1e1f22', color: '#f8f8f2' }),
        },
        '.cm-scroller': {
          // Do not force minHeight beyond the pane — enables internal scroll.
          minHeight: '0',
          height: '100%',
          overflow: 'auto',
          cursor: 'text',
          fontSize: `${prefs.fontSize}px`,
          fontFamily: 'var(--dq-mono)',
        },
        '.cm-content': {
          fontSize: `${prefs.fontSize}px`,
          fontFamily: 'var(--dq-mono)',
          lineHeight: `${lh}`,
          paddingTop: '4px',
          paddingBottom: '4px',
          // Fill the editor so empty space below last line is still content
          // (same text cursor as selecting characters).
          minHeight: '100%',
          flexGrow: '1',
          tabSize: String(prefs.tabSize),
          boxSizing: 'border-box',
          cursor: 'text',
        },
        '.cm-line': {
          fontSize: `${prefs.fontSize}px`,
          lineHeight: `${lh}`,
          paddingTop: '0',
          paddingBottom: '0',
          cursor: 'text',
        },
        '.cm-gutters': {
          border: 'none',
          minWidth: '3.1em',
          cursor: 'default',
          fontSize: `${prefs.fontSize}px`,
          ...(isLight
            ? {
                backgroundColor: '#f1f5f9',
                color: '#64748b',
              }
            : {
                backgroundColor: '#1e1f22',
                color: '#c2c2b8',
              }),
        },
        '.cm-lineNumbers .cm-gutterElement': {
          fontWeight: '700',
          fontSize: `${Math.max(11, prefs.fontSize - 1)}px`,
          letterSpacing: '0.02em',
          minWidth: '2.6em',
          paddingRight: '10px',
          lineHeight: `${lh}`,
        },
      }),
    [prefs.fontSize, prefs.tabSize, lh, isLight],
  );

  /**
   * Selection must stay visible on the active line. CM6 paints `.cm-activeLine`
   * on the content layer above `.cm-selectionLayer`, so an opaque active-line
   * background hides intra-line selections. Keep active line translucent and
   * force a strong selection color last in the extension list.
   */
  const selectionVisible = useMemo(
    () =>
      EditorView.theme(
        {
          '.cm-activeLine': {
            backgroundColor: isLight
              ? 'rgba(15, 23, 42, 0.06) !important'
              : 'rgba(255, 255, 255, 0.06) !important',
          },
          '.cm-activeLineGutter': {
            backgroundColor: isLight
              ? 'rgba(15, 23, 42, 0.06) !important'
              : 'rgba(255, 255, 255, 0.06) !important',
          },
          '.cm-selectionBackground': {
            backgroundColor: isLight
              ? 'rgba(0, 120, 215, 0.35) !important'
              : 'rgba(38, 79, 120, 0.95) !important',
          },
          '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
            {
              backgroundColor: isLight
                ? 'rgba(0, 120, 215, 0.4) !important'
                : 'rgba(38, 79, 120, 0.95) !important',
            },
          '.cm-content ::selection': {
            backgroundColor: isLight
              ? 'rgba(0, 120, 215, 0.4)'
              : 'rgba(38, 79, 120, 0.95)',
          },
          '.cm-line ::selection': {
            backgroundColor: isLight
              ? 'rgba(0, 120, 215, 0.4)'
              : 'rgba(38, 79, 120, 0.95)',
          },
        },
        { dark: !isLight },
      ),
    [isLight],
  );

  const extensions = useMemo(() => {
    // Keymap variants: store preference; CM6 ships default(+tab). Vim/Emacs need extra pkgs.
    const keys = keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]);
    return [
      history(),
      indentUnit.of(indentStr),
      keys,
      EditorView.lineWrapping,
      clickBelowMovesToEnd,
      editorChrome,
      language === 'python' ? python() : rLanguage,
      selectionVisible,
    ];
  }, [language, indentStr, editorChrome, prefs.keymap, selectionVisible]);

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={isLight ? 'light' : dataqMonokai}
      extensions={extensions}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: true,
        autocompletion: false,
        searchKeymap: false,
      }}
      onChange={onChange}
      aria-label="코드"
    />
  );
}
