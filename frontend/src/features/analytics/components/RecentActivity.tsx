import React, { useState } from 'react';
import type { Account, Category, Transaction } from '../../../types';
import type { ClassificationContext } from '../types';
import { KIND_COLORS, KIND_LABELS, classifyTransaction } from '../calculations/transactions';
import { cleanDescription } from '../../../utils/api';
import { dayLabel, dollars, plural } from '../format';
import { PanelEmpty, SectionHeader } from './AnalyticsPrimitives';

interface Props {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  ctx: ClassificationContext;
  onNavigate: (to: string, tab?: string) => void;
}

const COUNT = 5;

/**
 * A short tail of what actually happened, so the page ends in specifics rather
 * than aggregates. Deliberately understated — five rows, no chart, and a link
 * out. Anything more would compete with the Transactions page.
 */
const RecentActivity: React.FC<Props> = ({ transactions, accounts, categories, ctx, onNavigate }) => {
  // Collapsed by default: this sits at the bottom of a long page and repeats
  // what the Transactions page does better. It is here for a quick glance,
  // not to be scrolled past every visit.
  const [open, setOpen] = useState(false);
  const accountName = (id: number) => accounts.find(a => a.id === id)?.name ?? null;
  const category = (id: number | null) => (id == null ? null : categories.find(c => c.id === id) ?? null);

  const recent = [...transactions]
    .sort((a, b) => {
      const byDate = b.transaction_date.localeCompare(a.transaction_date);
      return byDate !== 0 ? byDate : b.id - a.id;
    })
    .slice(0, COUNT);

  return (
    <section className="ledger-panel p-4 md:p-5" aria-labelledby="analytics-activity-heading">
      <SectionHeader
        id="analytics-activity-heading"
        eyebrow="Recent activity"
        title="The latest in this period"
        toggle={{ open, onToggle: () => setOpen(v => !v), controls: 'analytics-activity-body' }}
        collapsedSummary={recent.length > 0
          ? `${plural(Math.min(recent.length, COUNT), 'transaction')}, most recent ${dayLabel(recent[0].transaction_date)}`
          : 'No transactions in this period'}
        right={
          <button
            type="button"
            onClick={() => onNavigate('/transactions')}
            className="text-xs font-semibold pressable"
            style={{ color: 'var(--accent)' }}
          >
            All transactions →
          </button>
        }
      />

      <div id="analytics-activity-body" hidden={!open}>
      {recent.length === 0 ? (
        <PanelEmpty
          title="No transactions in this period"
          body="Change the period above, or add a transaction to get started."
        />
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
          {recent.map(tx => {
            const amount = Number(tx.amount);
            const kind = classifyTransaction(tx, ctx);
            const cat = category(tx.category_id);
            // Always state how the row was counted. A salary must never read
            // as anything other than "Income".
            const status = KIND_LABELS[kind];
            const positive = amount > 0;

            return (
              <li key={tx.id}>
                <button
                  type="button"
                  onClick={() => onNavigate('/transactions')}
                  className="w-full flex items-center gap-3 py-3 text-left"
                  style={{ minHeight: 44 }}
                  aria-label={`${cleanDescription(tx.description)}, ${status}, ${dollars(Math.abs(amount))} on ${dayLabel(tx.transaction_date)}. Open transactions.`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: cat?.color ?? 'var(--line-strong)' }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                      {cleanDescription(tx.description)}
                    </span>
                    <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--dim)' }}>
                      {cat ? cat.name : 'Uncategorized'} · {status}
                      <span className="hidden sm:inline">
                        {` · ${dayLabel(tx.transaction_date)}`}
                        {accountName(tx.account_id) && ` · ${accountName(tx.account_id)}`}
                      </span>
                    </span>
                    <span className="sm:hidden block text-[11px] truncate" style={{ color: 'var(--dim)' }}>
                      {dayLabel(tx.transaction_date)}
                      {accountName(tx.account_id) && ` · ${accountName(tx.account_id)}`}
                    </span>
                  </span>
                  <span
                    className="hidden md:inline-flex items-center rounded-full font-mono shrink-0"
                    style={{
                      fontSize: 9, padding: '2px 7px',
                      color: KIND_COLORS[kind], backgroundColor: 'var(--elev-sub)',
                    }}
                  >
                    {status}
                  </span>
                  <span
                    className="font-mono tabular-nums text-sm font-semibold shrink-0"
                    style={{ color: positive ? 'var(--pos)' : 'var(--fg)' }}
                  >
                    {positive ? '+' : '−'}{dollars(Math.abs(amount))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </section>
  );
};

export default RecentActivity;
