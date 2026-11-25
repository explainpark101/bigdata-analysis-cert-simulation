import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import {
  buildCsvPreview,
  CSV_PREVIEW_MAX_ROWS,
} from '@/lib/csvPreview';
import { isImageAsset } from '@/lib/assetMedia';
import { getAssetContentPreview, getAssetDisplayUrl } from '@/lib/assetStore';
import type { ProjectAsset } from '@/types/project';
import type { ExamAsset } from '@/types/exam';

type PreviewAsset = (ProjectAsset | ExamAsset) & { id?: string };

interface CsvPreviewPaneProps {
  asset: PreviewAsset | null;
}

type CsvViewMode = 'table' | 'text';

/** Header + up to CSV_PREVIEW_MAX_ROWS data lines for text mode. */
function buildTextPreview(content: string): { text: string; truncated: boolean } {
  const lines = content.split(/\r?\n/);
  // Keep header + N body lines (same cap as table mode).
  const maxLines = 1 + CSV_PREVIEW_MAX_ROWS;
  if (lines.length <= maxLines) {
    const text =
      lines.length && lines[lines.length - 1] === ''
        ? lines.slice(0, -1).join('\n')
        : lines.join('\n');
    return { text, truncated: false };
  }
  return {
    text: `${lines.slice(0, maxLines).join('\n')}\n… (최대 ${CSV_PREVIEW_MAX_ROWS}행만 표시)`,
    truncated: true,
  };
}

async function resolvePreviewContent(asset: PreviewAsset): Promise<string> {
  if (asset.content) {
    return asset.content.length > 2_000_000
      ? asset.content.slice(0, 2_000_000)
      : asset.content;
  }
  if (asset.id) {
    return getAssetContentPreview(asset as ProjectAsset);
  }
  return '';
}

export function CsvPreviewPane({ asset }: CsvPreviewPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [viewMode, setViewMode] = useState<CsvViewMode>('table');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [imageSrc, setImageSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    let revoke = () => undefined as void;
    if (!asset || !isImageAsset(asset) || !asset.id) {
      setImageSrc('');
      return;
    }
    void (async () => {
      const display = await getAssetDisplayUrl(asset as ProjectAsset);
      if (cancelled) {
        display.revoke();
        return;
      }
      revoke = display.revoke;
      setImageSrc(display.url);
    })();
    return () => {
      cancelled = true;
      revoke();
    };
  }, [asset]);

  useEffect(() => {
    let cancelled = false;
    if (!asset || isImageAsset(asset)) {
      setContent('');
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const text = await resolvePreviewContent(asset);
        if (!cancelled) setContent(text);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [asset]);

  const preview = useMemo(() => {
    if (!asset || isImageAsset(asset) || asset.encoding !== 'utf-8') return null;
    if (!content) return null;
    return buildCsvPreview(content);
  }, [asset, content]);

  const textPreview = useMemo(() => {
    if (!asset || isImageAsset(asset) || asset.encoding !== 'utf-8') {
      return { text: '', truncated: false };
    }
    return buildTextPreview(content);
  }, [asset, content]);

  // Reset to table when switching files
  useEffect(() => {
    setViewMode('table');
  }, [asset && 'id' in asset ? asset.id : asset?.path]);

  // Sticky thead: map wheel (incl. vertical) to horizontal scroll of the pane.
  useEffect(() => {
    const thead = theadRef.current;
    const scroller = scrollRef.current;
    if (!thead || !scroller || !preview?.headers.length || viewMode !== 'table') {
      return;
    }

    const onWheel = (e: WheelEvent) => {
      const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (dx === 0) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      if (max <= 0) return;
      e.preventDefault();
      scroller.scrollLeft = Math.min(max, Math.max(0, scroller.scrollLeft + dx));
    };

    thead.addEventListener('wheel', onWheel, { passive: false });
    return () => thead.removeEventListener('wheel', onWheel);
  }, [preview, viewMode]);

  if (!asset) {
    return (
      <aside className="csv-preview empty">
        <FileSpreadsheet size={28} aria-hidden />
        <p>왼쪽에서 파일명을 누르면 미리보기가 표시됩니다.</p>
        <p className="edit-page__sub">대용량 파일은 앞부분만 샘플링합니다.</p>
      </aside>
    );
  }

  if (isImageAsset(asset)) {
    return (
      <aside className="csv-preview">
        <div className="csv-preview__head">
          <h3>{asset.name}</h3>
          <p className="edit-page__sub">선택 중인 이미지만 미리봅니다.</p>
        </div>
        {imageSrc ? (
          <img
            className="csv-preview__image"
            src={imageSrc}
            alt={asset.name}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <p className="edit-page__sub">이미지 불러오는 중…</p>
        )}
      </aside>
    );
  }

  if (loading) {
    return (
      <aside className="csv-preview">
        <div className="csv-preview__head">
          <h3>{asset.path}</h3>
          <p className="edit-page__sub">미리보기 불러오는 중…</p>
        </div>
      </aside>
    );
  }

  if (!preview || !preview.headers.length) {
    return (
      <aside className="csv-preview">
        <div className="csv-preview__head">
          <h3>{asset.path}</h3>
          <p className="edit-page__sub">미리볼 표 데이터가 없습니다.</p>
        </div>
        <div className="csv-preview__modes" role="tablist" aria-label="보기 모드">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'table'}
            className={`csv-preview__mode-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            테이블
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'text'}
            className={`csv-preview__mode-btn ${viewMode === 'text' ? 'active' : ''}`}
            onClick={() => setViewMode('text')}
          >
            텍스트
          </button>
        </div>
        {viewMode === 'text' ? (
          <pre className="csv-preview__text">
            {textPreview.text || '(비어 있음)'}
          </pre>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="csv-preview">
      <div className="csv-preview__head">
        <h3>{asset.path}</h3>
        <p className="edit-page__sub">
          {viewMode === 'table'
            ? `미리보기 ${preview.rows.length}행 × ${preview.headers.length}열`
            : '원문 텍스트 미리보기'}
          {preview.truncatedRows || preview.truncatedCols || preview.truncatedFile
            ? ' (잘림)'
            : ''}
          {preview.truncatedFile
            ? ` · 파일 앞부분만 스캔 (~추정 ${preview.totalLinesEstimate}줄)`
            : ''}
        </p>
        {viewMode === 'table' ? (
          <p className="csv-preview__hint">
            가로 스크롤: 헤더(thead)에서 휠 · 본문에서는 <kbd>Shift</kbd> + 휠
          </p>
        ) : null}
      </div>

      <div className="csv-preview__modes" role="tablist" aria-label="보기 모드">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'table'}
          className={`csv-preview__mode-btn ${viewMode === 'table' ? 'active' : ''}`}
          onClick={() => setViewMode('table')}
        >
          테이블
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'text'}
          className={`csv-preview__mode-btn ${viewMode === 'text' ? 'active' : ''}`}
          onClick={() => setViewMode('text')}
        >
          텍스트
        </button>
      </div>

      {viewMode === 'table' ? (
        <div className="csv-preview__scroll" ref={scrollRef}>
          <table>
            <thead ref={theadRef}>
              <tr>
                {preview.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="csv-preview__text">{textPreview.text}</pre>
      )}
    </aside>
  );
}
