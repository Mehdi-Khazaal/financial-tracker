import React from 'react';
import { Link } from 'react-router-dom';
import type { Account, MonthSnapshot } from '../../../types';
import { ACCOUNT_TYPE_META, AccountTypeIcon } from '../../../components/dashboard/DashboardPrimitives';
import ProgressBar from '../../../components/ProgressBar';
import { MINUS, dollars, percent } from '../../analytics/format';
import { linkToAccountTransactions } from '../../../lib/deepLinks';
import { describeBalance } from '../calculations/cards';
import { UTILIZATION_LABELS, utilizationBand } from '../calculations/cards';
import { calculateBalanceChange } from '../calculations/history';

/**
 * One account card, for every account type.
 *
 * Credit cards used to render twice — once in the Wallet tab as `-$213.37` with
 * a utilisation bar, once in the Cards tab as "Balance Owed" with available
 * credit. Same concept, two implementations, already drifting apart. This is
 * the single implementation; the type decides what secondary information it
 * shows, not which component renders it.
 *
 * Interaction shape, deliberately:
 *   • The card itself is **not** a link. A card-wide click target that also
 *     contains Edit and Delete produces a control the user cannot predict.
 *   • "View transactions" is an explicit link with a real destination.
 *   • Edit and Delete are real buttons, revealed on hover on desktop and
 *     always present on touch, where hover does not exist.
 *   • Delete never gets colour emphasis — a destructive control should be
 *     reachable, not prominent.
 */

interface Props {
  account: Account;
  /** Balance snapshots for this account, when history loaded. */
  history?: MonthSnapshot[];
  /** Highlights the card when arrived at via a deep link. */
  isFocused?: boolean;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  /** Shown on credit cards only — records a payment as a transfer. */
  onRecordPayment?: (account: Account) => void;
}

const TONE_COLORS: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'var(--pos)',
  negative: 'var(--neg)',
  neutral: 'var(--fg)',
};

const Sparkline: React.FC<{ series: number[]; color: string }> = ({ series, color }) => {
  if (series.length < 2) return null;
  const width = 72;
  const height = 26;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const points = series
    .map((v, i) => `${((i / (series.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`)
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="opacity-70 shrink-0" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const AccountCard: React.FC<Props> = ({
  account, history, isFocused = false, onEdit, onDelete, onRecordPayment,
}) => {
  const meta = ACCOUNT_TYPE_META[account.type] ?? ACCOUNT_TYPE_META.checking;
  const balance = describeBalance(account);
  const isCard = account.type === 'credit_card';

  const change = calculateBalanceChange(history, account.name);
  // On a credit card a falling balance means less debt, which is good news.
  const changeIsGood = isCard ? change.change <= 0 : change.change >= 0;
  const changeColor = change.change === 0
    ? 'var(--muted)'
    : changeIsGood ? 'var(--pos)' : 'var(--neg)';

  const limit = Number(account.credit_limit) || 0;
  const owed = Math.max(0, -Number(account.balance));
  const utilization = isCard && limit > 0 ? (owed / limit) * 100 : null;
  const band = utilizationBand(utilization);

  return (
    <div
      id={`account-${account.id}`}
      className="card card-hover p-4 group flex flex-col"
      style={isFocused ? {
        borderColor: 'var(--accent)',
        boxShadow: 'var(--edge-light), 0 0 0 1px var(--accent-glow)',
      } : undefined}
    >
      {/* Identity + secondary actions */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <AccountTypeIcon type={account.type} className="w-9 h-9" iconClassName="w-[18px] h-[18px]" />
          <div className="min-w-0">
            <p className="font-semibold text-sm leading-snug truncate" style={{ color: 'var(--fg)' }} title={account.name}>
              {account.name}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{meta.label}</p>
          </div>
        </div>

        {/* Always present on touch, revealed on hover where hover exists. */}
        <div className="flex gap-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(account)}
            aria-label={`Edit ${account.name}`}
            className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)' }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(account)}
            aria-label={`Delete ${account.name}`}
            className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all"
            style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)', border: '1px solid var(--line)' }}
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Primary figure */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p
            className="font-mono tabular-nums font-bold text-lg leading-tight break-words"
            style={{ color: TONE_COLORS[balance.tone] }}
          >
            <span aria-hidden="true">{balance.text}</span>
            <span className="sr-only">{`${account.name}: ${balance.srText}`}</span>
          </p>
          {/* The utilisation block below already states available credit, so
              the card's own detail line would be the same fact twice. */}
          {balance.detail && !(isCard && utilization != null) && (
            <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--dim)' }} aria-hidden="true">
              {balance.detail}
            </p>
          )}
        </div>
        {change.available && <Sparkline series={change.series} color={changeColor} />}
      </div>

      {/* Recent change — stated, never invented */}
      <div className="mt-2">
        {change.available ? (
          <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
            <span className="tabular-nums" style={{ color: changeColor }}>
              {change.change === 0
                ? 'No change'
                : isCard
                  // "−$2,811 in green" reads as a contradiction on a debt.
                  ? `${dollars(Math.abs(change.change))} ${change.change < 0 ? 'less' : 'more'} owed`
                  : `${change.change > 0 ? '+' : MINUS}${dollars(Math.abs(change.change))}`}
            </span>
            {' '}over {change.windowLabel}
            <span className="sr-only">. {change.summary}</span>
          </p>
        ) : (
          // A new account has no trend. Printing +$0.00 would be a claim about
          // the balance rather than an admission about the data.
          <p className="text-[11px]" style={{ color: 'var(--dim)' }}>Not enough history for a trend yet</p>
        )}
      </div>

      {/* Credit-specific secondary information */}
      {isCard && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          {utilization != null ? (
            <>
              <div className="flex justify-between items-baseline text-[11px] mb-1.5 gap-2">
                <span style={{ color: 'var(--muted)' }}>
                  <span className="tabular-nums">{dollars(Math.max(0, limit - owed))}</span> available
                </span>
                <span className="tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>
                  {percent(utilization, 0, true)} of {dollars(limit)}
                </span>
              </div>
              <ProgressBar
                value={utilization}
                colorAuto
                height={5}
                label={`${account.name} credit use: ${percent(utilization, 0, true)} of limit. ${UTILIZATION_LABELS[band]}.`}
              />
              <p className="text-[10px] mt-1.5" style={{ color: band === 'high' ? 'var(--neg)' : 'var(--dim)' }}>
                {UTILIZATION_LABELS[band]}
              </p>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--dim)' }}>
              No credit limit recorded, so usage cannot be shown.
            </p>
          )}
        </div>
      )}

      {/* Contextual navigation + card-specific action */}
      <div className="mt-3 pt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1" style={{ borderTop: '1px solid var(--line)' }}>
        <Link
          to={linkToAccountTransactions(account.id)}
          className="text-xs font-medium flex items-center gap-1 whitespace-nowrap"
          style={{ color: 'var(--accent)', minHeight: 40 }}
          aria-label={`View transactions for ${account.name}`}
        >
          View transactions <span aria-hidden="true">→</span>
        </Link>

        {isCard && onRecordPayment && (
          // Deliberately a quiet secondary control. It writes a transfer between
          // two Fintrack accounts — it does not contact a bank — so it must not
          // look like a payment button.
          <button
            onClick={() => onRecordPayment(account)}
            className="text-xs font-medium px-2.5 rounded-lg whitespace-nowrap"
            style={{ color: 'var(--muted)', border: '1px solid var(--line)', minHeight: 36 }}
          >
            Record a payment
          </button>
        )}
      </div>
    </div>
  );
};

export default AccountCard;
