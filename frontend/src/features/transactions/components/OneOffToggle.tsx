import React, { useEffect, useState } from 'react';
import type { Transaction } from '../../../types';
import type { ClassificationContext } from '../../analytics/types';
import { ONE_OFF_MIN, automaticOneOff } from '../../analytics/calculations/oneOffs';
import { dollars } from '../../analytics/format';
import { updateTransaction } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';

/**
 * Whether a charge is a big one-off, left out of the usual month the goal
 * plan funds goals from.
 *
 * The rule decides by default (see `oneOffs.ts`); the user can say otherwise
 * either way, and hand it back to the rule. Saves straight away: it moves no
 * money, so there is nothing to confirm.
 */

interface Props {
  transaction: Transaction;
  /** History to judge "does it repeat" against; the more, the better. */
  history: Transaction[];
  ctx: ClassificationContext;
  onSaved: () => void;
}

const OneOffToggle: React.FC<Props> = ({ transaction, history, ctx, onSaved }) => {
  const toast = useToast();
  const [mark, setMark] = useState<boolean | null>(transaction.one_off ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setMark(transaction.one_off ?? null); }, [transaction]);

  const automatic = automaticOneOff(transaction, history.length > 0 ? history : [transaction], ctx);
  if (automatic === null) return null;
  const effective = mark ?? automatic;

  const save = async (value: boolean | null) => {
    const previous = mark;
    setMark(value);
    setSaving(true);
    try {
      await updateTransaction(transaction.id, { one_off: value });
      onSaved();
    } catch {
      setMark(previous);
      toast.error('Could not save that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4">
      <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
        <input
          type="checkbox"
          className="mt-1 w-4 h-4"
          checked={effective}
          disabled={saving}
          onChange={e => save(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium" style={{ color: 'var(--fg)' }}>Big one-off</span>
          <span className="block text-xs" style={{ color: 'var(--muted)' }}>
            Left out of a usual month, the one your goal plan funds goals from.{' '}
            {mark == null
              ? automatic
                ? `Set automatically: ${dollars(ONE_OFF_MIN, 0)} or more, and it does not repeat.`
                : 'Set automatically.'
              : 'Marked by you.'}
          </span>
        </span>
      </label>
      {mark != null && (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={saving}
          className="text-xs font-medium ml-7"
          style={{ color: 'var(--accent)', minHeight: 32 }}
        >
          Let Fintrack decide
        </button>
      )}
    </div>
  );
};

export default OneOffToggle;
