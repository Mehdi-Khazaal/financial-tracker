import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /**
   * Desktop width. `md` (default) matches every existing modal; `lg` is for
   * data-dense drawers where 448px would wrap every figure onto its own line.
   * Mobile is always full-width.
   */
  size?: 'md' | 'lg';
}

/**
 * Bottom sheet on mobile, centred modal on desktop.
 *
 * Rendered through a portal into `<body>` rather than in place. This is not a
 * stylistic choice: a `transform` on *any* ancestor makes that ancestor the
 * containing block for `position: fixed` descendants, so a sheet rendered
 * inside an animated container (`.stagger-in > *` applies `translateY`) sizes
 * itself against that container instead of the viewport. On a long page that
 * puts the panel thousands of pixels down and mostly off-screen. Portalling
 * to `<body>` makes the sheet immune to whatever the page around it is doing.
 *
 * The panel is a flex column: the header stays put, only the body scrolls.
 * Focus is trapped while open and handed back to the trigger on close.
 */

/**
 * Nested sheets are possible (a modal opened from a drawer), so scroll lock is
 * reference-counted — an inner sheet closing must not unlock the page
 * underneath, and the last one out restores the original value.
 */
let lockCount = 0;
let previousOverflow = '';

function lockBodyScroll(): void {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function unlockBodyScroll(): void {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = previousOverflow;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const BottomSheet: React.FC<Props> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const focusableElements = useCallback((): HTMLElement[] => {
    if (!panelRef.current) return [];
    return Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    // The portal has already committed by the time this effect runs, so the
    // node is captured here and used in the cleanup rather than re-reading the
    // ref after React may have detached it.
    const panel = panelRef.current;

    // Remember what to hand focus back to — usually the card or row that was
    // clicked to open this sheet.
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    lockBodyScroll();

    const frame = requestAnimationFrame(() => {
      const [first] = focusableElements();
      (first ?? panelRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap: cycle within the panel rather than escaping to the page behind.
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;

      if (active && !panelRef.current?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      unlockBodyScroll();
      // Only restore focus if it never left the sheet. If the user has
      // already clicked something else, leave them where they are.
      const active = document.activeElement;
      const stillInside = !active || active === document.body || !!panel?.contains(active);
      if (stillInside) restoreFocusRef.current?.focus?.();
    };
  }, [isOpen, onClose, focusableElements]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div className="sheet-root">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70"
        style={{ animation: 'fadeOut 200ms ease reverse both' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Dialog'}
        tabIndex={-1}
        className={`bottom-sheet-panel sheet-panel--${size} slide-up outline-none`}
        style={{
          background: 'linear-gradient(180deg, #1b1b1e, #101012)',
          border: '1px solid var(--line-strong)',
          boxShadow: 'var(--edge-light), var(--shadow-modal)',
        }}
      >
        <div className="sheet-header">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 md:hidden">
            <div className="w-10 h-1 rounded-full" style={{ backgroundColor: 'var(--line-strong)' }} />
          </div>

          {title && (
            <div
              className="flex items-center justify-between gap-3 px-5 py-3"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <h2 className="font-bold text-base min-w-0 truncate" style={{ color: 'var(--fg)' }}>
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-11 h-11 md:w-8 md:h-8 rounded-full flex items-center justify-center shrink-0 transition-colors"
                style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

export default BottomSheet;
