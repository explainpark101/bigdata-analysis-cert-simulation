import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { SecretField } from '@/components/ui/SecretField';

interface GlobalSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function hasExpandedOverlay(root: HTMLElement | null): boolean {
  return Boolean(root?.querySelector('[data-ce-expanded="true"]'));
}

function clickOnOverlay(e: Event): boolean {
  return e
    .composedPath()
    .some(
      (n) =>
        n instanceof Element &&
        (n.hasAttribute('data-ce-overlay') ||
          n.closest('[data-ce-overlay]') != null),
    );
}

function pointerOutsideDialog(
  e: PointerEvent,
  dialog: HTMLDialogElement,
): boolean {
  if (clickOnOverlay(e)) return false;
  const r = dialog.getBoundingClientRect();
  return (
    e.clientX < r.left ||
    e.clientX > r.right ||
    e.clientY < r.top ||
    e.clientY > r.bottom
  );
}

function collapseOverlays(root: HTMLElement | null) {
  root
    ?.querySelectorAll('[data-ce-expanded="true"]')
    .forEach((node) => node.dispatchEvent(new Event('ce-collapse')));
}

export function GlobalSettingsModal({ open, onClose }: GlobalSettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<AiSettingsState>(() =>
    normalizeAiSettingsState(null),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const pressedOutsideRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // closerequest = Esc / platform back; light dismiss is custom so fixed
    // overlay lists outside the dialog box do not close the modal.
    dialog.setAttribute('closedby', 'closerequest');

    if (open) {
      void loadAiSettingsState().then(setState);
      setStatus('');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    const onPointerDown = (e: PointerEvent) => {
      pressedOutsideRef.current = pointerOutsideDialog(e, dialog);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutsideRef.current && pointerOutsideDialog(e, dialog)) {
        if (hasExpandedOverlay(dialog)) {
          collapseOverlays(dialog);
        } else {
          onClose();
        }
      }
      pressedOutsideRef.current = false;
    };

    // Listen on document so clicks on ::backdrop / fixed overlays are seen.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
    };
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

  const profileOptions = useMemo(
    () =>
      state.profiles.map((p) => ({
        value: p.id,
        label: p.label,
        description: p.kind,
      })),
    [state.profiles],
  );

  const kindOptions = useMemo(
    () =>
      PROVIDER_PRESETS.map((p) => ({
        value: p.kind,
        label: p.label,
        description: p.baseUrl,
      })),
    [],
  );

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
    if (!preset || !active) return;
    patchActive({
      kind,
      label:
        active.label === active.kind || !active.label
          ? preset.label
          : active.label,
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
    if (!active) return;
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
    if (!active) return;
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
    <dialog
      ref={dialogRef}
      className="screen-settings-modal global-settings-modal"
      aria-labelledby="global-settings-title"
      onCancel={(e) => {
        e.preventDefault();
        if (hasExpandedOverlay(dialogRef.current)) {
          collapseOverlays(dialogRef.current);
          return;
        }
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      {!active ? null : (
        <>
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

          <form
            className="screen-settings-modal__body global-settings-modal__body"
            aria-labelledby="global-settings-title"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <section className="screen-settings-col" style={{ gridColumn: '1 / -1' }}>
              <h3>AI Provider</h3>
              <p className="edit-page__sub">
                Provider별로 엔드포인트·키·모델을 저장합니다. OpenAI 호환{' '}
                <code>/v1/chat/completions</code> · <code>/v1/models</code> 를
                사용하며, 브라우저 CORS가 허용되어야 합니다. API Key는 로컬
                서버 등에서 비워 둘 수 있습니다.
              </p>

              <div className="ai-provider-bar">
                <div className="ai-provider-bar__select">
                  <SelectField
                    label="활성 Provider"
                    value={state.activeProfileId}
                    options={profileOptions}
                    disabled={busy}
                    onChange={(activeProfileId) =>
                      setState((prev) => ({ ...prev, activeProfileId }))
                    }
                  />
                </div>
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

              <TextField
                label="표시 이름"
                name="provider_label"
                value={active.label}
                disabled={busy}
                autoComplete="off"
                autoFocus
                onChange={(label) => patchActive({ label })}
              />

              <SelectField
                label="종류"
                value={active.kind}
                options={kindOptions}
                disabled={busy}
                onChange={(kind) => applyKind(kind as AiProviderKind)}
              />

              <ComboboxField
                label="Base URL"
                value={active.baseUrl}
                options={baseUrlOptions}
                placeholder="https://api.openai.com/v1"
                disabled={busy}
                hint="프리셋을 고르거나 OpenAI 호환 루트 URL을 직접 입력하세요"
                onChange={(baseUrl) => patchActive({ baseUrl })}
              />

              <SecretField
                label="API Key"
                name="api_key"
                value={active.apiKey}
                disabled={busy}
                optional
                placeholder="sk-… (선택)"
                hint="선택 사항 — 키가 필요 없는 로컬 서버는 비워 두세요"
                onChange={(apiKey) => patchActive({ apiKey })}
              />

              <div className="ai-model-row">
                <SearchableSelect
                  label="Model"
                  value={active.model}
                  options={active.modelOptions ?? []}
                  placeholder="gpt-4o-mini"
                  disabled={busy}
                  emptyHint="옵션 없음 — 직접 입력하거나 /models 로 불러오세요"
                  hint="직접 입력하거나 불러온 목록에서 선택하세요"
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
          </form>

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
        </>
      )}
    </dialog>
  );
}
