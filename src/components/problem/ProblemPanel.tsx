import { useState } from 'react';
import type { QuizProblem } from '@/types/exam';
import { renderMarkdown } from '@/lib/markdown';
import { ProblemMarkdownEditor } from './ProblemMarkdownEditor';

interface ProblemPanelProps {
  quiz: QuizProblem;
  editMode: boolean;
  onMarkdownChange: (markdown: string) => void;
}

export function ProblemPanel({
  quiz,
  editMode,
  onMarkdownChange,
}: ProblemPanelProps) {
  const [zoom, setZoom] = useState(100);
  const [readOnly, setReadOnly] = useState(true);
  const [tab, setTab] = useState<'info' | 'edit'>('info');

  const effectiveTab = editMode ? tab : 'info';

  return (
    <section className="problem-panel">
      <div className="panel-tabs">
        <button
          type="button"
          className={`tab-btn ${effectiveTab === 'info' ? 'active' : ''}`}
          onClick={() => setTab('info')}
        >
          문제 정보
        </button>
        {editMode && (
          <button
            type="button"
            className={`tab-btn ${effectiveTab === 'edit' ? 'active' : ''}`}
            onClick={() => setTab('edit')}
          >
            문제 편집
          </button>
        )}
      </div>

      {effectiveTab === 'info' ? (
        <>
          <div className="problem-toolbar">
            <div className="problem-toolbar__left">
              <div className="zoom-group" role="group" aria-label="zoom controller">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="축소"
                  onClick={() => setZoom((z) => Math.max(70, z - 10))}
                >
                  −
                </button>
                <span>{zoom}%</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="확대"
                  onClick={() => setZoom((z) => Math.min(160, z + 10))}
                >
                  +
                </button>
              </div>
            </div>
            <div className="problem-toolbar__right">
              <span className="badge">유형 프로그래밍</span>
            </div>
          </div>
          <div
            className="problem-body guide-zoom"
            style={{ fontSize: `${zoom}%` }}
          >
            <div className="problem-meta">
              <h2>{quiz.title}</h2>
            </div>
            <article
              className="md-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(quiz.markdown) }}
            />
          </div>
        </>
      ) : (
        <div className="problem-body">
          <div className="problem-toolbar" style={{ margin: '-16px -18px 12px' }}>
            <label className="switch">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
              />
              Readonly
            </label>
          </div>
          <ProblemMarkdownEditor
            value={quiz.markdown}
            onChange={onMarkdownChange}
            readOnly={readOnly}
          />
        </div>
      )}
    </section>
  );
}
