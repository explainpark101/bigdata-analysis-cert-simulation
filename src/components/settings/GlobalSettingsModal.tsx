import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  PROVIDER_PRESETS,
  createProviderProfile,
  loadAiSettingsState,
  normalizeAiSettingsState,
  profileToEndpoint,
  saveAiSettingsState,
  type AiProviderKind,
  type AiProviderProfile,
  type AiSettingsState,
} from '@/lib/aiSettings';
import { listAiModels, testAiConnection } from '@/lib/ai/openaiCompatible';
import { ComboboxField } from '@/components/ui/ComboboxField';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface GlobalSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSettingsModal({ open, onClose }: GlobalSettingsModalProps) {
  const [state, setState] = useState<AiSettingsState>(() =>
    normalizeAiSettingsState(null),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    void loadAiSettingsState().then(setState);
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

  const active = useMemo(
    () =>
      state.profiles.find((p) => p.id === state.activeProfileId) ??
      state.profiles[0],
    [state],
  );

  const baseUrlOptions = useMemo(
    () =>
      PROVIDER_PRESETS.map((p) => ({
        value: p.baseUrl,
        label: p.label,
      })),
    [],
  );

  if (!open || !active) return null;

  const patchActive = (p: Partial<AiProviderProfile>) => {
    setState((prev) => ({
      ...prev,
      profiles: prev.profiles.map((x) =>
        x.id === prev.activeProfileId ? { ...x, ...p } : x,
      ),
    }));
  };

  const addProfile = () => {
    const profile = createProviderProfile({
      label: `Provider ${state.profiles.length + 1}`,
      kind: 'compatible',
    });
    setState((prev) => ({
      activeProfileId: profile.id,
      profiles: [...prev.profiles, profile],
    }));
  };

  const removeActive = () => {
    if (state.profiles.length <= 1) return;
    setState((prev) => {
      const profiles = prev.profiles.filter((p) => p.id !== prev.activeProfileId);
      return {
        profiles,
        activeProfileId: profiles[0]?.id ?? '',
      };
    });
  };

  const applyKind = (kind: AiProviderKind) => {
    const preset = PROVIDER_PRESETS.find((p) => p.kind === kind);
    if (!preset) return;
    patchActive({
      kind,
      label: active.label === active.kind || !active.label ? preset.label : active.label,
      baseUrl: preset.baseUrl,
      model: active.model || preset.model,
    });
  };

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const next = normalizeAiSettingsState(state);
      await saveAiSettingsState(next);
      setState(next);
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
      const next = normalizeAiSettingsState(state);
      await saveAiSettingsState(next);
      const endpoint = profileToEndpoint(
        next.profiles.find((p) => p.id === next.activeProfileId) ??
          next.profiles[0],
      );
      const reply = await testAiConnection(endpoint);
      setStatus(`연결 성공 · 응답: ${reply.slice(0, 80)}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    setBusy(true);
    setStatus('모델 목록 불러오는 중…');
    try {
      const endpoint = profileToEndpoint(active);
      const models = await listAiModels(endpoint);
      const nextModel =
        models.includes(active.model) || !models[0]
          ? active.model
          : models[0];
      patchActive({ modelOptions: models, model: nextModel });
      setStatus(`모델 ${models.length}개 불러옴`);
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
            <h3>AI Provider</h3>
            <p className="edit-page__sub">
              Provider별로 엔드포인트·키·모델을 저장합니다. OpenAI 호환{' '}
              <code>/v1/chat/completions</code> · <code>/v1/models</code> 를
              사용하며, 브라우저 CORS가 허용되어야 합니다.
            </p>

            <div className="ai-provider-bar">
              <label className="screen-settings-field ai-provider-bar__select">
                <span>활성 Provider</span>
                <select
                  value={state.activeProfileId}
                  disabled={busy}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      activeProfileId: e.target.value,
                    }))
                  }
                >
                  {state.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ghost-btn btn-with-icon"
                disabled={busy}
                onClick={addProfile}
              >
                <Plus size={15} />
                추가
              </button>
              <button
                type="button"
                className="danger-btn btn-with-icon"
                disabled={busy || state.profiles.length <= 1}
                onClick={removeActive}
              >
                <Trash2 size={15} />
                삭제
              </button>
            </div>

            <label className="screen-settings-field">
              <span>표시 이름</span>
              <input
                value={active.label}
                disabled={busy}
                onChange={(e) => patchActive({ label: e.target.value })}
                autoComplete="off"
              />
            </label>

            <label className="screen-settings-field">
              <span>종류</span>
              <select
                value={active.kind}
                disabled={busy}
                onChange={(e) => applyKind(e.target.value as AiProviderKind)}
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.kind} value={p.kind}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <ComboboxField
              label="Base URL"
              value={active.baseUrl}
              options={baseUrlOptions}
              placeholder="https://api.openai.com/v1"
              disabled={busy}
              onChange={(baseUrl) => patchActive({ baseUrl })}
            />

            <label className="screen-settings-field">
              <span>API Key</span>
              <input
                type="password"
                value={active.apiKey}
                disabled={busy}
                onChange={(e) => patchActive({ apiKey: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
              />
            </label>

            <div className="ai-model-row">
              <SearchableSelect
                label="Model"
                value={active.model}
                options={active.modelOptions ?? []}
                placeholder="gpt-4o-mini"
                disabled={busy}
                onChange={(model) => patchActive({ model })}
              />
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => void fetchModels()}
              >
                /models 불러오기
              </button>
            </div>

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
