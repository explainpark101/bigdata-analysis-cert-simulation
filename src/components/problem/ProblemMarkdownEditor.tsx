import { useEffect, useMemo, useRef, useState } from 'react';
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
import Image from '@tiptap/extension-image';
import { ImagePlus } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { htmlToMarkdown, markdownToHtmlFragment } from '@/lib/markdown';
import {
  assetToDataUrl,
  buildAssetUrlMap,
  isImageAsset,
  isImageFileName,
  markdownImageSnippet,
  type MediaAsset,
} from '@/lib/assetMedia';

type ViewMode = 'wysiwyg' | 'source';

interface ProblemMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  /** Project/exam assets used to resolve ![alt](path) previews */
  assets?: MediaAsset[];
  /**
   * Persist picked image files into the project library and return the
   * created/updated assets so the editor can insert markdown references.
   */
  onAttachImages?: (files: File[]) => Promise<MediaAsset[]>;
}

export function ProblemMarkdownEditor({
  value,
  onChange,
  readOnly,
  assets = [],
  onAttachImages,
}: ProblemMarkdownEditorProps) {
  const [mode, setMode] = useState<ViewMode>('wysiwyg');
  const { theme } = useTheme();
  const imageInputRef = useRef<HTMLInputElement>(null);

  const urlMap = useMemo(() => buildAssetUrlMap(assets), [assets]);
  const dataUrlToPath = useMemo(() => {
    const rev = new Map<string, string>();
    for (const [path, url] of urlMap) {
      if (!path.startsWith('./')) rev.set(url, path);
    }
    return rev;
  }, [urlMap]);

  const resolvedHtml = useMemo(
    () => markdownToHtmlFragment(value, assets),
    [value, assets],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: '문제 내용을 작성하세요… 이미지는 우측 첨부 버튼 또는 드래그',
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'md-inline-image',
        },
      }),
    ],
    content: resolvedHtml,
    editable: !readOnly,
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: ed }) => {
      if (readOnly) return;
      onChange(htmlToMarkdown(ed.getHTML(), { dataUrlToPath }));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor || mode !== 'wysiwyg') return;
    const current = htmlToMarkdown(editor.getHTML(), { dataUrlToPath });
    if (current.trim() === value.trim()) return;
    editor.commands.setContent(resolvedHtml, { emitUpdate: false });
  }, [value, mode, editor, resolvedHtml, dataUrlToPath]);

  const cmTheme = useMemo(
    () =>
      EditorView.theme({
        '&': {
          backgroundColor: 'var(--dq-input-bg)',
          color: 'var(--dq-text)',
        },
        '.cm-content': {
          caretColor: 'var(--dq-text)',
          color: 'var(--dq-text)',
          fontFamily: 'var(--dq-mono)',
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--dq-text)',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
          {
            backgroundColor:
              'color-mix(in srgb, var(--dq-accent) 35%, transparent)',
          },
        '.cm-gutters': {
          backgroundColor: 'var(--dq-surface-2)',
          color: 'var(--dq-muted)',
          border: 'none',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'var(--dq-ghost)',
        },
      }),
    [theme],
  );

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

  const insertImageAssets = (added: MediaAsset[]) => {
    const images = added.filter(isImageAsset);
    if (!images.length) return;
    const block = images.map((a) => markdownImageSnippet(a)).join('\n\n');
    const next = value.trimEnd();
    onChange(next ? `${next}\n\n${block}\n` : `${block}\n`);
  };

  const handleAttachFiles = async (list: FileList | File[] | null) => {
    if (!list || readOnly || !onAttachImages) return;
    const files = Array.from(list).filter((f) =>
      isImageFileName(f.name, f.type),
    );
    if (!files.length) return;
    const added = await onAttachImages(files);
    insertImageAssets(added);
  };

  return (
    <div className="haim-editor">
      <div className="editor-tabbar">
        <div className="editor-tabbar__tabs" role="tablist" aria-label="편집 모드">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'wysiwyg'}
            className={`editor-tab ${mode === 'wysiwyg' ? 'active' : ''}`}
            onClick={() => setMode('wysiwyg')}
          >
            WYSIWYG
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'source'}
            className={`editor-tab ${mode === 'source' ? 'active' : ''}`}
            onClick={() => setMode('source')}
          >
            Source
          </button>
        </div>
        <div className="editor-tabbar__actions">
          {onAttachImages && (
            <>
              <button
                type="button"
                className="ghost-btn btn-with-icon"
                disabled={readOnly}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImagePlus size={14} />
                이미지 첨부
              </button>
              <input
                ref={imageInputRef}
                className="hidden-file"
                type="file"
                accept="image/*,.png,.jpg,.jpeg,.gif,.webp,.svg"
                multiple
                onChange={async (e) => {
                  const files = e.target.files;
                  e.target.value = '';
                  await handleAttachFiles(files);
                }}
              />
            </>
          )}
        </div>
      </div>

      {mode === 'wysiwyg' ? (
        <div
          className="haim-wysiwyg"
          role="tabpanel"
          onDragOver={(e) => {
            if (!onAttachImages || readOnly) return;
            e.preventDefault();
          }}
          onDrop={(e) => {
            if (!onAttachImages || readOnly) return;
            e.preventDefault();
            void handleAttachFiles(e.dataTransfer.files);
          }}
        >
          <EditorContent editor={editor} />
        </div>
      ) : (
        <div className="haim-source" role="tabpanel">
          <CodeMirror
            value={value}
            height="240px"
            theme={cmTheme}
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

/** Helper for parent UIs that insert markdown image tags. */
export function previewAssetThumb(asset: MediaAsset): string | null {
  try {
    return assetToDataUrl(asset);
  } catch {
    return null;
  }
}
