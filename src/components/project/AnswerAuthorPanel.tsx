import { useMemo, useState } from 'react';
import { Copy, Play, Plus, Trash2 } from 'lucide-react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { ConfirmModal } from '@/components/exam/ConfirmModal';
import { resolveAssets } from '@/lib/projectIO';
import { mountAssetsToPyodide } from '@/runtimes/fsMount';
import { preloadPyodide, runPython } from '@/runtimes/pyodideRuntime';
import { preloadWebR, runR } from '@/runtimes/webrRuntime';
import type { ExamLanguage, RunResult, SubmitFormat } from '@/types/exam';
import type { AuthoringProject, BankProblem } from '@/types/project';

interface AnswerAuthorPanelProps {
  project: AuthoringProject;
  problem: BankProblem;
  onPatch: (patch: Partial<BankProblem>) => void;
}

function syncShortFields(answers: string[]): Pick<
  BankProblem,
  'shortAnswers' | 'shortAnswer'
> {
  const cleaned = answers.length ? answers : [''];
  return {
    shortAnswers: cleaned,
    shortAnswer: cleaned[0] ?? '',
  };
}

export function AnswerAuthorPanel({
  project,
  problem,
  onPatch,
}: AnswerAuthorPanelProps) {
  const type2 = problem.taskType === 2 || problem.submitFormat === 'csv';
  const [codeLang, setCodeLang] = useState<ExamLanguage>(problem.language);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<RunResult | null>(null);
  const [pendingRemoveIndex, setPendingRemoveIndex] = useState<number | null>(
    null,
  );

  const answerPython = problem.answerCode?.python ?? '';
  const answerR = problem.answerCode?.r ?? '';
  const shortAnswers =
    problem.shortAnswers?.length
      ? problem.shortAnswers
      : [problem.shortAnswer ?? ''];

  const activeCode = useMemo(
    () => (codeLang === 'python' ? answerPython : answerR),
    [codeLang, answerPython, answerR],
  );

  const setShortAt = (index: number, value: string) => {
    const next = [...shortAnswers];
    next[index] = value;
    onPatch(syncShortFields(next));
  };

  const addShort = () => {
    onPatch(syncShortFields([...shortAnswers, '']));
  };

  const removeShort = (index: number) => {
    const next = shortAnswers.filter((_, i) => i !== index);
    onPatch(syncShortFields(next.length ? next : ['']));
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const applyStdoutLine = (line: string) => {
    if (type2) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    const emptyIdx = shortAnswers.findIndex((s) => !s.trim());
    if (emptyIdx >= 0) {
      setShortAt(emptyIdx, trimmed);
    } else if (shortAnswers.length === 1 && !shortAnswers[0]?.trim()) {
      setShortAt(0, trimmed);
    } else {
      onPatch(syncShortFields([...shortAnswers, trimmed]));
    }
  };

  const runPreview = async () => {
    if (running) return;
    setRunning(true);
    setPreview(null);
    try {
      const { withProjectAssetContents } = await import('@/lib/assetStore');
      const hydrated = await withProjectAssetContents(
        project,
        problem.assetIds,
      );
      const files = resolveAssets(hydrated, problem.assetIds);
      const source = activeCode.trim();
      if (!source) {
        setPreview({
          ok: false,
          stdout: '',
          stderr: '답안 코드가 비어 있습니다.',
          durationMs: 0,
        });
        return;
      }

      let out: RunResult;
      if (codeLang === 'python') {
        await preloadPyodide();
        await mountAssetsToPyodide(files);
        out = await runPython(source);
      } else {
        await preloadWebR();
        const { mountAssetsToWebR } = await import('@/runtimes/fsMount');
        await mountAssetsToWebR(files);
        out = await runR(source);
      }
      setPreview(out);
    } catch (err) {
      setPreview({
        ok: false,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      });
    } finally {
      setRunning(false);
    }
  };

  const stdoutLines = (preview?.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <section className="edit-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>정답 (작성자용 · 시험지 미표시)</h2>
        <button
          type="button"
          className="primary-btn btn-with-icon"
          disabled={running}
          onClick={() => void runPreview()}
        >
          <Play size={14} />
          {running ? '실행 중…' : '미리 실행'}
        </button>
      </div>
      <p className="edit-page__sub">
        {type2
          ? '작업형 2유형은 CSV 제출이므로 단답 정답을 두지 않습니다. 코드 답안·채점 코드만 관리합니다.'
          : '코드 답안을 실행한 뒤 stdout을 단답에 복사하거나, 단답을 직접 입력할 수 있습니다.'}
      </p>

      <div className="editor-tabbar editor-tabbar--sub">
        <div className="editor-tabbar__tabs" role="tablist" aria-label="답안 언어">
          <button
            type="button"
            role="tab"
            aria-selected={codeLang === 'python'}
            className={`editor-tab ${codeLang === 'python' ? 'active' : ''}`}
            onClick={() => setCodeLang('python')}
          >
            Python
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={codeLang === 'r'}
            className={`editor-tab ${codeLang === 'r' ? 'active' : ''}`}
            onClick={() => setCodeLang('r')}
          >
            R
          </button>
        </div>
      </div>
      <div className="edit-code-wrap">
        <CodeEditor
          value={activeCode}
          language={codeLang}
          onChange={(next) =>
            onPatch({
              answerCode: {
                python: codeLang === 'python' ? next : answerPython,
                r: codeLang === 'r' ? next : answerR,
              },
              ...(type2 ? {} : { submitFormat: 'short' satisfies SubmitFormat }),
            })
          }
        />
      </div>

      {!type2 ? (
        <div className="short-answer-author">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 className="edit-card__subhead" style={{ margin: 0 }}>
              단답형 정답
            </h3>
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              onClick={addShort}
            >
              <Plus size={14} />
              칸 추가
            </button>
          </div>
          <div className="short-answer-author__fields">
            {shortAnswers.map((value, index) => (
              <div key={`sa-${index}`} className="short-answer-author__row">
                <label>
                  답안 {index + 1}
                  <input
                    value={value}
                    onChange={(e) => setShortAt(index, e.target.value)}
                    placeholder="직접 입력 또는 실행 결과에서 복사"
                  />
                </label>
                <button
                  type="button"
                  className="ghost-btn btn-with-icon"
                  title="클립보드 복사"
                  onClick={() => void copyText(value)}
                  disabled={!value}
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  className="ghost-btn btn-with-icon"
                  title="칸 삭제"
                  onClick={() => setPendingRemoveIndex(index)}
                  disabled={shortAnswers.length <= 1}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {stdoutLines.length > 0 ? (
            <div className="short-answer-author__from-run">
              <div className="edit-page__sub">실행 stdout → 단답에 넣기</div>
              <div className="short-answer-author__chips">
                {stdoutLines.map((line, i) => (
                  <button
                    key={`out-${i}-${line.slice(0, 24)}`}
                    type="button"
                    className="tool-btn"
                    onClick={() => applyStdoutLine(line)}
                  >
                    {line.length > 48 ? `${line.slice(0, 48)}…` : line}
                  </button>
                ))}
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    onPatch(syncShortFields(stdoutLines));
                  }}
                >
                  전체 라인으로 교체
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {preview && (
        <pre
          className={`answer-preview ${preview.ok ? 'ok' : 'error'}`}
          role="status"
        >
          {preview.stdout}
          {preview.stderr ? `\n[stderr]\n${preview.stderr}` : ''}
          {preview.durationMs
            ? `\n(${preview.durationMs.toFixed(0)} ms)`
            : ''}
        </pre>
      )}

      <ConfirmModal
        open={pendingRemoveIndex != null}
        title="단답 칸 삭제"
        message={
          pendingRemoveIndex != null
            ? `답안 ${pendingRemoveIndex + 1} 칸을 삭제할까요?`
            : ''
        }
        cancelLabel="취소"
        confirmLabel="삭제"
        confirmDanger
        onCancel={() => setPendingRemoveIndex(null)}
        onConfirm={() => {
          if (pendingRemoveIndex != null) {
            removeShort(pendingRemoveIndex);
          }
          setPendingRemoveIndex(null);
        }}
      />
    </section>
  );
}
