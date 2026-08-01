import React from 'react';
import type { Account, Transaction } from '../../../types';
import type { CategoryDetail, ResolvedPeriod } from '../types';
import { dayLabel, dollars, percent, plural } from '../format';
import { cleanDescription } from '../../../utils/api';
import BottomSheet from '../../../components/BottomSheet';
import { ConfidenceChip, DeltaBadge } from './AnalyticsPrimitives';

interface Props {
  detail: CategoryDetail | null;
  period: ResolvedPeriod;
  accounts: Account[];
  onClose: () => void;
  onNavigate: (to: string, tab?: string) => void;
}

/**
 * The drill-down that turns a category total into an explanation.
 *
 * Reuses `BottomSheet` — the app's existing modal, complete with focus
 * trapping, Escape handling and safe-area padding — rather than introducing a
 * second overlay pattern. Everything shown respects the active period; the
 * six-month trend is the one exception and is labelled as such.
 */
const CategoryDetailDrawer: React.FC<Props> = ({ detail, period, accounts, onClose, onNavigate }) => {
  if (!detail) return null;

  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? 'Unknown account';
  const trendMax = Math.max(...detail.monthlyTrend.map(m => m.value), 1);
  const comparisonLabel = period.previous
    ? (period.previous.months.length === 1 ? 'previous month' : 'previous period')
    : null;

  return (
    <BottomSheet isOpen onClose={onClose} title={detail.name}>
      <div className="p-5 space-y-5">

        {/* ── Headline ── */}
        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="label mb-1.5">Spent in {period.label}</p>
              <p
                className="font-mono tabular-nums text-2xl font-bold leading-none"
                style={{ color: 'var(--fg)' }}
              >
                {dollars(detail.current)}
              </p>
            </div>
            <span
              className="w-3 h-3 rounded-full shrink-0 mb-1"
              style={{ backgroundColor: detail.color }}
              aria-hidden="true"
            />
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
            {percent(detail.share, 1)} of everything you spent in this period.
          </p>
        </div>

        {/* ── Comparisons ── */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="ledger-cell p-3.5">
            <p className="label mb-1.5">
              vs {comparisonLabel ?? 'previous'}
            </p>
            {comparisonLabel ? (
              <>
                <DeltaBadge value={detail.deltaVsPrevious} polarity="down-good" size="md" />
                <p className="font-mono tabular-nums text-[11px] mt-1.5" style={{ color: 'var(--dim)' }}>
                  was {dollars(detail.previous)}
                </p>
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--dim)' }}>No earlier period</p>
            )}
          </div>

          <div className="ledger-cell p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <p className="label">vs average</p>
              <ConfidenceChip months={detail.baselineMonths} />
            </div>
            {detail.baselineMonths > 0 ? (
              <>
                <DeltaBadge value={detail.deltaVsAverage} polarity="down-good" size="md" />
                <p className="font-mono tabular-nums text-[11px] mt-1.5" style={{ color: 'var(--dim)' }}>
                  usually {dollars(detail.average)}
                </p>
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--dim)' }}>No completed months yet</p>
            )}
          </div>
        </div>

        {detail.drivenByOneTransaction && detail.largestTransaction && (
          <p
            className="text-xs leading-relaxed rounded-lg p-3"
            style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}
          >
            Most of the rise here is one purchase —{' '}
            <span style={{ color: 'var(--fg)' }}>{cleanDescription(detail.largestTransaction.description)}</span> at{' '}
            <span className="font-mono tabular-nums" style={{ color: 'var(--fg)' }}>
              {dollars(Math.abs(Number(detail.largestTransaction.amount)))}
            </span>
            . If that was a one-off, the rest of the category is running normally.
          </p>
        )}

        {/* ── Shape of the spend ── */}
        <dl className="grid grid-cols-3 gap-2.5">
          {[
            { label: 'Transactions', value: String(detail.transactionCount) },
            { label: 'Average', value: dollars(detail.averageTransaction) },
            {
              label: 'Largest',
              value: detail.largestTransaction
                ? dollars(Math.abs(Number(detail.largestTransaction.amount)))
                : '—',
            },
          ].map(item => (
            <div key={item.label} className="ledger-cell p-3">
              <dt className="label mb-1.5">{item.label}</dt>
              <dd className="font-mono tabular-nums text-sm font-semibold" style={{ color: 'var(--fg)' }}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* ── Trend ── */}
        <div>
          <p className="label mb-3">Last {detail.monthlyTrend.length} months</p>
          <div className="flex items-end gap-1.5" style={{ height: 72 }}>
            {detail.monthlyTrend.map(point => (
              <div key={point.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max(2, (point.value / trendMax) * 100)}%`,
                      backgroundColor: detail.color,
                      opacity: period.months.indexOf(point.month) >= 0 ? 1 : 0.4,
                    }}
                    title={`${point.label}: ${dollars(point.value)}`}
                  />
                </div>
                <span className="text-[9px] truncate w-full text-center" style={{ color: 'var(--dim)' }}>
                  {point.label.split(' ')[0]}
                </span>
              </div>
            ))}
          </div>
          <p className="sr-only">
            {detail.monthlyTrend.map(p => `${p.label}: ${dollars(p.value)}`).join('. ')}
          </p>
        </div>

        {/* ── Merchants ── */}
        {detail.topMerchants.length > 0 && (
          <div>
            <p className="label mb-2.5">Top merchants in this period</p>
            <ul className="space-y-2">
              {detail.topMerchants.map(merchant => (
                <li key={merchant.key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>
                      {merchant.name}
                    </p>
                    <p className="text-[10px]" style={{ color: 'var(--dim)' }}>
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
          <p className="label mb-2.5">
            {plural(detail.transactions.length, 'transaction')} in {period.label}
          </p>
          {detail.transactions.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--dim)' }}>
              Nothing recorded in this category for the selected period.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {detail.transactions.slice(0, 12).map((tx: Transaction) => {
                const amount = Number(tx.amount);
                const isRefund = amount > 0;
                return (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-3 py-2"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }}>
                        {cleanDescription(tx.description)}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>
                        {dayLabel(tx.transaction_date)} · {accountName(tx.account_id)}
                        {isRefund && ' · refund'}
                      </p>
                    </div>
                    <p
                      className="font-mono tabular-nums text-xs font-semibold shrink-0"
                      style={{ color: isRefund ? 'var(--pos)' : 'var(--fg)' }}
                    >
                      {isRefund ? '+' : '−'}{dollars(Math.abs(amount))}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          {detail.transactions.length > 12 && (
            <p className="text-[10px] mt-2" style={{ color: 'var(--dim)' }}>
              Showing 12 of {detail.transactions.length}.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => { onClose(); onNavigate('/transactions'); }}
          className="btn-gradient w-full py-3 text-sm"
        >
          View all transactions
        </button>
      </div>
    </BottomSheet>
  );
};

export default CategoryDetailDrawer;
