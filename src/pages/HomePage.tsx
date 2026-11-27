import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Download,
  FolderKanban,
  FolderOpen,
  Library,
  Moon,
  Play,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useProject } from '@/context/ProjectContext';
import { useExamSession } from '@/context/ExamSessionContext';
import { GlobalSettingsModal } from '@/components/settings/GlobalSettingsModal';
import { ConfirmModal } from '@/components/exam/ConfirmModal';
import { EdgeResizeHandle } from '@/components/layout/EdgeResizeHandle';
import {
  clearGradeResult,
  loadGradeResultHistory,
  removeGradeResultFromHistory,
  type GradeResultSnapshot,
} from '@/lib/gradeResultStore';
import {
  clearActivityEvents,
  formatDurationMs,
} from '@/lib/examActivityLog';
import {
  formatLocalDateTime,
  toDateTimeAttr,
} from '@/lib/formatLocalTime';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const SIDE_W_DEFAULT = 400;
const SIDE_W_MIN = 280;

export default function HomePage() {
  const { theme, toggleTheme } = useTheme();
  const {
    project,
    selectExam,
    exportExamPackage,
    pushExamToSession,
    importProjectSources,
  } = useProject();
  const { exam, clear, importExamZip, setExam } = useExamSession();
  const navigate = useNavigate();
  const projectZipRef = useRef<HTMLInputElement>(null);
  const examZipRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [gradeHistory, setGradeHistory] = useState<GradeResultSnapshot[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [sideWidth, setSideWidth] = useState(SIDE_W_DEFAULT);
  const narrow = useMediaQuery('(max-width: 900px)');

  const maxSideWidth = useMemo(() => {
    if (typeof window === 'undefined') return 640;
    return Math.max(SIDE_W_MIN, Math.floor(window.innerWidth * 0.55));
  }, [narrow]);

  useEffect(() => {
    let cancelled = false;
    void loadGradeResultHistory().then((rows) => {
      if (cancelled) return;
      setGradeHistory(rows);
      setHistoryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshGradeHistory = async () => {
    const rows = await loadGradeResultHistory();
    setGradeHistory(rows);
    setHistoryReady(true);
  };

  const openExam = async (examId: string) => {
    setBusyId(examId);
    try {
      selectExam(examId);
      const next = await pushExamToSession(examId);
      setExam(next);
      navigate('/exam');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setBusyId(null);
    }
  };

  const exportOne = async (examId: string) => {
    setBusyId(examId);
    try {
      await exportExamPackage(examId);
      const title =
        project.exams.find((e) => e.id === examId)?.title ?? '시험지';
      setMessage(`내보냄: ${title}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const resetSession = async () => {
    setClearBusy(true);
    try {
      const examId = exam?.id;
      clear();
      await clearGradeResult();
      if (examId) clearActivityEvents(examId);
      setClearConfirmOpen(false);
      setMessage(
        '시험 세션을 초기화했습니다. 최근 채점 기록은 홈에 그대로 남습니다.',
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setClearBusy(false);
    }
  };

  const removeHistoryItem = async (id: string | undefined) => {
    if (!id) return;
    setBusyId(`grade-${id}`);
    try {
      await removeGradeResultFromHistory(id);
      await refreshGradeHistory();
      setMessage('채점 기록을 삭제했습니다.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const scoreLabel = (snap: GradeResultSnapshot) => {
    const { earned, max } = snap.report;
    const pct =
      max > 0 ? Math.round((earned / max) * 1000) / 10 : 0;
    return max > 0 ? `${earned}/${max}점 (${pct}%)` : `${earned}/${max}점`;
  };

  const openProjectZips = async (sources: Array<File | string>) => {
    setBusyId('project-zip');
    try {
      const result = await importProjectSources(sources);
      setMessage(
        result.merged
          ? `프로젝트 병합 로드: ${result.labels.join(', ')}`
          : `프로젝트 로드: ${result.labels[0]}`,
      );
      navigate('/project');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const openExamZip = async (file: File) => {
    setBusyId('exam-zip');
    try {
      await importExamZip(file);
      setMessage(`시험지 로드: ${file.name}`);
      navigate('/exam');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="home-page">
      <div className="home-top-actions">
        <button
          type="button"
          className="ghost-btn btn-with-icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="전역 설정"
        >
          <Settings size={16} />
          설정
        </button>
        <button
          type="button"
          className="ghost-btn btn-with-icon"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {theme === 'dark' ? '라이트' : '다크'}
        </button>
      </div>

      <div
        className={`home-split${narrow ? ' home-split--narrow' : ''}`}
      >
        <div className="home-main-pane">
          <div className="home-scroll-stack">
            <article className="home-section-card">
              <header className="home-section-card__head">
                <span className="home-section-card__icon" aria-hidden="true">
                  <FolderKanban size={18} />
                </span>
                <div className="home-section-card__titles">
                  <h1>박재형 빅분기 실기 연습</h1>
                  <p>
                    제13회 가이드 기준(6문항 · 180분 · 실행 1분)으로 실기 환경을
                    체험할 수 있습니다.
                  </p>
                </div>
              </header>
              <div className="home-actions">
                <Link className="primary-btn home-btn" to="/project">
                  <span className="home-btn__row">
                    <FolderKanban size={16} aria-hidden="true" />
                    프로젝트 편집 / 시험 만들기
                  </span>
                  <span>CSV · 문제은행 · 시험지 조립 · .project.zip</span>
                </Link>
                <Link className="ghost-btn home-btn" to="/exam">
                  <span className="home-btn__row">
                    <Play size={16} aria-hidden="true" />
                    시험보기
                  </span>
                  <span>.exam.zip 불러오기 · 현재 세션 이어하기</span>
                </Link>
                <button
                  type="button"
                  className="ghost-btn home-btn"
                  disabled={busyId === 'project-zip'}
                  onClick={() => {
                    // HTML file picker only — Tauri JS dialog plugin OOMs before paint.
                    projectZipRef.current?.click();
                  }}
                >
                  <span className="home-btn__row">
                    <FolderOpen size={16} aria-hidden="true" />
                    다른 프로젝트 열기
                  </span>
                  <span>.project.zip 불러와 프로젝트 화면으로 이동</span>
                </button>
                <button
                  type="button"
                  className="ghost-btn home-btn"
                  disabled={busyId === 'exam-zip'}
                  onClick={() => examZipRef.current?.click()}
                >
                  <span className="home-btn__row">
                    <Upload size={16} aria-hidden="true" />
                    다른 시험지 열기
                  </span>
                  <span>.exam.zip 불러와 시험 세션으로 이동</span>
                </button>
                <button
                  type="button"
                  className="danger-btn home-btn"
                  onClick={() => setClearConfirmOpen(true)}
                >
                  <span className="home-btn__row">
                    <RotateCcw size={16} aria-hidden="true" />
                    세션 초기화
                  </span>
                  <span>현재 시험 세션만 비우기 (최근 채점 기록 유지)</span>
                </button>
              </div>
              {message ? <p className="edit-toast">{message}</p> : null}
            </article>

            <article className="home-section-card">
              <header className="home-section-card__head">
                <span className="home-section-card__icon" aria-hidden="true">
                  <Library size={18} />
                </span>
                <div className="home-section-card__titles">
                  <h2>저장된 시험지</h2>
                </div>
                <span className="badge">{project.exams.length}</span>
              </header>
              {!project.exams.length ? (
                <p className="edit-page__sub">
                  아직 시험지가 없습니다. 프로젝트에서 시험지를 만드세요.
                </p>
              ) : (
                <ul className="home-exam-list">
                  {project.exams.map((ex) => (
                    <li key={ex.id} className="home-exam-item">
                      <div className="home-exam-item__meta">
                        <strong>{ex.title}</strong>
                        <span>
                          문제 {ex.problemIds.length}개
                          {ex.description?.trim()
                            ? ` · ${ex.description.trim()}`
                            : ''}
                        </span>
                      </div>
                      <div className="home-exam-item__actions">
                        <button
                          type="button"
                          className="primary-btn btn-with-icon"
                          disabled={busyId === ex.id}
                          onClick={() => void openExam(ex.id)}
                        >
                          <Play size={15} aria-hidden="true" />
                          시험 보기
                        </button>
                        <button
                          type="button"
                          className="ghost-btn btn-with-icon"
                          disabled={busyId === ex.id}
                          onClick={() => void exportOne(ex.id)}
                        >
                          <Download size={15} aria-hidden="true" />
                          내보내기
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        </div>

        <aside
          className="home-side-pane"
          style={narrow ? undefined : { width: sideWidth }}
          aria-label="최근 채점 결과"
        >
          {!narrow ? (
            <EdgeResizeHandle
              axis="x"
              value={sideWidth}
              onChange={setSideWidth}
              min={SIDE_W_MIN}
              max={maxSideWidth}
              invert
              label="홈 사이드 패널 너비 조절"
            />
          ) : null}
          <article className="home-section-card home-section-card--fill">
            <header className="home-section-card__head">
              <span className="home-section-card__icon" aria-hidden="true">
                <ClipboardList size={18} />
              </span>
              <div className="home-section-card__titles">
                <h2>최근 채점 결과</h2>
              </div>
              <span className="badge">{gradeHistory.length}</span>
            </header>
            <div className="home-section-card__body">
              {!historyReady ? (
                <p className="edit-page__sub">불러오는 중…</p>
              ) : !gradeHistory.length ? (
                <p className="edit-page__sub">
                  아직 저장된 채점 결과가 없습니다. 시험에서 채점을 실행하면
                  여기에 쌓입니다.
                </p>
              ) : (
                <ol className="home-exam-list home-grade-list">
                  {gradeHistory.map((snap) => {
                    const id =
                      snap.id ?? `${snap.examId}-${snap.gradedAt}`;
                    const href = snap.id
                      ? `/exam/result?id=${encodeURIComponent(snap.id)}`
                      : '/exam/result';
                    return (
                      <li key={id} className="home-exam-item">
                        <div className="home-exam-item__meta">
                          <strong>{snap.examTitle || '채점 리포트'}</strong>
                          <span>
                            {scoreLabel(snap)}
                            {' · '}
                            응시 {formatDurationMs(snap.elapsedMs)}
                            {' · '}
                            <time dateTime={toDateTimeAttr(snap.gradedAt)}>
                              {formatLocalDateTime(snap.gradedAt)}
                            </time>
                          </span>
                        </div>
                        <div className="home-exam-item__actions">
                          <Link
                            className="primary-btn btn-with-icon"
                            to={href}
                          >
                            <ClipboardList size={15} aria-hidden="true" />
                            리포트
                          </Link>
                          {snap.id ? (
                            <button
                              type="button"
                              className="ghost-btn btn-with-icon"
                              disabled={busyId === `grade-${snap.id}`}
                              aria-label={`${snap.examTitle} 채점 기록 삭제`}
                              onClick={() =>
                                void removeHistoryItem(snap.id)
                              }
                            >
                              <Trash2 size={15} aria-hidden="true" />
                              삭제
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </article>
        </aside>
      </div>

      <input
        ref={projectZipRef}
        className="hidden-file"
        type="file"
        accept=".zip,application/zip,.project.zip"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void openProjectZips(files);
        }}
      />
      <input
        ref={examZipRef}
        className="hidden-file"
        type="file"
        accept=".zip,application/zip,.exam.zip"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void openExamZip(file);
        }}
      />

      <ConfirmModal
        open={clearConfirmOpen}
        title="세션 초기화"
        message={
          '현재 시험 세션을 비울까요?\n진행 중인 답안·제출 상태는 사라집니다.\n홈의 최근 채점 기록은 유지됩니다.'
        }
        cancelLabel="취소"
        confirmLabel="세션 초기화"
        confirmDanger
        busy={clearBusy}
        onCancel={() => {
          if (!clearBusy) setClearConfirmOpen(false);
        }}
        onConfirm={() => void resetSession()}
      />

      <GlobalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
