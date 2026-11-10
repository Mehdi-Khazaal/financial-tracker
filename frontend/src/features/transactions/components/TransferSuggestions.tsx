import React, { useCallback, useEffect, useState } from 'react';
import type { Account, TransferSuggestion } from '../../../types';
import { getTransferSuggestions, markTransfers, cleanDescription } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { dollars } from '../../analytics/format';

/**
 * "Moves between your accounts" — the top of the Review tab.
 *
 * Card payments and moves to savings used to be deleted after import, because
 * filed as anything else they counted as spending. Deleting them broke every
 * account's history. The server finds rows that look like these moves
 * (`services/transfer_suggestions.py`); this lists them, and filing one under
 * Transfer keeps it in the ledger while leaving it out of every total.
 *
 * Nothing changes until the user taps. A row the user files under anything
 * else simply stops being suggested.
 */

const PREVIEW = 3;

interface Props {
  accounts: Account[];
  /** Called after rows were filed, so the page reloads its transactions. */
  onChanged: () => void;
}

const accountName = (accounts: Account[], id: number | null | undefined) =>
  accounts.find(a => a.id === id)?.name ?? null;

const shortDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function describeMove(s: TransferSuggestion, accounts: Account[]): string {
  const from = accountName(accounts, s.from_account_id);
  const to = accountName(accounts, s.to_account_id);
  if (from && to) return `${from} → ${to}`;
  if (to) return `Into ${to}`;
  if (from) return `Out of ${from}`;
  return cleanDescription(s.descriptions[0] ?? '') || 'Transfer';
}

const TransferSuggestions: React.FC<Props> = ({ accounts, onChanged }) => {
  const toast = useToast();
  const [items, setItems] = useState<TransferSuggestion[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getTransferSuggestions();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch {
      // Suggestions are a convenience on top of Review; without them the
      // page still works, so a failure stays quiet.
      setItems([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const mark = async (ids: number[], key: string, count: number) => {
    setBusy(key);
    try {
      await markTransfers(ids);
      toast.success(count === 1 ? 'Marked as a transfer' : `Marked ${count} as transfers`);
      await load();
      onChanged();
    } catch {
      toast.error('Could not mark these as transfers');
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, PREVIEW);
  const allIds = items.flatMap(s => s.transaction_ids);

  return (
    <section className="mx-3 md:mx-4 mb-3 shrink-0" aria-labelledby="transfer-suggestions-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-2">
        <div className="min-w-0">
          <h2 className="section-title" id="transfer-suggestions-heading">
            Moves between your accounts
            <span className="font-mono tabular-nums ml-2 text-[13px]" style={{ color: 'var(--muted)' }}>{items.length}</span>
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            These look like money moving between your own accounts. As transfers they stay in your history but never count as spending or income.
          </p>
        </div>
        {items.length > 1 && (
          <button
            type="button"
            className="btn-ghost px-3 text-xs font-semibold min-h-[44px] md:min-h-[34px]"
            disabled={busy != null}
            onClick={() => void mark(allIds, 'all', items.length)}
          >
            {busy === 'all' ? 'Marking…' : `Mark all ${items.length} as transfers`}
          </button>
        )}
      </div>

      <ul className="row-list">
        {shown.map(s => {
          const key = s.transaction_ids.join('-');
          return (
            <li key={key} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>
                  {describeMove(s, accounts)}
                  <span className="font-mono tabular-nums ml-2" style={{ color: 'var(--fg)' }}>{dollars(Number(s.amount))}</span>
                </p>
                <p className="text-xs truncate" style={{ color: 'var(--dim)' }}>
                  {shortDate(s.date)} · {s.detail}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost px-3 text-xs font-semibold shrink-0 min-h-[44px] md:min-h-[34px]"
                disabled={busy != null}
                aria-label={`Mark ${describeMove(s, accounts)} ${dollars(Number(s.amount))} as a transfer`}
                onClick={() => void mark(s.transaction_ids, key, 1)}
              >
                {busy === key ? 'Marking…' : 'Mark as transfer'}
              </button>
            </li>
          );
        })}
      </ul>

      {items.length > PREVIEW && (
        <button
          type="button"
          className="section-link mt-2 min-h-[44px] md:min-h-0"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
        >
          {expanded ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
};

export default TransferSuggestions;
