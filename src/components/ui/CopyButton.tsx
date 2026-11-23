import { useId } from 'react';
import { Check, Copy, X } from 'lucide-react';

const timers = new WeakMap<HTMLButtonElement, number>();
let lastAnnounced = '';

function legacyCopy(text: string): boolean {
  const field = Object.assign(document.createElement('textarea'), {
    value: text,
  });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

function report(button: HTMLButtonElement, ok: boolean) {
  const tip = button.nextElementSibling;
  if (!(tip instanceof HTMLElement)) return;
  const prev = timers.get(button);
  if (prev) window.clearTimeout(prev);
  button.removeAttribute('data-copied');
  button.removeAttribute('data-failed');
  let message = ok ? 'Copied' : 'Copy failed';
  if (message === lastAnnounced) message += '\u00A0';
  lastAnnounced = message;
  tip.textContent = '';
  void button.offsetWidth;
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
  requestAnimationFrame(() => {
    tip.textContent = message;
  });
  timers.set(
    button,
    window.setTimeout(() => {
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
      tip.textContent = '';
    }, 2000),
  );
}

async function copyText(button: HTMLButtonElement, text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    report(button, true);
  } catch {
    try {
      if (!legacyCopy(text)) throw new Error('Copy failed');
      report(button, true);
    } catch {
      report(button, false);
    }
  }
}

interface CopyButtonProps {
  /** id of the element whose text will be copied */
  targetId: string;
  /** Accessible name, e.g. "메시지 내용 복사" */
  label: string;
  className?: string;
}

export function CopyButton({ targetId, label, className }: CopyButtonProps) {
  const tipId = useId();

  return (
    <span className={`copy-btn ${className ?? ''}`.trim()}>
      <button
        type="button"
        className="copy-btn__button"
        aria-label={label}
        aria-describedby={tipId}
        onClick={(e) => {
          const target = document.getElementById(targetId);
          if (!target) return;
          const text = target.matches('input, textarea')
            ? (target as HTMLInputElement | HTMLTextAreaElement).value
            : target.innerText.trim();
          void copyText(e.currentTarget, text);
        }}
      >
        <Copy size={14} className="copy-btn__icon copy-btn__icon--idle" aria-hidden />
        <Check
          size={14}
          className="copy-btn__icon copy-btn__icon--ok"
          aria-hidden
        />
        <X
          size={14}
          className="copy-btn__icon copy-btn__icon--fail"
          aria-hidden
        />
      </button>
      <span id={tipId} className="copy-btn__tip" role="status" />
    </span>
  );
}
