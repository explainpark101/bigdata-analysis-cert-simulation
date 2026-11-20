import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Download,
  Moon,
  Play,
  Settings,
  Sun,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useProject } from '@/context/ProjectContext';
import { GlobalSettingsModal } from '@/components/settings/GlobalSettingsModal';

export default function HomePage() {
  const { theme, toggleTheme } = useTheme();
  const {
    project,
    selectExam,
    exportExamPackage,
    pushExamToSession,
  } = useProject();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openExam = async (examId: string) => {
    setBusyId(examId);
    try {
      selectExam(examId);
      await pushExamToSession(examId);
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
      <div className="home-card home-card--wide">
        <h1>박재형 빅분기 실기 연습</h1>
        <p>
          빅데이터분석기사 시험환경을 체험하여 커스텀 시험을 응시할 수 있습니다.
        </p>
        <div className="home-actions">
          <Link className="primary-btn home-btn" to="/project">
            프로젝트 편집 / 시험 만들기
            <span>CSV · 문제은행 · 시험지 조립 · .project.zip</span>
          </Link>
          <Link className="ghost-btn home-btn" to="/exam">
            시험보기
            <span>.exam.zip 불러오기 · 현재 세션 이어하기</span>
          </Link>
        </div>

        <section className="home-exam-library">
          <div className="home-exam-library__head">
            <h2>저장된 시험지</h2>
            <span className="badge">{project.exams.length}</span>
          </div>
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
                      <Play size={15} />
                      시험 보기
                    </button>
                    <button
                      type="button"
                      className="ghost-btn btn-with-icon"
                      disabled={busyId === ex.id}
                      onClick={() => void exportOne(ex.id)}
                    >
                      <Download size={15} />
                      내보내기
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {message ? <p className="edit-toast">{message}</p> : null}
      </div>

      <GlobalSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
