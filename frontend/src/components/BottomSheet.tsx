import React, { useEffect, useRef } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

const BottomSheet: React.FC<Props> = ({ isOpen, onClose, title, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => panelRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
      previous?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-end md:items-center justify-center" style={{ zIndex: 'var(--z-modal)' }}>
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/70"
        style={{ animation: 'fadeOut 200ms ease reverse both' }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Dialog'}
        tabIndex={-1}
        className="bottom-sheet-panel slide-up relative w-full md:max-w-md md:mx-4 overflow-hidden safe-bottom outline-none"
        style={{
          background: 'linear-gradient(180deg, #1b1b1e, #101012)',
          border: '1px solid var(--line-strong)',
          maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)',
          boxShadow: 'var(--edge-light), var(--shadow-modal)',
        }}>

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full" style={{ backgroundColor: 'var(--line-strong)' }} />
        </div>

        {/* Header */}
        {title && (
          <div className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid var(--line)' }}>
            <h2 className="font-bold text-base text-text">{title}</h2>
            <button onClick={onClose}
              className="w-11 h-11 md:w-8 md:h-8 rounded-full flex items-center justify-center transition-colors"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}

        <div className="overflow-y-auto" style={{ maxHeight: title ? 'calc(100dvh - env(safe-area-inset-top, 0px) - 72px)' : 'calc(100dvh - env(safe-area-inset-top, 0px) - 12px)' }}>
          {children}
        </div>
      </div>
    </div>
  );
};

export default BottomSheet;
