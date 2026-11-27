import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Home, Settings, Sparkles } from 'lucide-react';
import {
  loadGradeResult,
  loadGradeResultById,
  type GradeResultSnapshot,
} from '@/lib/gradeResultStore';
import { formatDurationMs } from '@/lib/examActivityLog';
import {
  formatLocalDateTime,
  toDateTimeAttr,
} from '@/lib/formatLocalTime';
import type { GradeItem, GradeStatus } from '@/lib/examGrade';
import { renderMarkdown } from '@/lib/markdown';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import { GradeChatDock } from '@/components/results/GradeChatDock';
import { GlobalSettingsModal } from '@/components/settings/GlobalSettingsModal';
import {
  getGradeProgress,
  gradeProgressRatio,
  subscribeGradeProgress,
  type GradeProgressState,
} from '@/lib/gradeProgressStore';

const CODE_W_DEFAULT = 420;
const CODE_W_MIN = 260;
const COACH_W_DEFAULT = 380;
const COACH_W_MIN = 280;

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

function itemHeading(item: GradeItem): string {
  return `${item.taskType ? `제${item.taskType}유형 · ` : ''}${item.title}`;
}

function GradeLoadingScreen({ progress }: { progress: GradeProgressState }) {
  const progressId = useId();
  const ratio = gradeProgressRatio(progress);
  const pct = Math.round(ratio * 100);
  const determinate = progress.total > 0 && progress.phase === 'running';
  const stepText =
    progress.total > 0
      ? `${Math.min(progress.current + (progress.phase === 'done' ? 0 : 1), progress.total)} / ${progress.total}`
      : '';

  return (
    <div className="grade-loading" role="status" aria-live="polite">
      <div className="grade-loading__card">
        <p className="grade-loading__eyebrow">채점</p>
        <h1 className="grade-loading__title">채점하는 중</h1>
        <p className="grade-loading__sub">
          {progress.examTitle
            ? `${progress.examTitle} · 잠시만 기다려 주세요.`
            : '답안을 채점하고 있습니다. 잠시만 기다려 주세요.'}
        </p>
        <label className="grade-loading__label" htmlFor={progressId}>
          {progress.label || '채점 중…'}
          {stepText ? <span className="grade-loading__step">{stepText}</span> : null}
        </label>
        <progress
          id={progressId}
          className="grade-loading__progress"
          max={100}
          {...(determinate || progress.phase === 'done'
            ? { value: pct }
            : {})}
        />
        <p className="grade-loading__pct" aria-hidden="true">
          {determinate || progress.phase === 'done' ? `${pct}%` : '준비 중'}
        </p>
      </div>
    </div>
  );
}

export default function GradeResultPage() {
  const [searchParams] = useSearchParams();
  const resultId = searchParams.get('id')?.trim() || null;
  const [snap, setSnap] = useState<GradeResultSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<GradeProgressState>(() =>
    getGradeProgress(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [codeWidth, setCodeWidth] = useState(CODE_W_DEFAULT);
  const [coachWidth, setCoachWidth] = useState(COACH_W_DEFAULT);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachQuizId, setCoachQuizId] = useState<string | null>(null);
  const [coachAskNonce, setCoachAskNonce] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => subscribeGradeProgress(setProgress), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = resultId
        ? await loadGradeResultById(resultId)
        : await loadGradeResult();
      if (cancelled) return;
      setSnap(data);
      setSelectedId((prev) => prev ?? data?.report.items[0]?.quizId ?? null);
      setReady(true);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [resultId]);

  // When grading finishes, reload the saved snapshot (latest, not a pinned id).
  useEffect(() => {
    if (resultId) return;
    if (progress.phase !== 'done' && progress.phase !== 'error') return;
    let cancelled = false;
    void loadGradeResult().then((data) => {
      if (cancelled) return;
      setSnap(data);
      setSelectedId(data?.report.items[0]?.quizId ?? null);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [progress.phase, progress.updatedAt, resultId]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const maxCodeWidth = useMemo(() => {
    if (typeof window === 'undefined') return 720;
    return Math.max(CODE_W_MIN, Math.floor(window.innerWidth * 0.55));
  }, []);

  const maxCoachWidth = useMemo(() => {
    if (typeof window === 'undefined') return 560;
    return Math.max(COACH_W_MIN, Math.floor(window.innerWidth * 0.45));
  }, []);

  const openCoach = (item: GradeItem) => {
    setCoachQuizId(item.quizId);
    setSelectedId(item.quizId);
    setCoachOpen(true);
    setCoachAskNonce((n) => n + 1);
  };

  if (progress.phase === 'running') {
    return <GradeLoadingScreen progress={progress} />;
  }

  if (!ready) {
    return <div className="storage-boot">채점 리포트 불러오는 중…</div>;
  }

  if (!snap) {
    return (
      <div className="home-page">
        <div className="home-card">
          <h1>채점 리포트 없음</h1>
          <p>
            {resultId
              ? '요청한 채점 기록을 찾을 수 없습니다. 홈의 최근 채점 목록을 확인하세요.'
              : '아직 채점한 결과가 없습니다. 시험에서 채점을 실행하세요.'}
          </p>
          <div className="home-actions">
            <Link className="primary-btn home-btn" to="/">
              홈
            </Link>
            <Link className="ghost-btn home-btn" to="/exam">
              시험 화면
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
  const selected =
    report.items.find((i) => i.quizId === selectedId) ?? report.items[0];
  const coachItem =
    report.items.find((i) => i.quizId === coachQuizId) ?? selected;

  return (
    <div className="grade-report-page">
      <header className="grade-report-page__header">
        <div>
          <h1>채점 리포트</h1>
          <p className="edit-page__sub">
            {snap.examTitle} ·{' '}
            <time dateTime={toDateTimeAttr(snap.gradedAt)}>
              {formatLocalDateTime(snap.gradedAt)}
            </time>
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="ghost-btn btn-with-icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="AI · 전역 설정"
          >
            <Settings size={16} />
            AI 설정
          </button>
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

      <div
        className={`grade-report-body${coachOpen ? ' grade-report-body--with-dock' : ''}`}
      >
        <div
          className={`grade-report-split${narrow ? ' grade-report-split--narrow' : ''}`}
        >
          <aside
            className="grade-report-split__code"
            style={narrow ? undefined : { width: codeWidth }}
          >
            <h2>내 코드</h2>
            <div className="grade-report-split__scroll">
              {report.items.map((item) => {
                const active = item.quizId === selected?.quizId;
                const pythonCode =
                  item.userCodes?.python?.trim() ||
                  (item.language === 'python'
                    ? item.userCode?.trim()
                    : '') ||
                  '';
                const rCode =
                  item.userCodes?.r?.trim() ||
                  (item.language === 'r' ? item.userCode?.trim() : '') ||
                  '';
                return (
                  <button
                    key={`code-${item.quizId}`}
                    type="button"
                    className={`grade-report-code-card grade-report-card--${item.status}${active ? ' is-active' : ''}`}
                    onClick={() => setSelectedId(item.quizId)}
                  >
                    <header className="grade-report-code-card__head">
                      <span className="grade-result-item__badge">
                        {statusLabel(item.status)}
                      </span>
                      <strong>{itemHeading(item)}</strong>
                      <span className="grade-report-code-card__lang">
                        python · r
                      </span>
                    </header>
                    <div className="grade-report-code-card__langs">
                      <div className="grade-report-code-card__block">
                        <span className="grade-report-code-card__lang-label">
                          python
                        </span>
                        <pre className="grade-report-code-card__pre">
                          <code>{pythonCode || '(코드 없음)'}</code>
                        </pre>
                      </div>
                      <div className="grade-report-code-card__block">
                        <span className="grade-report-code-card__lang-label">
                          r
                        </span>
                        <pre className="grade-report-code-card__pre">
                          <code>{rCode || '(코드 없음)'}</code>
                        </pre>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {!narrow ? (
              <EdgeResizeHandle
                axis="x"
                value={codeWidth}
                onChange={setCodeWidth}
                min={CODE_W_MIN}
                max={maxCodeWidth}
                label="코드 패널 너비 조절"
              />
            ) : null}
          </aside>

          <section className="grade-report-split__results">
            <h2>채점 결과</h2>
            <div className="grade-report-split__scroll">
              {selected ? (
                <GradeResultDetail
                  item={selected}
                  coachOpen={
                    coachOpen && coachItem?.quizId === selected.quizId
                  }
                  onAskCoach={() => openCoach(selected)}
                />
              ) : (
                <p className="edit-page__sub">문항을 선택하세요.</p>
              )}

              <div className="grade-report-log edit-card">
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
                      <time dateTime={toDateTimeAttr(e.at)}>
                        {formatLocalDateTime(e.at)}
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
              </div>
            </div>
          </section>
        </div>

        {coachOpen && coachItem ? (
          <GradeChatDock
            open={coachOpen}
            item={coachItem}
            width={coachWidth}
            onWidthChange={setCoachWidth}
            maxWidth={maxCoachWidth}
            onClose={() => setCoachOpen(false)}
            askNonce={coachAskNonce}
          />
        ) : null}
      </div>

      <GlobalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function GradeResultDetail({
  item,
  coachOpen,
  onAskCoach,
}: {
  item: GradeItem;
  coachOpen: boolean;
  onAskCoach: () => void;
}) {
  return (
    <article
      className={`grade-report-card grade-report-card--${item.status}`}
    >
      <header className="grade-report-card__head">
        <span className="grade-result-item__badge">
          {statusLabel(item.status)}
        </span>
        <strong>{itemHeading(item)}</strong>
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
              유형 <code>{item.type2Score.mlKind}</code>
              {' · '}
              지표 <code>{item.type2Score.label}</code>{' '}
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
                {item.type2Score.gap != null ? item.type2Score.gap : '—'}
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
              </strong>{' '}
              (형식 감점은 구간점수에서 차감)
            </li>
          </ul>
          {item.submittedCsvPreview ? (
            <pre className="grade-report-pre">{item.submittedCsvPreview}</pre>
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
            onClick={onAskCoach}
          >
            <Sparkles size={15} />
            {coachOpen
              ? '채팅 Dock에서 이어서 질문'
              : 'AI에게 왜 틀렸는지 묻기'}
          </button>
        </div>
      ) : null}
    </article>
  );
}
