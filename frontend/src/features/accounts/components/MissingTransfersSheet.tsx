import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import BottomSheet from '../../../components/BottomSheet';
import type { MissingTransfer } from '../../../types';
import { getMissingTransfers, restoreMissingTransfers } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import { MINUS, dollars, plural } from '../../analytics/format';

/**
 * Bring back card payments and transfers that were deleted after import.
 *
 * They were deleted because a transfer used to count as spending on one side
 * and income on the other. They come back filed as Transfers, which never
 * count as either, so each account's history is right again and no total
 * moves. Only what the bank lists, and the ledger lacks, can be restored; the
 * server checks both again when asked.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRestored: (count: number) => void;
}

type Status = 'loading' | 'ready' | 'error' | 'no-bank';

const dateLabel = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const signed = (value: number) => `${value < 0 ? MINUS : '+'}${dollars(Math.abs(value))}`;

const MissingTransfersSheet: React.FC<Props> = ({ isOpen, onClose, onRestored }) => {
  const toast = useToast();
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<MissingTransfer[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { data } = await getMissingTransfers();
      setRows(data.rows);
      setUnavailable(data.unavailable);
      setChosen(new Set(data.rows.map(r => r.plaid_transaction_id)));
      setStatus('ready');
    } catch (error) {
      setStatus(isAxiosError(error) && error.response?.status === 404 ? 'no-bank' : 'error');
    }
  }, []);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const byAccount = useMemo(() => {
    const groups = new Map<string, MissingTransfer[]>();
    rows.forEach(r => groups.set(r.account_name, [...(groups.get(r.account_name) ?? []), r]));
    return Array.from(groups.entries());
  }, [rows]);

  const toggle = (id: string) => setChosen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allChosen = rows.length > 0 && chosen.size === rows.length;

  const restore = async () => {
    setRestoring(true);
    try {
      const { data } = await restoreMissingTransfers(Array.from(chosen));
      toast.success(data.restored > 0 ? `Restored ${plural(data.restored, 'transfer')}` : 'Nothing needed restoring');
      onRestored(data.restored);
      onClose();
    } catch (error) {
      const detail = isAxiosError(error) ? error.response?.data?.detail : null;
      toast.error(typeof detail === 'string' ? detail : 'Could not restore them. Try again in a minute.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Missing card payments and transfers">
      <div className="px-5 pb-6 space-y-4">
        {status === 'loading' && (
          <p className="text-sm" role="status" style={{ color: 'var(--muted)' }}>
            Asking your banks for their full history. This can take a few seconds.
          </p>
        )}

        {status === 'error' && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--fg)' }}>Your banks could not be reached.</p>
            <button type="button" onClick={load} className="btn-ghost px-4 py-2">Try again</button>
          </div>
        )}

        {status === 'no-bank' && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No bank is connected, so there is nothing to bring back. Missing rows on an account you keep by hand have to be added by hand.
          </p>
        )}

        {status === 'ready' && (
          <>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              {rows.length === 0
                ? 'Nothing is missing: your banks have no card payments or transfers that Fintrack lacks.'
                : 'Your banks have these and Fintrack does not. They come back as Transfers, so they fix each account’s history and never count as income or spending.'}
            </p>
            {unavailable.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--neg)' }}>
                {unavailable.join(', ')} could not be asked, so anything missing there is not listed.
              </p>
            )}

            {rows.length > 0 && (
              <>
                <label className="flex items-center gap-3 min-h-[44px] cursor-pointer text-sm font-medium" style={{ color: 'var(--fg)' }}>
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={allChosen}
                    onChange={() => setChosen(allChosen ? new Set() : new Set(rows.map(r => r.plaid_transaction_id)))}
                  />
                  All {rows.length}
                </label>
                {byAccount.map(([accountName, group]) => (
                  <section key={accountName} aria-label={accountName}>
                    <h3 className="label mb-1">{accountName}</h3>
                    <ul className="row-list">
                      {group.map(r => (
                        <li key={r.plaid_transaction_id}>
                          <label className="flex items-center gap-3 py-2 min-h-[44px] cursor-pointer">
                            <input
                              type="checkbox"
                              className="w-4 h-4 shrink-0"
                              checked={chosen.has(r.plaid_transaction_id)}
                              onChange={() => toggle(r.plaid_transaction_id)}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm truncate" style={{ color: 'var(--fg)' }}>{r.description}</span>
                              <span className="block text-xs" style={{ color: 'var(--muted)' }}>{dateLabel(r.date)}</span>
                            </span>
                            <span className="text-sm font-mono tabular-nums shrink-0" style={{ color: 'var(--fg)' }}>
                              {signed(Number(r.amount))}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                <button
                  type="button"
                  onClick={restore}
                  disabled={restoring || chosen.size === 0}
                  className="btn-gradient w-full py-3.5 disabled:opacity-40"
                >
                  {restoring ? 'Restoring…' : `Restore ${plural(chosen.size, 'row')} as transfers`}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
};

export default MissingTransfersSheet;
