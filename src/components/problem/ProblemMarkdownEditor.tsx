import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView, keymap } from '@codemirror/view';
import {
  history,
  defaultKeymap,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import { htmlToMarkdown, markdownToHtmlFragment } from '@/lib/markdown';

type ViewMode = 'wysiwyg' | 'source';

interface ProblemMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}

/**
 * Dual-pane problem editor inspired by DocuHaim / Haim Editor:
 * WYSIWYG (TipTap) + Source (CodeMirror), with readonly toggle from parent.
 */
export function ProblemMarkdownEditor({
  value,
  onChange,
  readOnly,
}: ProblemMarkdownEditorProps) {
  const [mode, setMode] = useState<ViewMode>('wysiwyg');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '문제 내용을 작성하세요…',
      }),
    ],
    content: markdownToHtmlFragment(value),
    editable: !readOnly,
    // TipTap v3: avoid extra React re-renders unless toolbar needs them
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: ed }) => {
      if (readOnly) return;
      onChange(htmlToMarkdown(ed.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || mode !== 'wysiwyg') return;
    const current = htmlToMarkdown(editor.getHTML());
    if (current.trim() === value.trim()) return;
    editor.commands.setContent(markdownToHtmlFragment(value), {
      emitUpdate: false,
    });
  }, [value, mode, editor]);

  const sourceExtensions = useMemo(
    () => [
      history(),
      markdown(),
      EditorView.lineWrapping,
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.editable.of(!readOnly),
    ],
    [readOnly],
  );

  return (
    <div className="haim-editor">
      <div className="haim-editor__modes">
        <button
          type="button"
          className={`tool-btn ${mode === 'wysiwyg' ? 'active' : ''}`}
          onClick={() => setMode('wysiwyg')}
        >
          WYSIWYG
        </button>
        <button
          type="button"
          className={`tool-btn ${mode === 'source' ? 'active' : ''}`}
          onClick={() => setMode('source')}
        >
          Source
        </button>
      </div>

      {mode === 'wysiwyg' ? (
        <div className="haim-wysiwyg">
          <EditorContent editor={editor} />
        </div>
      ) : (
        <div className="haim-source">
          <CodeMirror
            value={value}
            height="240px"
            extensions={sourceExtensions}
            readOnly={readOnly}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              autocompletion: false,
            }}
            onChange={(next) => {
              if (!readOnly) onChange(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
