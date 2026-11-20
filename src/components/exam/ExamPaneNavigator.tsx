import { useEffect, useId, useRef } from 'react';
import { Code2, FileText, List, PenLine } from 'lucide-react';

export type ExamPaneId = 'list' | 'problem' | 'workspace';

export interface ExamPaneOption {
  id: ExamPaneId;
  label: string;
  shortLabel: string;
  /** workspace icon: code editor vs short-answer form */
  workspaceVariant?: 'code' | 'short';
}

interface ExamPaneNavigatorProps {
  panes: ExamPaneOption[];
  active: ExamPaneId;
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
  onSelect: (id: ExamPaneId) => void;
}

function PaneIcon({
  id,
  size = 18,
  variant,
}: {
  id: ExamPaneId;
  size?: number;
  variant?: 'code' | 'short';
}) {
  if (id === 'list') return <List size={size} aria-hidden />;
  if (id === 'problem') return <FileText size={size} aria-hidden />;
  if (id === 'workspace' && variant === 'short') {
    return <PenLine size={size} aria-hidden />;
  }
  if (id === 'workspace') return <Code2 size={size} aria-hidden />;
  return <PenLine size={size} aria-hidden />;
}

/**
 * Compact FAB by default (does not cover run output); tap nearby to expand
 * an iOS-style pane switcher, then light-dismiss or pick a page.
 */
export function ExamPaneNavigator({
  panes,
  active,
  expanded,
  onExpandedChange,
  onSelect,
}: ExamPaneNavigatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const activePane = panes.find((p) => p.id === active) ?? panes[0];
  const workspaceVariant =
    panes.find((p) => p.id === 'workspace')?.workspaceVariant ?? 'code';

  useEffect(() => {
    if (!expanded) return;
    const onDoc = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        onExpandedChange(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExpandedChange(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded, onExpandedChange]);

  if (!panes.length || !activePane) return null;

  return (
    <div
      ref={rootRef}
      className={`exam-pane-nav${expanded ? ' exam-pane-nav--expanded' : ''}`}
    >
      {/* Wide hit target around the compact control */}
      <button
        type="button"
        className="exam-pane-nav__hit"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={
          expanded
            ? '화면 전환 닫기'
            : `화면 전환 열기 (현재: ${activePane.label})`
        }
        onClick={() => onExpandedChange(!expanded)}
      >
        <span className="exam-pane-nav__fab" aria-hidden>
          <PaneIcon
            id={activePane.id}
            size={16}
            variant={workspaceVariant}
          />
          <span className="exam-pane-nav__fab-label">
            {activePane.shortLabel}
          </span>
        </span>
      </button>

      <nav
        id={listId}
        className="exam-pane-nav__sheet"
        aria-label="시험 화면 전환"
        hidden={!expanded}
      >
        <ul className="exam-pane-nav__list" role="list">
          {panes.map((pane) => {
            const selected = pane.id === active;
            return (
              <li key={pane.id}>
                <button
                  type="button"
                  className={`exam-pane-nav__item${
                    selected ? ' exam-pane-nav__item--active' : ''
                  }`}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => {
                    onSelect(pane.id);
                    onExpandedChange(false);
                  }}
                >
                  <PaneIcon
                    id={pane.id}
                    size={20}
                    variant={workspaceVariant}
                  />
                  <span>{pane.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
