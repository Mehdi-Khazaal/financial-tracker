import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ConfirmState {
  message: string;
  title?: string;
  danger?: boolean;
  resolve: (val: boolean) => void;
}

interface ToastContextType {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  confirm: (message: string, options?: { title?: string; danger?: boolean }) => Promise<boolean>;
}

// ── Context ───────────────────────────────────────────────────────────────────
const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = (): ToastContextType => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
};

// ── Icon paths ────────────────────────────────────────────────────────────────
const ICONS: Record<ToastType, string> = {
  success: 'M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z',
  error:   'M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z',
  info:    'M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z',
};

const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(16,185,129,.1)',  border: 'rgba(16,185,129,.25)',  icon: '#10b981' },
  error:   { bg: 'rgba(244,63,94,.1)',   border: 'rgba(244,63,94,.25)',   icon: '#f43f5e' },
  info:    { bg: 'rgba(99,102,241,.1)',  border: 'rgba(99,102,241,.25)',  icon: '#6366f1' },
};

// ── Single toast ───────────────────────────────────────────────────────────────
const ToastBubble: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const c = COLORS[toast.type];
  return (
    <div
      className="fade-in flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl pointer-events-auto min-w-[260px] max-w-[340px]"
      style={{ background: '#0d1018', border: `1px solid ${c.border}`, boxShadow: `0 8px 32px rgba(0,0,0,.4), 0 0 0 1px ${c.border}` }}>
      <svg viewBox="0 0 20 20" fill={c.icon} className="w-5 h-5 shrink-0">
        <path fillRule="evenodd" d={ICONS[toast.type]} clipRule="evenodd" />
      </svg>
      <p className="text-sm text-text flex-1 font-medium leading-snug">{toast.message}</p>
      <button onClick={onDismiss} className="shrink-0 opacity-40 hover:opacity-80 transition-opacity" style={{ color: '#eef0f8' }}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
};

// ── Confirm dialog ─────────────────────────────────────────────────────────────
const ConfirmDialog: React.FC<{
  state: ConfirmState;
  onAnswer: (val: boolean) => void;
}> = ({ state, onAnswer }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onAnswer(false)} />
    <div className="scale-in relative w-full max-w-sm rounded-2xl p-6 shadow-2xl"
      style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e' }}>
      {state.title && (
        <p className="font-bold text-base text-text mb-2">{state.title}</p>
      )}
      <p className="text-sm text-muted leading-relaxed mb-6">{state.message}</p>
      <div className="flex gap-3">
        <button
          onClick={() => onAnswer(false)}
          className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
          style={{ backgroundColor: '#1a1f2e', color: '#666e90' }}>
          Cancel
        </button>
        <button
          onClick={() => onAnswer(true)}
          className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
          style={state.danger
            ? { backgroundColor: 'rgba(244,63,94,.15)', color: '#f43f5e', border: '1px solid rgba(244,63,94,.25)' }
            : { backgroundColor: 'rgba(99,102,241,.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,.25)' }}>
          Confirm
        </button>
      </div>
    </div>
  </div>
);

// ── Provider ──────────────────────────────────────────────────────────────────
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const counter = useRef(0);

  const push = useCallback((type: ToastType, message: string) => {
    const id = ++counter.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3800);
  }, []);

  const success = useCallback((msg: string) => push('success', msg), [push]);
  const error   = useCallback((msg: string) => push('error', msg),   [push]);
  const info    = useCallback((msg: string) => push('info', msg),    [push]);

  const confirm = useCallback((message: string, options?: { title?: string; danger?: boolean }): Promise<boolean> => {
    return new Promise(resolve => {
      setConfirmState({ message, title: options?.title, danger: options?.danger ?? true, resolve });
    });
  }, []);

  const dismiss = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const handleAnswer = (val: boolean) => {
    confirmState?.resolve(val);
    setConfirmState(null);
  };

  return (
    <ToastContext.Provider value={{ success, error, info, confirm }}>
      {children}

      {/* Toast stack — top-right on desktop, top-center on mobile */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-5 z-[100] space-y-2 pointer-events-none flex flex-col items-center md:items-end">
        {toasts.map(t => (
          <ToastBubble key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>

      {confirmState && <ConfirmDialog state={confirmState} onAnswer={handleAnswer} />}
    </ToastContext.Provider>
  );
};
