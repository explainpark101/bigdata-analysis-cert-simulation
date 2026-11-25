import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  DEFAULT_AI_TEMPERATURE,
  PROVIDER_PRESETS,
  createProviderProfile,
  formatExtraParamValue,
  loadAiSettingsState,
  normalizeAiSettingsState,
  normalizeExtraParams,
  normalizeOptionalNumber,
  parseExtraParamValue,
  profileToEndpoint,
  saveAiSettingsState,
  type AiExtraParamValue,
  type AiProviderKind,
  type AiProviderProfile,
  type AiSettingsState,
} from '@/lib/aiSettings';
import { listAiModels, testAiConnection } from '@/lib/ai/openaiCompatible';
import { ComboboxField } from '@/components/ui/ComboboxField';
import { FilterableSelectField } from '@/components/ui/FilterableSelectField';
import { SelectField } from '@/components/ui/SelectField';
import { TextField } from '@/components/ui/TextField';
import { SecretField } from '@/components/ui/SecretField';
import { ConfirmModal } from '@/components/exam/ConfirmModal';

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

type ExtraParamRow = { id: string; key: string; value: string };

function extraParamsToRows(
  params: Record<string, AiExtraParamValue> | undefined,
): ExtraParamRow[] {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return [];
  return entries.map(([key, value]) => ({
    id: `extra-${key}-${crypto.randomUUID().slice(0, 6)}`,
    key,
    value: formatExtraParamValue(value),
  }));
}

function rowsToExtraParams(
  rows: ExtraParamRow[],
): Record<string, AiExtraParamValue> {
  const raw: Record<string, AiExtraParamValue> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    raw[key] = parseExtraParamValue(row.value);
  }
  return normalizeExtraParams(raw);
}

function optionalNumberInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value);
}

export function GlobalSettingsModal({ open, onClose }: GlobalSettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<AiSettingsState>(() =>
    normalizeAiSettingsState(null),
  );
  const [extraRows, setExtraRows] = useState<ExtraParamRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const pressedOutsideRef = useRef(false);

  const requestClose = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      // Close the native dialog immediately so CSS [open] hides it even
      // before the parent re-renders with open=false.
      dialog.close();
    }
    onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // closerequest = Esc / platform back; light dismiss is custom so fixed
    // overlay lists outside the dialog box do not close the modal.
    dialog.setAttribute('closedby', 'closerequest');

    if (open) {
      void loadAiSettingsState().then((next) => {
        setState(next);
        const active =
          next.profiles.find((p) => p.id === next.activeProfileId) ??
          next.profiles[0];
        setExtraRows(extraParamsToRows(active?.extraParams));
      });
      setStatus('');
      if (!dialog.open) {
        dialog.showModal();
      }
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
          requestClose();
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

  const modelListOptions = useMemo(
    () =>
      (active?.modelOptions ?? []).map((id) => ({
        value: id,
        label: id,
      })),
    [active?.modelOptions],
  );

  const patchActive = (p: Partial<AiProviderProfile>) => {
    setState((prev) => ({
      ...prev,
      profiles: prev.profiles.map((x) =>
        x.id === prev.activeProfileId ? { ...x, ...p } : x,
      ),
    }));
  };

  const syncExtraRowsToActive = (rows: ExtraParamRow[]) => {
    setExtraRows(rows);
    patchActive({ extraParams: rowsToExtraParams(rows) });
  };

  const selectProfile = (activeProfileId: string) => {
    setState((prev) => {
      const currentId = prev.activeProfileId;
      const withExtra = prev.profiles.map((p) =>
        p.id === currentId
          ? { ...p, extraParams: rowsToExtraParams(extraRows) }
          : p,
      );
      const next = withExtra.find((p) => p.id === activeProfileId) ?? withExtra[0];
      setExtraRows(extraParamsToRows(next?.extraParams));
      return { activeProfileId: next?.id ?? '', profiles: withExtra };
    });
  };

  const addProfile = () => {
    const profile = createProviderProfile({
      label: `Provider ${state.profiles.length + 1}`,
      kind: 'compatible',
    });
    setState((prev) => {
      const profiles = prev.profiles.map((p) =>
        p.id === prev.activeProfileId
          ? { ...p, extraParams: rowsToExtraParams(extraRows) }
          : p,
      );
      return {
        activeProfileId: profile.id,
        profiles: [...profiles, profile],
      };
    });
    setExtraRows([]);
  };

  const removeActive = () => {
    if (state.profiles.length <= 1) return;
    setState((prev) => {
      const profiles = prev.profiles.filter((p) => p.id !== prev.activeProfileId);
      const nextId = profiles[0]?.id ?? '';
      setExtraRows(extraParamsToRows(profiles[0]?.extraParams));
      return {
        profiles,
        activeProfileId: nextId,
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

  const stateWithExtraRows = (): AiSettingsState => ({
    ...state,
    profiles: state.profiles.map((p) =>
      p.id === state.activeProfileId
        ? { ...p, extraParams: rowsToExtraParams(extraRows) }
        : p,
    ),
  });

  const save = async () => {
    setBusy(true);
    setStatus('');
    try {
      const next = normalizeAiSettingsState(stateWithExtraRows());
      await saveAiSettingsState(next);
      setState(next);
      const saved =
        next.profiles.find((p) => p.id === next.activeProfileId) ??
        next.profiles[0];
      setExtraRows(extraParamsToRows(saved?.extraParams));
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
      const next = normalizeAiSettingsState(stateWithExtraRows());
      await saveAiSettingsState(next);
      setState(next);
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
    <>
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
        requestClose();
      }}
      onClose={() => {
        // Native dialog closed (Esc / close()) — sync React state if still open.
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
              onClick={requestClose}
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
                    onChange={(activeProfileId) => selectProfile(activeProfileId)}
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
                  onClick={() => setConfirmRemove(true)}
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

              <TextField
                label="Model"
                name="model"
                value={active.model}
                disabled={busy}
                placeholder="gpt-4o-mini"
                autoComplete="off"
                hint="현재 사용할 모델 id (직접 입력 가능)"
                onChange={(model) => patchActive({ model })}
              />

              <div className="ai-model-row">
                <FilterableSelectField
                  label="모델 목록"
                  value={active.model}
                  options={modelListOptions}
                  disabled={busy}
                  placeholder="불러온 목록에서 검색·선택"
                  searchPlaceholder="모델 id 검색…"
                  emptyHint="옵션 없음 — /models 로 불러오세요"
                  hint="검색은 목록 필터만 하며, 고른 항목이 위 Model 값으로 들어갑니다"
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

              <h3 className="global-settings-subhead">Sampling</h3>
              <p className="edit-page__sub">
                Provider별로 temperature / top_p / top_k 와 추가 요청 파라미터를
                저장합니다. 비운 항목은 API에 보내지 않습니다 (temperature 기본{' '}
                {DEFAULT_AI_TEMPERATURE}).
              </p>

              <div className="ai-sampling-row">
                <TextField
                  label="temperature"
                  name="temperature"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  max={2}
                  value={String(
                    active.temperature ?? DEFAULT_AI_TEMPERATURE,
                  )}
                  disabled={busy}
                  hint="0–2"
                  onChange={(raw) => {
                    const n = Number(raw);
                    patchActive({
                      temperature: Number.isFinite(n)
                        ? Math.min(2, Math.max(0, n))
                        : DEFAULT_AI_TEMPERATURE,
                    });
                  }}
                />
                <TextField
                  label="top_p"
                  name="top_p"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  max={1}
                  value={optionalNumberInput(active.topP)}
                  disabled={busy}
                  placeholder="비우면 미전송"
                  hint="0–1 · 선택"
                  onChange={(raw) =>
                    patchActive({
                      topP: normalizeOptionalNumber(raw, 0, 1),
                    })
                  }
                />
                <TextField
                  label="top_k"
                  name="top_k"
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={0}
                  max={200}
                  value={optionalNumberInput(active.topK)}
                  disabled={busy}
                  placeholder="비우면 미전송"
                  hint="정수 · 로컬 게이트웨이 등"
                  onChange={(raw) =>
                    patchActive({
                      topK: normalizeOptionalNumber(raw, 0, 200),
                    })
                  }
                />
              </div>

              <div className="ai-extra-params">
                <div className="ai-extra-params__head">
                  <span>추가 파라미터</span>
                  <button
                    type="button"
                    className="ghost-btn btn-with-icon"
                    disabled={busy}
                    onClick={() =>
                      syncExtraRowsToActive([
                        ...extraRows,
                        {
                          id: `extra-${crypto.randomUUID().slice(0, 8)}`,
                          key: '',
                          value: '',
                        },
                      ])
                    }
                  >
                    <Plus size={15} />
                    행 추가
                  </button>
                </div>
                <p className="ce-field__hint">
                  chat/completions body에 그대로 합쳐집니다. 값: 숫자 / true /
                  false / null / 문자열 (JSON도 가능). model·messages·stream 등
                  예약 키는 무시됩니다.
                </p>
                {extraRows.length === 0 ? (
                  <p className="edit-page__sub">추가 파라미터 없음</p>
                ) : (
                  <ul className="ai-extra-params__list">
                    {extraRows.map((row) => (
                      <li key={row.id} className="ai-extra-params__row">
                        <TextField
                          label="key"
                          name={`extra_key_${row.id}`}
                          value={row.key}
                          disabled={busy}
                          placeholder="min_p"
                          autoComplete="off"
                          onChange={(key) =>
                            syncExtraRowsToActive(
                              extraRows.map((r) =>
                                r.id === row.id ? { ...r, key } : r,
                              ),
                            )
                          }
                        />
                        <TextField
                          label="value"
                          name={`extra_value_${row.id}`}
                          value={row.value}
                          disabled={busy}
                          placeholder="0.05"
                          autoComplete="off"
                          onChange={(value) =>
                            syncExtraRowsToActive(
                              extraRows.map((r) =>
                                r.id === row.id ? { ...r, value } : r,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="행 삭제"
                          disabled={busy}
                          onClick={() =>
                            syncExtraRowsToActive(
                              extraRows.filter((r) => r.id !== row.id),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
            <button type="button" className="ghost-btn" onClick={requestClose}>
              닫기
            </button>
          </footer>
        </>
      )}

    </dialog>

    <ConfirmModal
      open={confirmRemove}
      title="Provider 삭제"
      message={`「${active?.label ?? 'Provider'}」 프로필을 삭제할까요?\n저장된 API Key·모델 설정도 함께 사라집니다.`}
      cancelLabel="취소"
      confirmLabel="삭제"
      confirmDanger
      onCancel={() => setConfirmRemove(false)}
      onConfirm={() => {
        removeActive();
        setConfirmRemove(false);
      }}
    />
    </>
  );
}
