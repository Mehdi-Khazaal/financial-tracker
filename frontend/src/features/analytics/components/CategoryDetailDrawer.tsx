import React from 'react';
import type { Account, Transaction } from '../../../types';
import type { CategoryDetail, ClassificationContext, ResolvedPeriod } from '../types';
import { dayLabel, dollars, percent, plural } from '../format';
import { cleanDescription } from '../../../utils/api';
import BottomSheet from '../../../components/BottomSheet';
import Sparkline from '../../../components/Sparkline';
import { KIND_COLORS, KIND_LABELS, classifyTransaction } from '../calculations/transactions';
import { ConfidenceChip, DeltaBadge } from './AnalyticsPrimitives';
import CategoryIcon from './CategoryIcon';
import { linkToCategoryTransactions } from '../../../lib/deepLinks';

interface Props {
  detail: CategoryDetail | null;
  period: ResolvedPeriod;
  accounts: Account[];
  /** Built once by the page — reused here rather than rebuilt per open. */
  ctx: ClassificationContext;
  onClose: () => void;
  onNavigate: (to: string, tab?: string) => void;
}

const MAX_TRANSACTIONS = 12;

/**
 * The drill-down that turns a category total into an explanation.
 *
 * Reuses `BottomSheet`, which portals to `<body>` — rendering it in place put
 * it inside `.stagger-in`'s transformed wrapper, which becomes the containing
 * block for `position: fixed` and pushed the panel off-screen.
 *
 * Layout is single-column and self-wrapping throughout: merchant names and
 * descriptions truncate rather than forcing horizontal scroll, and rows split
 * their metadata into a left/right hierarchy instead of squeezing four fields
 * onto one line.
 */
const CategoryDetailDrawer: React.FC<Props> = ({
  detail, period, accounts, ctx, onClose, onNavigate,
}) => {
  if (!detail) return null;

  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? 'Unknown account';
  const comparisonLabel = period.previous
    ? (period.previous.months.length === 1 ? 'previous month' : 'previous period')
    : null;

  // A trend needs at least two months that actually had spending — otherwise
  // it is a flat line with one spike, which looks broken rather than empty.
  const monthsWithSpend = detail.monthlyTrend.filter(m => m.value > 0);
  const hasTrend = monthsWithSpend.length >= 2;
  const trendValues = detail.monthlyTrend.map(m => m.value);
  const trendHigh = Math.max(...trendValues, 0);
  const trendLow = Math.min(...monthsWithSpend.map(m => m.value), trendHigh);

  const largestAmount = detail.largestTransaction
    ? Math.abs(Number(detail.largestTransaction.amount))
    : 0;
  const largestShare = detail.current > 0 ? largestAmount / detail.current : 0;

  return (
    <BottomSheet isOpen onClose={onClose} title={detail.name} size="lg">
      <div className="p-4 sm:p-5 space-y-5">

        {/* ── Headline ── */}
        <div className="flex items-start gap-3.5">
          <CategoryIcon name={detail.name} color={detail.color} size={44} />
          <div className="min-w-0 flex-1">
            <p className="label mb-1.5">Spent in {period.label}</p>
            <p
              className="font-mono tabular-nums text-2xl sm:text-[28px] font-bold leading-none"
              style={{ color: 'var(--fg)' }}
            >
              {dollars(detail.current)}
            </p>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
              {percent(detail.share, 1)} of everything you spent in this period
              {detail.transactionCount > 0 && `, across ${plural(detail.transactionCount, 'transaction')}`}.
            </p>
          </div>
        </div>

        {/* ── Comparisons ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="ledger-cell p-3.5">
            <p className="label mb-2">Compared with the {comparisonLabel ?? 'previous period'}</p>
            {comparisonLabel ? (
              <>
                <DeltaBadge value={detail.deltaVsPrevious} polarity="down-good" size="md" />
                <p className="font-mono tabular-nums text-[11px] mt-2" style={{ color: 'var(--dim)' }}>
                  was {dollars(detail.previous)}
                </p>
              </>
            ) : (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                This is your earliest period with data, so there is nothing before it to compare
                against yet.
              </p>
            )}
          </div>

          <div className="ledger-cell p-3.5">
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <p className="label">Compared with typical</p>
              <ConfidenceChip months={detail.baselineMonths} />
            </div>
            {detail.baselineMonths > 0 ? (
              <>
                <DeltaBadge value={detail.deltaVsAverage} polarity="down-good" size="md" />
                <p className="font-mono tabular-nums text-[11px] mt-2" style={{ color: 'var(--dim)' }}>
                  usually {dollars(detail.average)}
                </p>
              </>
            ) : (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                A typical figure needs at least one completed month behind this one. Come back after
                the month turns over.
              </p>
            )}
          </div>
        </div>

        {detail.drivenByOneTransaction && detail.largestTransaction && (
          <p
            className="text-xs leading-relaxed rounded-lg p-3 break-words"
            style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}
          >
            Most of the rise here is one purchase —{' '}
            <span style={{ color: 'var(--fg)' }}>{cleanDescription(detail.largestTransaction.description)}</span> at{' '}
            <span className="font-mono tabular-nums" style={{ color: 'var(--fg)' }}>
              {dollars(largestAmount)}
            </span>
            . If that was a one-off, the rest of the category is running normally.
          </p>
        )}

        {/* ── Shape of the spend ── */}
        <dl className="grid grid-cols-3 gap-2.5">
          <div className="ledger-cell p-3 min-w-0">
            <dt className="label mb-1.5">Transactions</dt>
            <dd className="font-mono tabular-nums text-sm font-semibold" style={{ color: 'var(--fg)' }}>
              {detail.transactionCount}
            </dd>
          </div>
          <div className="ledger-cell p-3 min-w-0">
            <dt className="label mb-1.5">Average</dt>
            <dd className="font-mono tabular-nums text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>
              {dollars(detail.averageTransaction)}
            </dd>
          </div>
          <div className="ledger-cell p-3 min-w-0">
            <dt className="label mb-1.5">Largest</dt>
            <dd className="font-mono tabular-nums text-sm font-semibold truncate" style={{ color: 'var(--fg)' }}>
              {detail.largestTransaction ? dollars(largestAmount) : '—'}
            </dd>
            {/* How much of the category one purchase accounts for — the fastest
                way to see whether a total is one event or a pattern. */}
            {detail.largestTransaction && detail.current > 0 && (
              <dd className="text-[10px] mt-1" style={{ color: 'var(--dim)' }}>
                {percent(largestShare, 0)} of the total
              </dd>
            )}
          </div>
        </dl>

        {/* ── Trend ── */}
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-2.5">
            <p className="label">Last {detail.monthlyTrend.length} months</p>
            {hasTrend && (
              <p className="font-mono tabular-nums text-[10px]" style={{ color: 'var(--dim)' }}>
                low {dollars(trendLow, 0)} · high {dollars(trendHigh, 0)}
              </p>
            )}
          </div>

          {hasTrend ? (
            <>
              <div style={{ height: 64 }}>
                <Sparkline data={trendValues} height={64} color={detail.color} />
              </div>
              <div className="flex mt-1.5">
                {detail.monthlyTrend.map(point => {
                  const inPeriod = period.months.indexOf(point.month) >= 0;
                  return (
                    <span
                      key={point.month}
                      className="flex-1 min-w-0 text-center text-[9px] truncate"
                      style={{
                        color: inPeriod ? 'var(--muted)' : 'var(--dim)',
                        fontWeight: inPeriod ? 600 : 400,
                      }}
                    >
                      {point.label.split(' ')[0]}
                    </span>
                  );
                })}
              </div>
            </>
          ) : (
            <div
              className="rounded-lg px-4 py-5 text-center"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px dashed var(--line)' }}
            >
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                {monthsWithSpend.length === 1
                  ? `${detail.name} has spending in one month so far. A trend line appears once there is a second month to draw between.`
                  : `No spending recorded in ${detail.name} over this window.`}
              </p>
            </div>
          )}

          <p className="sr-only">
            {detail.monthlyTrend.map(p => `${p.label}: ${dollars(p.value)}`).join('. ')}
          </p>
        </div>

        {/* ── Merchants ── */}
        {detail.topMerchants.length > 0 && (
          <div>
            <p className="label mb-2">Top merchants in this period</p>
            <ul className="space-y-1.5">
              {detail.topMerchants.map(merchant => (
                <li key={merchant.key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate leading-tight" style={{ color: 'var(--fg)' }}>
                      {merchant.name}
                    </p>
                    <p className="text-[10px] leading-tight mt-0.5" style={{ color: 'var(--dim)' }}>
                      {plural(merchant.count, 'transaction')} · {dollars(merchant.average)} average
                    </p>
                  </div>
                  <p
                    className="font-mono tabular-nums text-xs font-semibold shrink-0"
                    style={{ color: 'var(--fg)' }}
                  >
                    {dollars(merchant.total)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Transactions ── */}
        <div>
          <p className="label mb-2">
            {plural(detail.transactions.length, 'transaction')} in {period.label}
          </p>
          {detail.transactions.length === 0 ? (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              Nothing recorded in {detail.name} for the selected period.
            </p>
          ) : (
            <ul>
              {detail.transactions.slice(0, MAX_TRANSACTIONS).map((tx: Transaction) => {
                const amount = Number(tx.amount);
                const kind = classifyTransaction(tx, ctx);
                return (
                  <li
                    key={tx.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[13px] font-medium truncate leading-snug"
                        style={{ color: 'var(--fg)' }}
                      >
                        {cleanDescription(tx.description)}
                      </p>
                      <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--dim)' }}>
                        {dayLabel(tx.transaction_date)} · {accountName(tx.account_id)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="font-mono tabular-nums text-[13px] font-semibold leading-snug"
                        style={{ color: amount > 0 ? 'var(--pos)' : 'var(--fg)' }}
                      >
                        {amount > 0 ? '+' : '−'}{dollars(Math.abs(amount))}
                      </p>
                      <p
                        className="text-[9px] mt-1 font-mono uppercase tracking-wider"
                        style={{ color: KIND_COLORS[kind] }}
                      >
                        {KIND_LABELS[kind]}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {detail.transactions.length > MAX_TRANSACTIONS && (
            <p className="text-[10px] mt-2.5" style={{ color: 'var(--dim)' }}>
              Showing {MAX_TRANSACTIONS} of {detail.transactions.length}.
            </p>
          )}
        </div>

        <button
          type="button"
          // Carries the category through rather than dropping the user on an
          // unfiltered list, which was the whole point of clicking from here.
          onClick={() => { onClose(); onNavigate(linkToCategoryTransactions(detail.id)); }}
          className="btn-gradient w-full py-3 text-sm"
        >
          View all transactions
        </button>
      </div>
    </BottomSheet>
  );
};

export default CategoryDetailDrawer;
