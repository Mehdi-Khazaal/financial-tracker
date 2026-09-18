import React, { useEffect, useState } from 'react';
import { UPDATE_EVENT } from '../lib/serviceWorker';

/**
 * "A new version is ready" — shown when the service worker reports that a
 * newer build has installed behind the running page.
 *
 * Styled as a toast, not a modal: an update is never urgent enough to block
 * a number the user came to read. Reload is one tap; dismiss keeps the
 * current session until the next natural navigation.
 */
const UpdatePrompt: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(UPDATE_EVENT, show);
    return () => window.removeEventListener(UPDATE_EVENT, show);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 px-4 w-full max-w-[380px] pointer-events-none"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)', zIndex: 'var(--z-toast)' as unknown as number }}
    >
      <div
        className="fade-in pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl"
        style={{ background: 'var(--elev-1)', border: '1px solid var(--line-strong)', boxShadow: 'var(--edge-light), var(--shadow-float)' }}
      >
        <span className="label" style={{ color: 'var(--accent)' }}>Update</span>
        <p className="text-sm flex-1 font-medium leading-snug" style={{ color: 'var(--fg)' }}>
          A new version of Fintrack is ready.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="pressable shrink-0 rounded-full px-3 text-xs font-semibold"
          style={{ minHeight: 36, background: 'var(--accent)', color: '#0A0A0B' }}
        >
          Reload
        </button>
        <button
          type="button"
          aria-label="Dismiss update notice"
          onClick={() => setVisible(false)}
          className="shrink-0 opacity-40 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--fg)', minWidth: 36, minHeight: 36 }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mx-auto" aria-hidden="true">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default UpdatePrompt;
