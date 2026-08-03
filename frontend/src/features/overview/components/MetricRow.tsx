import React from 'react';
import { Link } from 'react-router-dom';
import { InfoHint } from '../../analytics/components/AnalyticsPrimitives';
import { MINUS, dollars, percent } from '../../analytics/format';
import { linkToCards, linkToSavings } from '../../../lib/deepLinks';
import type { SpendingPace } from '../calculations/brief';

/**
 * The secondary metric band.
 *
 * These four used to live inside the net-worth hero as a 2×2 grid, which had
 * two problems. Assets and investments are *excluded* from net worth, so
 * printing them inside that card implied the opposite; and month spending is a
 * secondary question sharing space with the page's primary one.
 *
 * Pulling them out lets the hero say one thing, and gives each metric a
 * destination — every tile here is a link to the page that explains it.
 */

interface Props {
  monthName: string;
  income: number;
  expenses: number;
  pace: SpendingPace | null;
  physicalAssets: number;
  investments: number;
  cardDebt: number;
  cardUtilization: number | null;
  showAssets: boolean;
  /** Total set aside against goals. */
  allocatedToGoals: number;
  goalCount: number;
}

const Tile: React.FC<{
  label: string;
  hint?: string;
  to?: string;
  children: React.ReactNode;
}> = ({ label, hint, to, children }) => {
  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-1.5">
        <p className="label truncate">{label}</p>
        {hint && <InfoHint label={`What ${label} means`} text={hint} />}
      </div>
      {children}
    </>
  );

  const className = 'ledger-cell px-3.5 py-3 min-w-0 block';
  return to
    ? <Link to={to} className={`${className} card-hover`}>{body}</Link>
    : <div className={className}>{body}</div>;
};

const MetricRow: React.FC<Props> = ({
  monthName, income, expenses, pace, physicalAssets, investments,
  cardDebt, cardUtilization, showAssets, allocatedToGoals, goalCount,
}) => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3">
    <Tile
      label={`${monthName} spending`}
      hint="Money spent this month. Refunds reduce the category they came from; credit-card payments and transfers between your own accounts are excluded."
      to="/?tab=analytics"
    >
      <p className="font-mono tabular-nums text-lg font-semibold leading-tight" style={{ color: 'var(--neg)' }}>
        {MINUS}{dollars(expenses)}
      </p>
      <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--dim)' }}>
        {pace
          ? `${percent(Math.abs(pace.delta))} ${pace.delta < 0 ? 'below' : 'above'} usual`
          : `+${dollars(income)} in`}
      </p>
    </Tile>

    <Tile
      label="Cards"
      hint="Total owed across your credit cards. The purchases behind it were already counted as spending, so paying a card down is not new spending."
      to={linkToCards()}
    >
      <p
        className="font-mono tabular-nums text-lg font-semibold leading-tight"
        style={{ color: cardDebt > 0 ? 'var(--neg)' : 'var(--pos)' }}
      >
        {cardDebt > 0 ? `${dollars(cardDebt)}` : 'Paid off'}
      </p>
      <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--dim)' }}>
        {cardDebt > 0
          ? cardUtilization != null ? `${percent(cardUtilization, 0, true)} of limit used` : 'owed'
          : 'Nothing outstanding'}
      </p>
    </Tile>

    {showAssets && (
      <Tile
        label="Investments"
        hint="Current value of your holdings. Tracked separately from net worth, which covers account balances only. Live prices are fetched on the Portfolio page."
        to="/portfolio"
      >
        <p className="font-mono tabular-nums text-lg font-semibold leading-tight" style={{ color: '#a855f7' }}>
          {dollars(investments)}
        </p>
        <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--dim)' }}>
          {physicalAssets > 0 ? `+ ${dollars(physicalAssets)} in assets` : 'Not in net worth'}
        </p>
      </Tile>
    )}

    <Tile
      label="Set aside"
      hint="Money you have labelled against savings goals. It still sits in your accounts — this is a label, not a separate balance, so it is not added to anything."
      to={linkToSavings()}
    >
      <p className="font-mono tabular-nums text-lg font-semibold leading-tight" style={{ color: 'var(--pos)' }}>
        {dollars(allocatedToGoals)}
      </p>
      <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--dim)' }}>
        {goalCount === 0
          ? 'No goals yet'
          : `across ${goalCount === 1 ? '1 goal' : `${goalCount} goals`}`}
      </p>
    </Tile>
  </div>
);

export default MetricRow;
