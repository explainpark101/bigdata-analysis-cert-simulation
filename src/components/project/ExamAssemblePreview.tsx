import { useMemo, useState } from 'react';
import { CheckCircle2, Pencil, Play, XCircle } from 'lucide-react';
import { renderMarkdown } from '@/lib/markdown';
import { ensureShortAnswersForSubQuestions } from '@/lib/subQuestions';
import {
  verifyBankProblemAnswer,
  type BankProblemVerifyResult,
} from '@/lib/verifyBankProblem';
import type { AuthoringProject, BankProblem } from '@/types/project';

interface ExamAssemblePreviewProps {
  project: AuthoringProject;
  problemIds: string[];
  onEditInBank: (problemId: string) => void;
}

type VerifyState =
  | { status: 'idle' }
  | { status: 'running' }
  | ({ status: 'done' } & BankProblemVerifyResult);

function expectedShorts(problem: BankProblem): string[] {
  if (problem.taskType === 2 || problem.submitFormat === 'csv') return [];
  return ensureShortAnswersForSubQuestions(
    problem.markdown,
    problem.shortAnswers,
    problem.shortAnswer,
    problem.taskType,
  ).map((s) => s.trim());
}

function PreviewCard({
  problem,
  project,
  index,
  onEditInBank,
}: {
  problem: BankProblem;
  project: AuthoringProject;
  index: number;
  onEditInBank: (id: string) => void;
}) {
  const [verify, setVerify] = useState<VerifyState>({ status: 'idle' });
  const html = useMemo(
    () => renderMarkdown(problem.markdown),
    [problem.markdown],
  );
  const expected = expectedShorts(problem);
  const type2 = problem.taskType === 2 || problem.submitFormat === 'csv';
  const lang = problem.language;
  const answerCode =
    lang === 'python'
      ? problem.answerCode?.python ?? ''
      : problem.answerCode?.r ?? '';

  const runVerify = async () => {
    if (verify.status === 'running') return;
    setVerify({ status: 'running' });
    const result = await verifyBankProblemAnswer(project, problem);
    setVerify({ status: 'done', ...result });
  };

  return (
    <article className="exam-preview-card" id={`exam-preview-${problem.id}`}>
      <header className="exam-preview-card__head">
        <div>
          <div className="exam-preview-card__eyebrow">
            #{index + 1} · 제{problem.taskType}유형
            {problem.number ? ` · ${problem.number}` : ''}
          </div>
          <h3 className="exam-preview-card__title">{problem.title}</h3>
        </div>
        <div className="exam-preview-card__actions">
          {!type2 ? (
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={verify.status === 'running'}
              onClick={() => void runVerify()}
            >
              <Play size={14} />
              {verify.status === 'running' ? '실행…' : '정답 검증'}
            </button>
          ) : (
            <button
              type="button"
              className="ghost-btn btn-with-icon"
              disabled={verify.status === 'running'}
              onClick={() => void runVerify()}
              title="답안 코드 미리 실행 (단답 비교 없음)"
            >
              <Play size={14} />
              {verify.status === 'running' ? '실행…' : '코드 실행'}
            </button>
          )}
          <button
            type="button"
            className="primary-btn btn-with-icon"
            onClick={() => onEditInBank(problem.id)}
          >
            <Pencil size={14} />
            수정하기
          </button>
        </div>
      </header>

      <div
        className="exam-preview-card__md md-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <div className="exam-preview-card__answers">
        {type2 ? (
          <p className="edit-page__sub" style={{ margin: 0 }}>
            작업형 2유형 · CSV 제출 · 단답 없음
            {problem.submitFile ? ` · ${problem.submitFile}` : ''}
          </p>
        ) : (
          <div>
            <strong className="exam-preview-card__label">단답 정답</strong>
            {expected.length ? (
              <ol className="exam-preview-card__shorts">
                {expected.map((a, i) => (
                  <li key={`${problem.id}-e-${i}`}>
                    <code>{a}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="edit-page__sub" style={{ margin: '4px 0 0' }}>
                (단답 미설정)
              </p>
            )}
          </div>
        )}

        <div>
          <strong className="exam-preview-card__label">
            코드 답안 ({lang})
          </strong>
          {answerCode.trim() ? (
            <pre className="exam-preview-card__code">{answerCode}</pre>
          ) : (
            <p className="edit-page__sub" style={{ margin: '4px 0 0' }}>
              (코드 답안 없음)
            </p>
          )}
        </div>
      </div>

      {verify.status === 'done' ? (
        <div
          className={`exam-preview-verify ${
            verify.match === true
              ? 'exam-preview-verify--ok'
              : verify.match === false
                ? 'exam-preview-verify--bad'
                : verify.ok
                  ? 'exam-preview-verify--ok'
                  : 'exam-preview-verify--bad'
          }`}
          role="status"
        >
          <div className="exam-preview-verify__summary">
            {verify.match === true ? (
              <>
                <CheckCircle2 size={16} />
                단답과 실행 결과가 일치합니다.
              </>
            ) : verify.match === false ? (
              <>
                <XCircle size={16} />
                단답과 실행 결과가 다릅니다.
              </>
            ) : verify.ok ? (
              <>
                <CheckCircle2 size={16} />
                코드 실행 성공
              </>
            ) : (
              <>
                <XCircle size={16} />
                코드 실행 실패
              </>
            )}
          </div>
          {!type2 && expected.length ? (
            <div className="exam-preview-verify__cmp">
              <div>
                <span>기대</span>
                <code>{verify.expected.join(' | ') || '(없음)'}</code>
              </div>
              <div>
                <span>실행(끝부분)</span>
                <code>
                  {(verify.got
                    .slice(-Math.max(expected.length, 1))
                    .join(' | ') || '(없음)')}
                </code>
              </div>
            </div>
          ) : null}
          {verify.stdout ? (
            <pre className="exam-preview-verify__out">{verify.stdout}</pre>
          ) : null}
          {verify.stderr ? (
            <pre className="exam-preview-verify__err">{verify.stderr}</pre>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ExamAssemblePreview({
  project,
  problemIds,
  onEditInBank,
}: ExamAssemblePreviewProps) {
  const problems = useMemo(() => {
    const map = new Map(project.bank.map((b) => [b.id, b]));
    return problemIds
      .map((id) => map.get(id))
      .filter((b): b is BankProblem => Boolean(b));
  }, [project.bank, problemIds]);

  return (
    <aside className="exam-assemble-preview" aria-label="시험 미리보기">
      <header className="exam-assemble-preview__head">
        <h2>시험 미리보기</h2>
        <span className="badge">{problems.length}문제</span>
      </header>
      <p className="edit-page__sub exam-assemble-preview__hint">
        포함된 문항·단답·코드 답안을 확인합니다. 정답 검증은 답안 코드를 실행해
        단답과 비교합니다.
      </p>
      {!problems.length ? (
        <p className="edit-page__sub">포함된 문제가 없습니다.</p>
      ) : (
        <div className="exam-assemble-preview__list">
          {problems.map((p, i) => (
            <PreviewCard
              key={p.id}
              problem={p}
              project={project}
              index={i}
              onEditInBank={onEditInBank}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
