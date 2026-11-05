import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { linkToBanking, linkToSettingsSection } from '../../../lib/deepLinks';

/**
 * First-run checklist — the "two minutes to a meaningful Overview" path.
 *
 * Three steps, each done when the data says so: an account exists (typed or
 * connected), the categories were looked at, a budget is set. It lives at the
 * top of Overview only while something is left, then disappears for good.
 * "Reviewed categories" cannot be inferred from data, so following the link
 * marks it done; that flag and a dismissal are per user in localStorage.
 */
interface Props {
  userId: number;
  hasAccounts: boolean;
  hasBudget: boolean;
  onSetBudget: () => void;
}

const storageKey = (userId: number, key: string) => `ft_setup_${key}_${userId}`;

const read = (userId: number, key: string): boolean => {
  try { return localStorage.getItem(storageKey(userId, key)) === '1'; } catch { return false; }
};
const write = (userId: number, key: string) => {
  try { localStorage.setItem(storageKey(userId, key), '1'); } catch { /* ignore */ }
};

const SetupChecklist: React.FC<Props> = ({ userId, hasAccounts, hasBudget, onSetBudget }) => {
  const [reviewed, setReviewed] = useState(() => read(userId, 'categories'));
  const [dismissed, setDismissed] = useState(() => read(userId, 'dismissed'));

  useEffect(() => { setReviewed(read(userId, 'categories')); setDismissed(read(userId, 'dismissed')); }, [userId]);

  const steps = [
    { id: 'account', done: hasAccounts, label: 'Add an account or connect a bank', hint: 'Balances and transactions start here.' },
    { id: 'categories', done: reviewed, label: 'Review your categories', hint: 'Keep the defaults or make them yours.' },
    { id: 'budget', done: hasBudget, label: 'Set a budget', hint: 'One allowance for the category you watch most.' },
  ];
  const remaining = steps.filter(s => !s.done).length;
  if (dismissed || remaining === 0) return null;

  const markReviewed = () => { write(userId, 'categories'); setReviewed(true); };
  const dismiss = () => { write(userId, 'dismissed'); setDismissed(true); };

  // A numbered list under a title, like every other section: no box, and a
  // finished step is ticked and greyed rather than struck through.
  return (
    <section aria-labelledby="setup-heading">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 id="setup-heading" className="section-title">Get set up</h2>
        <div className="flex items-baseline gap-4">
          <span className="text-[13px]" style={{ color: 'var(--muted)' }}>
            {remaining === steps.length ? 'Three steps to a real overview' : `${remaining} step${remaining === 1 ? '' : 's'} left`}
          </span>
          <button type="button" onClick={dismiss} className="text-[13px] pressable" style={{ color: 'var(--muted)', minHeight: 44 }} aria-label="Hide setup checklist">
            Hide
          </button>
        </div>
      </div>
      <ol className="row-list" style={{ borderBottom: '1px solid var(--line)' }}>
        {steps.map((step, index) => {
          const control = step.id === 'account'
            ? <Link to={linkToBanking()} className="section-link">Open accounts →</Link>
            : step.id === 'categories'
              ? <Link to={linkToSettingsSection('categories')} onClick={markReviewed} className="section-link">Open categories →</Link>
              : <button type="button" onClick={onSetBudget} className="section-link pressable" style={{ minHeight: 44 }}>Set a budget →</button>;
          return (
            <li key={step.id} className="flex items-center gap-4 py-3" style={{ minHeight: 56 }}>
              <span aria-hidden="true" className="w-5 shrink-0 text-sm font-semibold tabular-nums" style={{ color: step.done ? 'var(--pos)' : 'var(--dim)' }}>
                {step.done
                  ? <svg viewBox="0 0 20 20" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
                  : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: step.done ? 'var(--muted)' : 'var(--fg)' }}>
                  {step.label}
                </p>
                {!step.done && <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{step.hint}</p>}
              </div>
              <div className="shrink-0">
                {step.done ? <span className="text-[13px]" style={{ color: 'var(--muted)' }}>Done</span> : control}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default SetupChecklist;
