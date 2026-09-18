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

  return (
    <section className="card p-4 md:p-5" aria-labelledby="setup-heading">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="label" style={{ color: 'var(--accent)' }}>Get set up</p>
          <h2 id="setup-heading" className="text-sm font-semibold mt-0.5" style={{ color: 'var(--fg)' }}>
            {remaining === steps.length ? 'Three steps to a real overview' : `${remaining} step${remaining === 1 ? '' : 's'} left`}
          </h2>
        </div>
        <button type="button" onClick={dismiss} className="text-xs pressable" style={{ color: 'var(--dim)', minHeight: 44 }} aria-label="Hide setup checklist">
          Hide
        </button>
      </div>
      <ol className="space-y-2">
        {steps.map(step => {
          const control = step.id === 'account'
            ? <Link to={linkToBanking()} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Open accounts →</Link>
            : step.id === 'categories'
              ? <Link to={linkToSettingsSection('categories')} onClick={markReviewed} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Open categories →</Link>
              : <button type="button" onClick={onSetBudget} className="text-xs font-medium pressable" style={{ color: 'var(--accent)', minHeight: 44 }}>Set a budget →</button>;
          return (
            <li key={step.id} className="flex items-start gap-3 rounded-xl p-3" style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
              <span
                aria-hidden="true"
                className="mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
                style={step.done
                  ? { backgroundColor: 'var(--pos)', color: '#0A0A0B' }
                  : { border: '1px solid var(--line-strong)', color: 'var(--dim)' }}
              >
                {step.done ? '✓' : ''}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: step.done ? 'var(--muted)' : 'var(--fg)', textDecoration: step.done ? 'line-through' : 'none' }}>
                  {step.label}
                </p>
                {!step.done && <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>{step.hint}</p>}
                {!step.done && <div className="mt-1.5">{control}</div>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default SetupChecklist;
