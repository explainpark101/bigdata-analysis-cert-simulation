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
import { keymap, EditorView } from '@codemirror/view';
import { useMemo } from 'react';
import type { ExamLanguage } from '@/types/exam';

/**
 * DataQ examApp uses CodeMirror with `cm-s-monokai` + wrap.
 * Line numbers slightly bolder; line height a bit taller than default.
 */
const dataqMonokai = monokaiInit({
  settings: {
    background: '#272822',
    foreground: '#f8f8f2',
    caret: '#f8f8f0',
    selection: '#49483e',
    selectionMatch: '#49483e',
    lineHighlight: '#3e3d32',
    gutterBackground: '#272822',
    gutterForeground: '#c2c2b8',
    gutterBorder: 'transparent',
    fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
  },
});

const editorChrome = EditorView.theme({
  '&': {
    fontSize: '13.5px',
  },
  '.cm-content': {
    lineHeight: '1.65',
    paddingTop: '4px',
    paddingBottom: '4px',
  },
  '.cm-line': {
    paddingTop: '1px',
    paddingBottom: '1px',
  },
  '.cm-gutters': {
    border: 'none',
    minWidth: '3.1em',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    fontWeight: '700',
    fontSize: '13px',
    letterSpacing: '0.02em',
    minWidth: '2.6em',
    paddingRight: '10px',
    lineHeight: '1.65',
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

interface CodeEditorProps {
  value: string;
  language: ExamLanguage;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export function CodeEditor({
  value,
  language,
  onChange,
  readOnly = false,
}: CodeEditorProps) {
  const extensions = useMemo(
    () => [
      history(),
      indentUnit.of('    '),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      editorChrome,
      language === 'python' ? python() : rLanguage,
    ],
    [language],
  );

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={dataqMonokai}
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
