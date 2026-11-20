import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useProject } from '@/context/ProjectContext';
import { ExamBlueprintPicker } from '@/components/exam/ExamBlueprintPicker';

export default function ExamPickPage() {
  const { project, activeExam, selectExam, pushExamToSession } = useProject();
  const navigate = useNavigate();
  const formTitleId = useId();
  const [selectedId, setSelectedId] = useState(
    () => activeExam.id || project.exams[0]?.id || '',
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const openSelected = async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    setMessage('');
    try {
      selectExam(selectedId);
      await pushExamToSession(selectedId);
      navigate('/exam');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="home-page exam-pick-page">
      <div className="home-card home-card--wide">
        <div className="exam-pick-page__nav">
          <Link className="ghost-btn btn-with-icon" to="/project">
            <ArrowLeft size={16} />
            프로젝트로
          </Link>
        </div>

        <h1 id={formTitleId}>시험지 선택</h1>
        <p>
          이 프로젝트에 등록된 시험지 중 하나를 고른 뒤 시험 화면으로
          진행합니다.
        </p>

        <ExamBlueprintPicker
          exams={project.exams}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onSubmit={() => void openSelected()}
          busy={busy}
          labelledBy={formTitleId}
          emptyMessage="등록된 시험지가 없습니다. 프로젝트 편집에서 시험지를 추가하세요."
        />

        {message ? (
          <p className="edit-page__sub" style={{ marginTop: 12 }}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
