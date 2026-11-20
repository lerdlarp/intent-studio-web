// A short-lived message floating over the plan (e.g. "Deleted “Desk A” · Undo"). Disappears after a few seconds.
import { useEffect, useState } from 'react';
import { studio, useStudio } from '../../state/instance';
import { Icon } from './Icon';

const TOAST_MS = 8000;

export function Toast() {
  const toast = useStudio((s) => s.toast);
  const { dismissToast, undo } = studio.getState();
  // paused while the pointer or keyboard focus is on it, so Undo stays reachable
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!toast || held) return;
    const t = setTimeout(dismissToast, TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, held, dismissToast]);
  if (!toast) return null;
  return (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      data-testid="toast"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span>{toast.text}</span>
      {toast.undo && (
        <button
          type="button"
          className="link"
          onClick={() => {
            undo();
            dismissToast();
          }}
        >
          Undo
        </button>
      )}
      <button type="button" className="icon-button" onClick={dismissToast} aria-label="Dismiss message">
        <Icon name="close" />
      </button>
    </div>
  );
}
