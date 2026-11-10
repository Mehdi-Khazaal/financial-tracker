import React from 'react';
import { Link } from 'react-router-dom';
import { InfoHint } from '../../analytics/components/AnalyticsPrimitives';
import { dollars, percent } from '../../analytics/format';
import { linkToCards, linkToSavings } from '../../../lib/deepLinks';
import type { SpendingPace } from '../calculations/brief';
import type { RecurringMonth } from '../../analytics/types';

/**
 * The secondary metric band.
 *
 * These four used to live inside the net-worth hero as a 2×2 grid, where month
 * spending was a secondary question sharing space with the page's primary one.
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
  /** No credit card account means no Cards tile, rather than "Paid off". */
  hasCards?: boolean;
  showAssets: boolean;
  /** Total set aside against goals. */
  allocatedToGoals: number;
  goalCount: number;
  /** This month's recurring bills, from the server. Null hides the tile. */
  recurringMonth?: RecurringMonth | null;
  recurringCount?: number;
}

const Tile: React.FC<{
  label: string;
  hint?: string;
  to?: string;
  children: React.ReactNode;
}> = ({ label, hint, to, children }) => {
  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-1">
        <p className="metric-label truncate">{label}</p>
        {hint && <InfoHint label={`What ${label} means`} text={hint} />}
      </div>
      {children}
    </>
  );

  return to
    ? <Link to={to} className="metric-tile min-w-0 block">{body}</Link>
    : <div className="metric-tile min-w-0">{body}</div>;
};

const MetricRow: React.FC<Props> = ({
  monthName, income, expenses, pace, physicalAssets, investments,
  cardDebt, cardUtilization, hasCards = true, showAssets, allocatedToGoals, goalCount,
  recurringMonth = null, recurringCount = 0,
}) => {
  const showRecurring = recurringMonth != null && (recurringCount > 0 || recurringMonth.expected > 0);
  const tileCount = 2 + (hasCards ? 1 : 0) + (showAssets ? 1 : 0) + (showRecurring ? 1 : 0);
  // Written out in full so Tailwind finds the class names.
  const desktopColumns = tileCount === 5 ? 'lg:grid-cols-5' : tileCount === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';

  return (
  <div className={`metric-strip grid grid-cols-2 ${desktopColumns}`}>
    <Tile
      label={`${monthName} spending`}
      hint="Money spent this month. Refunds reduce the category they came from; credit-card payments and transfers between your own accounts are excluded."
      to="/?tab=analytics"
    >
      <p className="metric-value">
        {dollars(expenses)}
      </p>
      <p className="metric-note">
        {pace
          ? `${percent(Math.abs(pace.delta))} ${pace.delta < 0 ? 'below' : 'above'} usual`
          : `+${dollars(income)} in`}
      </p>
    </Tile>

    {showRecurring && recurringMonth && (
      <Tile
        label="Bills this month"
        hint="What your tracked recurring bills and subscriptions cost this calendar month: what has already been paid, plus every charge still due before the month ends. Manage them on the Recurring page."
        to="/recurring"
      >
        <p className="metric-value">
          {dollars(recurringMonth.expected)}
        </p>
        <p className="metric-note tabular-nums">
          {recurringMonth.remaining > 0
            ? `${dollars(recurringMonth.paid)} paid · ${dollars(recurringMonth.remaining)} to come`
            : 'All paid this month'}
        </p>
      </Tile>
    )}

    {hasCards && (
      <Tile
        label="Cards"
        hint="Total owed across your credit cards. The purchases behind it were already counted as spending, so paying a card down is not new spending."
        to={linkToCards()}
      >
        <p className="metric-value">
          {cardDebt > 0 ? `${dollars(cardDebt)}` : 'Paid off'}
        </p>
        <p className="metric-note">
          {cardDebt > 0
            ? cardUtilization != null ? `${percent(cardUtilization, 0, true)} of limit used` : 'owed'
            : 'Nothing outstanding'}
        </p>
      </Tile>
    )}

    {showAssets && (
      <Tile
        label="Investments"
        hint="Current value of your investments, priced from the latest stored market price, with your other assets beneath. Both are part of net worth, at the same values Portfolio shows."
        to="/portfolio"
      >
        <p className="metric-value">
          {dollars(investments)}
        </p>
        <p className="metric-note">
          {physicalAssets > 0 ? `+ ${dollars(physicalAssets)} in assets` : 'Held, not spent'}
        </p>
      </Tile>
    )}

    <Tile
      label="Set aside"
      hint="Money you have labelled against savings goals. It still sits in your accounts — this is a label, not a separate balance, so it is not added to anything."
      to={linkToSavings()}
    >
      <p className="metric-value">
        {dollars(allocatedToGoals)}
      </p>
      <p className="metric-note">
        {goalCount === 0
          ? 'No goals yet'
          : `across ${goalCount === 1 ? '1 goal' : `${goalCount} goals`}`}
      </p>
    </Tile>
  </div>
  );
};

export default MetricRow;
