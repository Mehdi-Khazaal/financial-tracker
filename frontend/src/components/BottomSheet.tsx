import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  /**
   * Where the panel sits on desktop. `center` (default) is a dialog; `side`
   * is a full-height panel on the right, for detail views opened from a list
   * that should stay in sight. Phones always get a bottom sheet.
   */
  placement?: 'center' | 'side';
  /** Shows a back arrow before the title. Escape goes back instead of closing. */
  onBack?: () => void;
  backLabel?: string;
  /** Actions pinned under the scrolling body, so they never scroll out of reach. */
  footer?: React.ReactNode;
  /**
   * Changes when the content switches to another step (details → edit). The
   * panel then eases to the new height instead of jumping to it.
   */
  stepKey?: string;
}

/**
 * Bottom sheet on mobile, centred modal (or side panel) on desktop.
 *
 * Rendered through a portal into `<body>` rather than in place. This is not a
 * stylistic choice: a `transform` on *any* ancestor makes that ancestor the
 * containing block for `position: fixed` descendants, so a sheet rendered
 * inside an animated container (`.stagger-in > *` applies `translateY`) sizes
 * itself against that container instead of the viewport. On a long page that
 * puts the panel thousands of pixels down and mostly off-screen. Portalling
 * to `<body>` makes the sheet immune to whatever the page around it is doing.
 *
 * The panel is a flex column: the header (and footer) stay put, only the body
 * scrolls. Focus is trapped while open and handed back to the trigger on close.
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

/** How long the sheet stays mounted to play its exit; matches the CSS. */
const EXIT_MS = 200;

/**
 * Whether to play movement. Without `matchMedia` (tests, very old browsers)
 * the answer is no, so the sheet simply disappears on close as it always did.
 */
function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const BottomSheet: React.FC<Props> = ({
  isOpen, onClose, title, children, size = 'md', placement = 'center', onBack, backLabel = 'Back', footer, stepKey,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Parents pass inline callbacks, which change on every render. Reading them
  // through refs keeps the open/close effect tied to `isOpen` alone; before,
  // each parent re-render (a list reload after saving, say) re-ran it, moving
  // focus out of the sheet and back to its first button.
  const onCloseRef = useRef(onClose);
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onCloseRef.current = onClose;
    onBackRef.current = onBack;
  });

  // Exit: stay mounted briefly after `isOpen` turns false so the panel can
  // leave instead of vanishing. Derived during render, so there is no frame
  // where the sheet is gone and then comes back.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  const [exiting, setExiting] = useState(false);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    setExiting(!isOpen && motionAllowed());
  }
  useEffect(() => {
    if (!exiting) return undefined;
    const timer = window.setTimeout(() => setExiting(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  // While leaving, show what was on screen when it closed. Many pages clear
  // the record a sheet displays as they close it (`{cat && …}`), which would
  // otherwise send an empty panel sliding away.
  const lastShown = useRef({ children, footer, title });
  if (isOpen) lastShown.current = { children, footer, title };
  const shown = isOpen ? { children, footer, title } : lastShown.current;

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
      // A field that asked for focus (`autoFocus` on an amount) keeps it.
      // Otherwise the dialog itself takes focus, so screen readers announce
      // its title and the first Tab lands on its first control, without a
      // focus ring flashing on the close button for every mouse user.
      if (panel && panel.contains(document.activeElement)) return;
      panel?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      // A dialog on top (a confirm, a nested sheet) owns the keyboard; this
      // sheet must neither close on its Escape nor pull its Tab focus back.
      const active = document.activeElement as HTMLElement | null;
      const owner = active?.closest?.('[role="dialog"], [role="alertdialog"]');
      if (owner && owner !== panelRef.current) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        if (onBackRef.current) onBackRef.current();
        else onCloseRef.current();
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

      if (active && !panelRef.current?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === panelRef.current) {
        // Shift+Tab from the dialog itself would leave for the page behind.
        event.preventDefault();
        last.focus();
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
  }, [isOpen, focusableElements]);

  // Step changes: ease the panel from its old height to the new one. The
  // last height is kept current by a ResizeObserver, whose callbacks run after
  // layout effects — so here it still holds the height before this step.
  const lastHeightRef = useRef<number | null>(null);
  const stepRef = useRef(stepKey);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const next = panel.getBoundingClientRect().height;
    const previous = lastHeightRef.current;
    const stepChanged = stepRef.current !== stepKey;
    stepRef.current = stepKey;
    lastHeightRef.current = next;
    if (!stepChanged || previous == null || Math.abs(previous - next) < 2) return;
    if (!motionAllowed() || typeof panel.animate !== 'function') return;
    panel.animate(
      [{ height: `${previous}px` }, { height: `${next}px` }],
      { duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    );
  }, [stepKey]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!isOpen || !panel || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      lastHeightRef.current = panel.getBoundingClientRect().height;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isOpen]);

  if ((!isOpen && !exiting) || typeof document === 'undefined') return null;

  const rootClass = [
    'sheet-root',
    placement === 'side' ? 'sheet-root--side' : '',
    exiting ? 'is-exiting' : '',
  ].filter(Boolean).join(' ');

  return createPortal(
    <div className={rootClass}>
      {/* Overlay */}
      <div
        className="sheet-scrim absolute inset-0 bg-black/40"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={shown.title ?? 'Dialog'}
        tabIndex={-1}
        className={`bottom-sheet-panel sheet-panel--${size} overflow-hidden`}
        style={{
          outline: 'none',
          background: 'var(--elev-1)',
          border: '1px solid var(--line-strong)',
          boxShadow: 'var(--edge-light), var(--shadow-modal)',
        }}
      >
        <div className="sheet-header">
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 md:hidden">
            <div className="w-10 h-1 rounded-full" style={{ backgroundColor: 'var(--line-strong)' }} />
          </div>

          {shown.title && (
            <div
              className="flex items-center gap-1 pl-5 pr-3 py-2 md:py-3"
              style={{ borderBottom: '1px solid var(--line)', paddingLeft: onBack ? 8 : undefined }}
            >
              {onBack && (
                <button
                  type="button"
                  onClick={() => onBackRef.current?.()}
                  aria-label={backLabel}
                  className="sheet-icon-btn"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
                    <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
              <h2 className="flex-1 min-w-0 truncate text-base font-semibold" style={{ color: 'var(--fg)' }}>
                {shown.title}
              </h2>
              <button
                type="button"
                onClick={() => onCloseRef.current()}
                aria-label="Close"
                className="sheet-icon-btn"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}
        </div>

        <div className={['sheet-body', shown.title ? 'sheet-body--titled' : '', shown.footer ? 'sheet-body--with-footer' : ''].filter(Boolean).join(' ')}>
          {shown.children}
        </div>

        {shown.footer && <div className="sheet-footer">{shown.footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export default BottomSheet;
