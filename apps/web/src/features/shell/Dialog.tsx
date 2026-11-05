// Modal dialog: role="dialog" + aria-modal, labelled by its title, focus moves inside on open (the first field, else
// the first focusable), Tab / Shift+Tab stay inside, Esc closes, and focus returns to where it was on close.
import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0,
  );
}

export function Dialog({
  title,
  onClose,
  children,
  testId,
  wide = false,
  hideTitle = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  wide?: boolean;
  /** Keep the title for assistive tech only (the content has its own visible heading). */
  hideTitle?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    if (el) {
      const first =
        el.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea') ??
        focusables(el)[0] ??
        el;
      first.focus();
    }
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = focusables(ref.current);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const titleId = `dlg-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="dialog-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={wide ? 'dialog' : 'dialog narrow'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <h2 id={titleId} className={hideTitle ? 'sr-only' : undefined}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
