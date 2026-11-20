import { useMemo } from 'react';
import type { QuizProblem } from '@/types/exam';
import { renderMarkdown } from '@/lib/markdown';
import { isImageAsset } from '@/lib/assetMedia';
import { ProvidedFilesPanel } from './ProvidedFilesPanel';

interface ProblemPanelProps {
  quiz: QuizProblem;
  /** Problem text zoom percent (font-size %). */
  zoomPct: number;
  /** Problem text line-height percent (200 → 2.0). */
  lineHeightPct: number;
  onZoomChange: (zoomPct: number) => void;
}

export function ProblemPanel({
  quiz,
  zoomPct,
  lineHeightPct,
  onZoomChange,
}: ProblemPanelProps) {
  const files = quiz.files ?? [];
  const dataFiles = useMemo(() => files.filter((f) => !isImageAsset(f)), [files]);
  const html = useMemo(
    () => renderMarkdown(quiz.markdown, files),
    [quiz.markdown, files],
  );

  return (
    <section className="problem-panel">
      <div className="panel-tabs">
        <button type="button" className="tab-btn active">
          문제 정보
        </button>
      </div>

      <div className="problem-toolbar">
        <div className="problem-toolbar__left">
          <div className="zoom-group" role="group" aria-label="문제 글자 크기">
            <button
              type="button"
              className="icon-btn"
              aria-label="축소"
              onClick={() => onZoomChange(Math.max(70, zoomPct - 10))}
            >
              −
            </button>
            <span aria-live="polite">{zoomPct}%</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="확대"
              onClick={() => onZoomChange(Math.min(160, zoomPct + 10))}
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
        style={{
          // 100% → 14px base; ± buttons scale this (CSS % alone is parent-relative).
          fontSize: `${(14 * zoomPct) / 100}px`,
          lineHeight: lineHeightPct / 100,
        }}
      >
        <div className="problem-meta">
          <div>
            <h2>{quiz.title}</h2>
            {quiz.showNoteOnExam && quiz.note?.trim() ? (
              <p className="problem-note">{quiz.note}</p>
            ) : null}
          </div>
        </div>
        <ProvidedFilesPanel files={dataFiles} />
        <article
          className="md-content"
          style={{ lineHeight: 'inherit' }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </section>
  );
}
