import React from 'react';
import { Link } from 'react-router-dom';
import type { Account } from '../../../types';
import { ACCOUNT_TYPE_META, AccountTypeIcon } from '../../../components/dashboard/DashboardPrimitives';
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
        className="block w-full rounded-lg py-10 text-center text-sm transition-all"
        style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px dashed var(--line)' }}
      >
        Add an account to start tracking balances
      </Link>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 md:gap-3">
      {accounts.slice(0, 6).map(account => {
        const meta = ACCOUNT_TYPE_META[account.type] ?? ACCOUNT_TYPE_META.checking;
        const balance = describeBalance(account);

        return (
          // The useful next question about a balance is what moved it, so the
          // tile opens the timeline already filtered to this account.
          <Link
            key={account.id}
            to={linkToAccountTransactions(account.id)}
            aria-label={`${account.name}: ${balance.srText}. View transactions.`}
            className="card-hover rounded-lg p-3 md:p-4 min-w-0 block"
            style={{ backgroundColor: 'var(--elev-1)' }}
          >
            <div className="flex items-center gap-1.5 md:gap-2 mb-2 md:mb-3">
              <AccountTypeIcon type={account.type} />
              <p className="label truncate text-[10px] md:text-xs">{meta.label}</p>
            </div>
            <p className="text-xs truncate mb-0.5 md:mb-1" style={{ color: 'var(--muted)' }}>{account.name}</p>

            {/* The tile's aria-label already speaks the balance, so the visual
                figure is decorative to a screen reader rather than repeated. */}
            <p
              className="font-mono tabular-nums text-base md:text-lg font-medium leading-tight break-words"
              style={{ color: TONE_COLORS[balance.tone] }}
              aria-hidden="true"
            >
              {balance.text}
            </p>

            {balance.detail && (
              <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--dim)' }} aria-hidden="true">
                {balance.detail}
              </p>
            )}
          </Link>
        );
      })}

      {accounts.length > 6 && (
        <Link
          to={linkToBanking()}
          className="rounded-lg p-3 md:p-4 flex items-center justify-center text-sm transition-colors"
          style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', minHeight: 44 }}
        >
          +{accounts.length - 6} more
        </Link>
      )}
    </div>
  );
};

export default AccountsGrid;
