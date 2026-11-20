import type { ExamAsset } from '@/types/exam';
import { assetToDataUrl, isImageAsset } from '@/lib/assetMedia';

interface ProvidedFilesPanelProps {
  files: ExamAsset[];
}

function downloadAsset(file: ExamAsset): void {
  let blob: Blob;
  if (file.encoding === 'base64') {
    const bin = atob(file.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: file.mimeType || 'application/octet-stream' });
  } else {
    blob = new Blob([file.content], {
      type: file.mimeType || 'text/csv;charset=utf-8',
    });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name || file.path.split('/').pop() || 'file';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * DataQ-style provided file list (paths like data/customer_train.csv).
 * Images used in markdown are shown in the problem body, not here.
 */
export function ProvidedFilesPanel({ files }: ProvidedFilesPanelProps) {
  if (!files?.length) return null;

  return (
    <div className="provided-files">
      <div className="provided-files__title">제공 파일</div>
      <ul className="provided-files__list">
        {files.map((f) => (
          <li key={f.path}>
            <button
              type="button"
              className="provided-files__item"
              title="다운로드"
              onClick={() => downloadAsset(f)}
            >
              {isImageAsset(f) && (
                <img
                  className="asset-thumb"
                  src={assetToDataUrl(f)}
                  alt=""
                />
              )}
              <span className="provided-files__path">{f.path}</span>
              <span className="provided-files__name">{f.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
