import { useCallback, useEffect, useState } from 'react';
import {
  EXAM_UI_SETTINGS_EVENT,
  loadExamUiSettings,
  saveExamUiSettings,
  type ExamUiSettings,
} from '@/lib/examUiSettings';

/** Shared exam/editor UI prefs (localStorage). Editor line-height defaults to 150%. */
export function useExamUiSettings() {
  const [settings, setSettings] = useState<ExamUiSettings>(() =>
    loadExamUiSettings(),
  );

  useEffect(() => {
    const refresh = () => setSettings(loadExamUiSettings());
    window.addEventListener(EXAM_UI_SETTINGS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EXAM_UI_SETTINGS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const update = useCallback((next: ExamUiSettings) => {
    saveExamUiSettings(next);
    setSettings(loadExamUiSettings());
  }, []);

  return { settings, update, reload: () => setSettings(loadExamUiSettings()) };
}
