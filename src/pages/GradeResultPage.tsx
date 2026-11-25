import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Home, Sparkles } from 'lucide-react';
import {
  loadGradeResult,
  type GradeResultSnapshot,
} from '@/lib/gradeResultStore';
import { formatDurationMs } from '@/lib/examActivityLog';
import type { GradeItem, GradeStatus } from '@/lib/examGrade';
import { askGradeCoach } from '@/lib/ai/gradeCoach';
import { renderMarkdown } from '@/lib/markdown';

function statusLabel(s: GradeStatus): string {
  switch (s) {
    case 'pass':
      return '정답';
    case 'fail':
      return '오답';
    case 'partial':
      return '부분';
    case 'unsubmitted':
      return '미제출';
    case 'ungradable':
      return '채점불가';
    default:
      return s;
  }
}

function tabLabel(tab: string): string {
  if (tab === 'code') return '코드';
  if (tab === 'short') return '단답';
  return tab;
}

export default function GradeResultPage() {
  const [snap, setSnap] = useState<GradeResultSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [coachBusyId, setCoachBusyId] = useState<string | null>(null);
  const [coachReply, setCoachReply] = useState<Record<string, string>>({});
  const [coachError, setCoachError] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void loadGradeResult().then((data) => {
      if (cancelled) return;
      setSnap(data);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const askCoach = async (item: GradeItem) => {
    setCoachBusyId(item.quizId);
    setCoachError((prev) => {
      const next = { ...prev };
      delete next[item.quizId];
      return next;
    });
    try {
      const reply = await askGradeCoach(item);
      setCoachReply((prev) => ({ ...prev, [item.quizId]: reply }));
    } catch (err) {
      setCoachError((prev) => ({
        ...prev,
        [item.quizId]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setCoachBusyId(null);
    }
  };

  if (!ready) {
    return <div className="storage-boot">채점 리포트 불러오는 중…</div>;
  }

  if (!snap) {
    return (
      <div className="home-page">
        <div className="home-card">
          <h1>채점 리포트 없음</h1>
          <p>아직 채점한 결과가 없습니다. 시험에서 채점을 실행하세요.</p>
          <div className="home-actions">
            <Link className="primary-btn home-btn" to="/exam">
              시험 화면
            </Link>
            <Link className="ghost-btn home-btn" to="/">
              홈
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { report, activity } = snap;
  const pct =
    report.max > 0
      ? Math.round((report.earned / report.max) * 1000) / 10
      : 0;

  return (
    <div className="grade-report-page">
      <header className="grade-report-page__header">
        <div>
          <h1>채점 리포트</h1>
          <p className="edit-page__sub">
            {snap.examTitle} ·{' '}
            {new Date(snap.gradedAt).toLocaleString('ko-KR')}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link className="ghost-btn btn-with-icon" to="/exam">
            <ArrowLeft size={16} />
            시험으로
          </Link>
          <Link className="ghost-btn btn-with-icon" to="/">
            <Home size={16} />
            홈
          </Link>
        </div>
      </header>

      <section className="grade-report-summary edit-card">
        <div className="grade-report-summary__score">
          <strong>
            {report.earned}/{report.max}점
          </strong>
          <span>({pct}%)</span>
        </div>
        <ul className="grade-report-summary__meta">
          <li>
            총 응시 시간 <strong>{formatDurationMs(snap.elapsedMs)}</strong>
          </li>
          <li>
            문제 체류 합계{' '}
            <strong>{formatDurationMs(activity.totalFocusMs)}</strong>
          </li>
          {report.unsubmittedCount > 0 ? (
            <li>미제출 {report.unsubmittedCount}건 포함</li>
          ) : null}
        </ul>
      </section>

      <section className="grade-report-items">
        <h2>문항별 결과</h2>
        {report.items.map((item) => (
          <article
            key={item.quizId}
            className={`grade-report-card grade-report-card--${item.status}`}
          >
            <header className="grade-report-card__head">
              <span className="grade-result-item__badge">
                {statusLabel(item.status)}
              </span>
              <strong>
                {item.taskType ? `제${item.taskType}유형 · ` : ''}
                {item.title}
              </strong>
              <span className="grade-result-item__score">
                {item.earned}/{item.max}
              </span>
            </header>

            {item.markdown?.trim() ? (
              <div
                className="grade-report-card__md md-content"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(item.markdown),
                }}
              />
            ) : null}

            {item.answers?.length ? (
              <div className="grade-report-answers">
                <h3>정답 · 제출</h3>
                <table>
                  <thead>
                    <tr>
                      <th>항목</th>
                      <th>정답</th>
                      <th>내 제출</th>
                      <th>결과</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.answers.map((row) => (
                      <tr
                        key={`${item.quizId}-${row.label}`}
                        className={
                          row.ok
                            ? 'grade-report-answers__ok'
                            : 'grade-report-answers__bad'
                        }
                      >
                        <td>{row.label}</td>
                        <td>
                          <code>{row.expected || '—'}</code>
                        </td>
                        <td>
                          <code>{row.submitted || '(미입력)'}</code>
                        </td>
                        <td>{row.ok ? '정답' : '오답'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {item.type2Score ? (
              <div className="grade-report-type2">
                <h3>제2유형 점수</h3>
                <ul>
                  <li>
                    유형{' '}
                    <code>{item.type2Score.mlKind}</code>
                    {' · '}
                    지표 <code>{item.type2Score.label}</code>
                    {' '}
                    (
                    {item.type2Score.direction === 'higher'
                      ? '높을수록 좋음'
                      : item.type2Score.direction === 'lower'
                        ? '낮을수록 좋음'
                        : '방향 미상'}
                    )
                  </li>
                  <li>
                    제출 모델 지표 (STUDENT){' '}
                    <strong>
                      {item.type2Score.achieved != null
                        ? item.type2Score.achieved
                        : '—'}
                    </strong>
                  </li>
                  <li>
                    정답 모델 지표 (REF){' '}
                    <strong>
                      {item.type2Score.expected != null
                        ? item.type2Score.expected
                        : '—'}
                    </strong>
                  </li>
                  {item.type2Score.yScale != null ? (
                    <li>
                      타깃 스케일 (Y_SCALE){' '}
                      <strong>{item.type2Score.yScale}</strong>
                    </li>
                  ) : null}
                  <li>
                    오차{' '}
                    <strong>
                      {item.type2Score.gap != null
                        ? item.type2Score.gap
                        : '—'}
                    </strong>
                    {item.type2Score.gapBasis === 'perfect'
                      ? ' (만점 기준 대비)'
                      : item.type2Score.gapBasis === 'expected'
                        ? ' (|REF − STUDENT|)'
                        : ''}
                  </li>
                  <li>
                    구간 채점{' '}
                    <code>{item.type2Score.bandSource ?? 'ratio'}</code>
                    {item.type2Score.pointsBeforePenalty != null
                      ? ` · 구간점수 ${item.type2Score.pointsBeforePenalty}/${item.max}`
                      : ''}
                  </li>
                  <li>
                    최종 점수{' '}
                    <strong>
                      {item.earned}/{item.max}
                      {item.type2Score.fullCredit ? ' · 만점 구간' : ''}
                    </strong>
                    {' '}
                    (형식 감점은 구간점수에서 차감)
                  </li>
                </ul>
                {item.submittedCsvPreview ? (
                  <pre className="grade-report-pre">
                    {item.submittedCsvPreview}
                  </pre>
                ) : null}
              </div>
            ) : null}

            {item.detail ? (
              <pre className="grade-report-pre grade-report-pre--muted">
                {item.detail}
              </pre>
            ) : null}

            {item.status !== 'pass' ? (
              <div className="grade-report-coach">
                <button
                  type="button"
                  className="ghost-btn btn-with-icon"
                  disabled={coachBusyId === item.quizId}
                  onClick={() => void askCoach(item)}
                >
                  <Sparkles size={15} />
                  {coachBusyId === item.quizId
                    ? 'AI 분석 중…'
                    : 'AI에게 왜 틀렸는지 묻기'}
                </button>
                {coachError[item.quizId] ? (
                  <p className="edit-page__sub" role="alert">
                    {coachError[item.quizId]}
                  </p>
                ) : null}
                {coachReply[item.quizId] ? (
                  <div
                    className="grade-report-coach__reply md-content"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(coachReply[item.quizId]),
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="grade-report-log edit-card">
        <h2>시험 활동 로그</h2>
        <h3>문제별 요약</h3>
        {!activity.byQuiz.length ? (
          <p className="edit-page__sub">기록된 체류 로그가 없습니다.</p>
        ) : (
          <table className="grade-report-log-table">
            <thead>
              <tr>
                <th>문제</th>
                <th>체류</th>
                <th>탭</th>
                <th>실행</th>
                <th>제출</th>
              </tr>
            </thead>
            <tbody>
              {activity.byQuiz.map((q) => (
                <tr key={q.quizId}>
                  <td>{q.title}</td>
                  <td>{formatDurationMs(q.focusMs)}</td>
                  <td>
                    {Object.entries(q.tabMs)
                      .map(
                        ([tab, ms]) =>
                          `${tabLabel(tab)} ${formatDurationMs(ms)}`,
                      )
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    {q.runCount}회 / {formatDurationMs(q.runMs)}
                  </td>
                  <td>{q.submitCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>타임라인</h3>
        <ol className="grade-report-timeline">
          {activity.events.map((e, i) => (
            <li key={`${e.type}-${e.at}-${i}`}>
              <time dateTime={new Date(e.at).toISOString()}>
                {new Date(e.at).toLocaleTimeString('ko-KR')}
              </time>
              <span>
                {e.type}
                {e.title ? ` · ${e.title}` : ''}
                {e.tab ? ` · ${tabLabel(e.tab)}` : ''}
                {e.durationMs != null
                  ? ` · ${formatDurationMs(e.durationMs)}`
                  : ''}
                {e.ok === false ? ' · fail' : e.ok ? ' · ok' : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
