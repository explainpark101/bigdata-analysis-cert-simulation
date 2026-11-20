import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@/context/ThemeContext';
import { ProjectProvider } from '@/context/ProjectContext';
import { ExamSessionProvider } from '@/context/ExamSessionContext';
import { RuntimeProvider } from '@/context/RuntimeContext';
import HomePage from '@/pages/HomePage';
import ProjectPage from '@/pages/ProjectPage';
import ExamPickPage from '@/pages/ExamPickPage';
import ExamPage from '@/pages/ExamPage';

export default function App() {
  return (
    <ThemeProvider>
      <RuntimeProvider>
        <ProjectProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/project" element={<ProjectPage />} />
              <Route path="/project/exam-pick" element={<ExamPickPage />} />
              <Route
                path="/exam"
                element={
                  <ExamSessionProvider>
                    <ExamPage />
                  </ExamSessionProvider>
                }
              />
              <Route path="/edit" element={<Navigate to="/project" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ProjectProvider>
      </RuntimeProvider>
    </ThemeProvider>
  );
}
