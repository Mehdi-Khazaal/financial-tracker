import React from 'react';
import { InfoHint } from '../../analytics/components/AnalyticsPrimitives';
import { dollars, percent } from '../../analytics/format';
import { UTILIZATION_LABELS, utilizationBand } from '../calculations/cards';
import type { AccountTotals } from '../calculations/totals';
import type { NetWorthBreakdown } from '../../portfolio/calculations/wealth';

/**
 * The Accounts position, in one card.
 *
 * Five figures that are routinely confused for one another, shown together so
 * the difference is visible rather than implied. Each has a tooltip carrying
 * its exact population, because "how much money do I have" has four defensible
 * answers and the useful thing is knowing which one you are reading.
 *
 * Net worth leads because it is the only one that accounts for what you owe.
 * The others sit beneath it at equal weight — none is a headline, and none is
 * a restatement of another.
 */

export const DEFINITIONS = {
  netWorth:
    'Your account balances, with credit-card balances subtracting and brokerage cash left out, plus everything you hold at its current value. The same figure the Dashboard, Analytics, Portfolio and Fin show.',
  availableToSpend:
    'Checking and cash that is not set aside for a goal — money you can spend without moving anything first or breaking a promise to a goal. Savings, brokerage and credit are excluded.',
  liquid:
    'Checking, savings and cash. Money you hold, whether or not it is earmarked for something.',
  brokerage:
    'Cash balances sitting in brokerage accounts. Kept out of net worth because your holdings are already valued there; counting both would double the same money.',
  cardDebt:
    'Total owed across your credit cards, shown as a positive amount. The purchases behind it were already counted as spending, so paying a card down is not new spending.',
} as const;

interface Props {
  totals: AccountTotals;
  /** The one net worth: these accounts plus holdings. */
  netWorth: NetWorthBreakdown;
}

const Figure: React.FC<{
  label: string;
  hint: string;
  value: string;
  color?: string;
  note?: string;
}> = ({ label, hint, value, color = 'var(--fg)', note }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-1.5 mb-1">
      {/* Wraps rather than truncates — "Available to spend" is the whole point
          of the figure, and "AVAILABLE TO SPE…" tells the user nothing. */}
      <p className="label">{label}</p>
      <InfoHint label={`What ${label} means`} text={hint} />
    </div>
    <p className="font-mono tabular-nums text-sm font-semibold" style={{ color }}>{value}</p>
    {note && <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--dim)' }}>{note}</p>}
  </div>
);

const AccountsSummary: React.FC<Props> = ({ totals, netWorth }) => {
  const band = utilizationBand(totals.utilization);

  return (
    <section
      className="hero-card rounded-xl p-5 md:p-6"
      aria-labelledby="accounts-position-heading"
      style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}
    >
      <div className="relative" style={{ zIndex: 1 }}>
        <div className="flex items-center gap-1.5 mb-1">
          <p className="label" id="accounts-position-heading">Net worth</p>
          <InfoHint label="How net worth is calculated" text={DEFINITIONS.netWorth} />
        </div>
        <p
          className="font-bold value-display"
          style={{ fontSize: 'clamp(1.9rem, 4vw, 2.6rem)', color: netWorth.total < 0 ? 'var(--neg)' : 'var(--fg)' }}
        >
          {netWorth.total < 0 ? '−' : ''}{dollars(Math.abs(netWorth.total))}
        </p>
        {netWorth.holdingCount > 0 && (
          <p className="font-mono tabular-nums text-xs mt-1" style={{ color: 'var(--dim)' }}>
            {netWorth.accounts < 0 ? '−' : ''}{dollars(Math.abs(netWorth.accounts))} in accounts · {dollars(netWorth.holdings)} in holdings
          </p>
        )}

        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4 mt-5 pt-5"
          style={{ borderTop: '1px solid var(--line)' }}
        >
          <Figure
            label="Available to spend"
            hint={DEFINITIONS.availableToSpend}
            value={dollars(totals.availableToSpend)}
            color="var(--pos)"
            note={totals.setAside > 0 ? `${dollars(totals.setAside)} set aside for goals` : 'Checking and cash'}
          />
          <Figure
            label="Liquid funds"
            hint={DEFINITIONS.liquid}
            value={dollars(totals.liquid)}
            note="Plus savings"
          />
          {totals.investmentAccounts !== 0 && (
            <Figure
              label="Brokerage cash"
              hint={DEFINITIONS.brokerage}
              value={dollars(totals.investmentAccounts)}
              color="var(--cat-4)"
              note="Not in net worth"
            />
          )}
          <Figure
            label="Card debt"
            hint={DEFINITIONS.cardDebt}
            value={totals.cardDebt > 0 ? dollars(totals.cardDebt) : 'None'}
            color={totals.cardDebt > 0 ? 'var(--neg)' : 'var(--pos)'}
            note={totals.utilization != null
              ? `${percent(totals.utilization, 0, true)} of limit · ${UTILIZATION_LABELS[band]}`
              : totals.cardDebt > 0 ? 'No limit recorded' : 'Nothing outstanding'}
          />
        </div>
      </div>
    </section>
  );
};

export default AccountsSummary;
