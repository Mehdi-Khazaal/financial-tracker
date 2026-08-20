import React from 'react';

/**
 * The three patterns Settings repeated verbatim before the split.
 *
 * Kept in one file because they are each a handful of lines and are only used
 * together — three separate modules would be file count, not structure. Nothing
 * here hides behaviour: each takes what it renders as props and adds no logic
 * of its own.
 */

/** The square monogram used for a person, a bank and a user row. */
export const Avatar: React.FC<{
  label: string;
  tone?: 'accent' | 'positive';
  size?: 'sm' | 'lg';
}> = ({ label, tone = 'accent', size = 'sm' }) => (
  <div
    className={`${size === 'lg' ? 'w-14 h-14 text-xl' : 'w-8 h-8 text-sm'} rounded-md flex items-center justify-center font-mono font-bold shrink-0`}
    aria-hidden="true"
    style={{
      backgroundColor: 'var(--elev-sub)',
      border: '1px solid var(--line)',
      color: tone === 'positive' ? 'var(--pos)' : 'var(--accent)',
    }}
  >
    {label.charAt(0).toUpperCase()}
  </div>
);

/**
 * A spinner that announces itself.
 *
 * `role="status"` with visually hidden text, so a screen reader is told the
 * section is loading instead of being handed silence.
 */
export const LoadingBlock: React.FC<{ label: string }> = ({ label }) => (
  <div className="card py-8 text-center" role="status">
    <div
      className="w-5 h-5 rounded-full border-2 border-t-transparent mx-auto spin-slow"
      style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
    />
    <span className="sr-only">{label}</span>
  </div>
);

/** Nothing to show, which is a different fact from "we could not find out". */
export const EmptyBlock: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="card py-8 text-center text-muted text-sm">{children}</div>
);

/**
 * A load that failed.
 *
 * Distinct from `EmptyBlock` on purpose. Two of the three Settings loaders used
 * to swallow their errors, so a failed request rendered as an empty list —
 * "no connected banks" when the truth was "we could not ask".
 */
export const SectionErrorBlock: React.FC<{ message: string; onRetry: () => void }> = ({
  message, onRetry,
}) => (
  <div
    className="card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    role="alert"
  >
    <p className="text-sm text-muted min-w-0">{message}</p>
    <button
      type="button"
      onClick={onRetry}
      className="min-h-[44px] shrink-0 px-3 py-2 text-xs font-semibold rounded-lg transition-all"
      style={{
        backgroundColor: 'var(--elev-sub)',
        color: 'var(--fg)',
        border: '1px solid var(--line)',
      }}
    >
      Try again
    </button>
  </div>
);

/** A list row whose trailing slot holds one action. */
export const SettingsRow: React.FC<{
  children: React.ReactNode;
  action?: React.ReactNode;
  isLast?: boolean;
}> = ({ children, action, isLast = false }) => (
  <div
    className="px-4 py-3 flex items-center gap-3"
    style={{ borderBottom: isLast ? 'none' : '1px solid var(--line)' }}
  >
    <div className="flex-1 min-w-0">{children}</div>
    {action}
  </div>
);

/** The heading every section opens with. */
export const SectionHeading: React.FC<{
  title: string;
  meta?: React.ReactNode;
  badge?: React.ReactNode;
}> = ({ title, meta, badge }) => (
  <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
    <div className="flex items-center gap-2">
      <h2 className="label">{title}</h2>
      {badge}
    </div>
    {meta}
  </div>
);
