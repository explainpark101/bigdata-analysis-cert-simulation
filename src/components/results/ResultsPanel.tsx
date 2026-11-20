import { useState } from 'react';
import type { RunResult } from '@/types/exam';

interface ResultsPanelProps {
  result: RunResult | null;
  running: boolean;
}

type ResultTab = 'run' | 'submit' | 'test';

export function ResultsPanel({ result, running }: ResultsPanelProps) {
  const [tab, setTab] = useState<ResultTab>('run');

  let body = '실행 결과가 여기에 표시됩니다.';
  let isError = false;

  if (running) {
    body = '실행 중…';
  } else if (result) {
    if (tab === 'run') {
      body = [result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n')
        .trim() || '(출력 없음)';
      isError = !result.ok;
      if (result.durationMs != null) {
        body += `\n\n— ${result.durationMs}ms`;
      }
    } else if (tab === 'submit') {
      body = result.ok
        ? '로컬 제출 기록이 저장되었습니다. (서버 채점 없음)'
        : '실행 오류로 제출 결과가 비어 있습니다.';
    } else {
      body = '테스트 케이스는 문제 JSON의 testCases.expectIncludes 로 검사합니다.';
    }
  }

  return (
    <div className="results-panel">
      <div className="panel-tabs dark">
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
        <button
          type="button"
          className={`tab-btn ${tab === 'test' ? 'active' : ''}`}
          onClick={() => setTab('test')}
        >
          테스트 케이스
        </button>
      </div>
      <div className={`results-body ${isError ? 'error' : ''}`}>{body}</div>
    </div>
  );
}
