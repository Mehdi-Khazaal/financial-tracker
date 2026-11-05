import React from 'react';
import { Link } from 'react-router-dom';
import type { Account } from '../../../types';
import { ACCOUNT_TYPE_META } from '../../../components/dashboard/DashboardPrimitives';
import { describeBalance } from '../calculations/accounts';
import { linkToAccountTransactions, linkToBanking } from '../../../lib/deepLinks';

/**
 * Account tiles.
 *
 * The only change of substance is credit cards. The stored balance is still
 * negative — that is what it is — but the tile now reads "$213.37 owed" rather
 * than "−$213.37", which is how the Accounts and Cards views have always
 * phrased it. Overview was the odd one out.
 */

const TONE_COLORS: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'var(--pos)',
  negative: 'var(--neg)',
  neutral: 'var(--fg)',
};

const AccountsGrid: React.FC<{ accounts: Account[] }> = ({ accounts }) => {
  if (accounts.length === 0) {
    return (
      <Link
        to={linkToBanking()}
        className="row-link block py-3.5 text-sm"
        style={{ color: 'var(--muted)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
      >
        Add an account to start tracking balances
      </Link>
    );
  }

  return (
    <ul className="row-list">
      {accounts.slice(0, 6).map(account => {
        const meta = ACCOUNT_TYPE_META[account.type] ?? ACCOUNT_TYPE_META.checking;
        const balance = describeBalance(account);

        return (
          // The useful next question about a balance is what moved it, so the
          // row opens the timeline already filtered to this account.
          <li key={account.id}>
            <Link
              to={linkToAccountTransactions(account.id)}
              aria-label={`${account.name}: ${balance.srText}. View transactions.`}
              className="row-link flex items-center gap-3 py-3"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate" style={{ color: 'var(--fg)' }}>{account.name}</span>
                <span className="block text-xs truncate" style={{ color: 'var(--dim)' }}>{meta.label}</span>
              </span>
              {/* The row's aria-label already speaks the balance, so the visual
                  figure is decorative to a screen reader rather than repeated. */}
              <span className="text-right shrink-0" aria-hidden="true">
                <span className="block font-mono tabular-nums text-sm font-medium" style={{ color: TONE_COLORS[balance.tone] }}>
                  {balance.text}
                </span>
                {balance.detail && (
                  <span className="block text-xs" style={{ color: 'var(--dim)' }}>{balance.detail}</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}

      {accounts.length > 6 && (
        <li>
          <Link to={linkToBanking()} className="row-link block py-3 text-sm" style={{ color: 'var(--accent)' }}>
            +{accounts.length - 6} more
          </Link>
        </li>
      )}
    </ul>
  );
};

export default AccountsGrid;
