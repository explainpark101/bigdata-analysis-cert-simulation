import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  normalizeAiSettings,
  saveAiSettings,
  type AiEndpointSettings,
} from '@/lib/aiSettings';
import { testAiConnection } from '@/lib/ai/openaiCompatible';

interface GlobalSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSettingsModal({ open, onClose }: GlobalSettingsModalProps) {
  const [value, setValue] = useState<AiEndpointSettings>(DEFAULT_AI_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    void loadAiSettings().then(setValue);
    setStatus('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (p: Partial<AiEndpointSettings>) => {
    setValue((prev) => normalizeAiSettings({ ...prev, ...p }));
  };

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const next = normalizeAiSettings(value);
      await saveAiSettings(next);
      setValue(next);
      setStatus('저장됨');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setStatus('연결 테스트 중…');
    try {
      const next = normalizeAiSettings(value);
      await saveAiSettings(next);
      const reply = await testAiConnection(next);
      setStatus(`연결 성공 · 응답: ${reply.slice(0, 80)}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-settings-backdrop" role="presentation" onClick={onClose}>
      <div
        className="screen-settings-modal global-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="screen-settings-modal__head">
          <h2 id="global-settings-title">전역 설정</h2>
          <button
            type="button"
            className="icon-btn screen-settings-modal__close"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="screen-settings-modal__body global-settings-modal__body">
          <section className="screen-settings-col" style={{ gridColumn: '1 / -1' }}>
            <h3>AI 엔드포인트</h3>
            <p className="edit-page__sub">
              OpenAI 호환 <code>/v1/chat/completions</code> API입니다. 브라우저에서
              직접 호출하므로 엔드포인트가 CORS를 허용해야 합니다.
            </p>
            <label className="screen-settings-field">
              <span>Base URL</span>
              <input
                value={value.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                autoComplete="off"
              />
            </label>
            <label className="screen-settings-field">
              <span>API Key</span>
              <input
                type="password"
                value={value.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>
            <label className="screen-settings-field">
              <span>Model</span>
              <input
                value={value.model}
                onChange={(e) => patch({ model: e.target.value })}
                placeholder="gpt-4o-mini"
                autoComplete="off"
              />
            </label>
            {status ? (
              <p className="global-settings-status" role="status">
                {status}
              </p>
            ) : null}
          </section>
        </div>

        <footer className="screen-settings-modal__foot">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={() => void test()}
          >
            연결 테스트
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={busy}
            onClick={() => void save()}
          >
            저장
          </button>
          <button type="button" className="ghost-btn" onClick={onClose}>
            닫기
          </button>
        </footer>
      </div>
    </div>
  );
}
