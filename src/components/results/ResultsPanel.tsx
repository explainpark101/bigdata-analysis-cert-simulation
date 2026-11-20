import { useMemo, useState } from 'react';
import type { RunResult } from '@/types/exam';
import { formatRunClock } from '@/hooks/useRunElapsed';

interface ResultsPanelProps {
  result: RunResult | null;
  running: boolean;
  /** Live elapsed ms while running (updated ~100ms). */
  elapsedMs?: number;
  /** Exam max run seconds (denominator in 00.0/60초). */
  maxRunSeconds?: number;
}

type ResultTab = 'run' | 'submit';

type OutputLine = {
  kind: 'system' | 'prompt' | 'stdout' | 'stderr';
  text: string;
};

const START_MSG = '프로세스가 시작되었습니다.(입력값을 직접 입력해 주세요)';
const END_MSG = '프로세스가 종료되었습니다.';

function splitOutput(text: string): string[] {
  if (!text.trim()) return [];
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/** DataQ-style console lines: blue system bookends + `>` prompt on first stdout. */
function buildRunLines(
  result: RunResult | null,
  running: boolean,
  clockLabel: string,
): OutputLine[] {
  if (running) {
    return [
      { kind: 'system', text: START_MSG },
      { kind: 'stdout', text: `실행 중… (${clockLabel})` },
    ];
  }

  if (!result) {
    return [{ kind: 'stdout', text: '실행 결과가 여기에 표시됩니다.' }];
  }

  const lines: OutputLine[] = [{ kind: 'system', text: START_MSG }];
  const outLines = splitOutput(result.stdout);
  const errLines = splitOutput(result.stderr);

  if (outLines.length) {
    lines.push({ kind: 'prompt', text: outLines[0] });
    for (const line of outLines.slice(1)) {
      lines.push({ kind: 'stdout', text: line });
    }
  } else if (!errLines.length) {
    lines.push({ kind: 'prompt', text: '(출력 없음)' });
  }

  for (const line of errLines) {
    lines.push({ kind: 'stderr', text: line });
  }

  lines.push({ kind: 'system', text: END_MSG });
  return lines;
}

export function ResultsPanel({
  result,
  running,
  elapsedMs = 0,
  maxRunSeconds = 60,
}: ResultsPanelProps) {
  const [tab, setTab] = useState<ResultTab>('run');

  const clockMs = running
    ? elapsedMs
    : result?.durationMs != null
      ? result.durationMs
      : 0;
  const durationLabel = formatRunClock(clockMs, maxRunSeconds);

  const runLines = useMemo(
    () => buildRunLines(result, running, durationLabel),
    [result, running, durationLabel],
  );

  let submitBody = '제출 후 결과가 여기에 표시됩니다.';
  if (result && tab === 'submit') {
    submitBody = result.ok
      ? '로컬 제출 기록이 저장되었습니다. (서버 채점 없음)'
      : '실행 오류로 제출 결과가 비어 있습니다.';
  }

  return (
    <div className="results-panel">
      <div className="panel-tabs dark results-toolbar">
        <div className="results-toolbar__tabs">
          <button
            type="button"
            className={`tab-btn ${tab === 'run' ? 'active' : ''}`}
            onClick={() => setTab('run')}
          >
            실행 결과
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === 'submit' ? 'active' : ''}`}
            onClick={() => setTab('submit')}
          >
            제출 결과
          </button>
        </div>
        {durationLabel ? (
          <div className="results-toolbar__duration" title="실행 시간">
            {durationLabel}
          </div>
        ) : null}
      </div>

      {tab === 'run' ? (
        <div
          className={`results-body results-console ${
            result && !result.ok && !running ? 'has-error' : ''
          }`}
        >
          {runLines.map((line, i) => (
            <div
              key={`${line.kind}-${i}`}
              className={`results-line results-line--${line.kind}`}
            >
              {line.kind === 'prompt' ? (
                <>
                  <span className="results-prompt">&gt;</span>
                  <span className="results-line__text">{line.text}</span>
                </>
              ) : (
                <span className="results-line__text">{line.text}</span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="results-body">{submitBody}</div>
      )}
    </div>
  );
}
