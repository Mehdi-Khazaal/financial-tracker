import React, { useState, useEffect, useId } from 'react';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { getAccounts, getCategories, createCategory, getCollections } from '../../utils/api';
import { enqueue } from '../../utils/mutationQueue';
import { Account, Category, Collection } from '../../types';
import CollectionPicker from '../../features/collections/components/CollectionPicker';
import { CategoryChips, DirectionToggle } from '../../features/transactions/components/TransactionFormFields';
import { localDateStr } from '../../utils/date';
import { useToast } from '../../context/ToastContext';
import { accountOptionLabel } from './accountOptions';
import { selectableCategories } from './categoryOptions';
import { dollars } from '../../features/analytics/format';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultType?: 'income' | 'expense';
  /** Collections to start ticked, e.g. when adding from a collection's page. */
  defaultCollectionIds?: number[];
}

const SWATCHES = ['#f59e0b', '#a855f7', '#ff9f43', '#38bdf8', '#fb7185', '#34d399', '#a3e635', '#e879f9'];

/**
 * Record a transaction by hand. Same fields and controls as editing one, with
 * the save button pinned under the form so it is always in reach.
 */
const AddTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, defaultType = 'expense', defaultCollectionIds }) => {
  const toast = useToast();
  const formId = useId();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [type, setType] = useState<'income' | 'expense'>(defaultType);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(localDateStr());
  const [loading, setLoading] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState(SWATCHES[0]);
  const [addingCat, setAddingCat] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionIds, setCollectionIds] = useState<number[]>([]);

  useEffect(() => { setType(defaultType); }, [defaultType, isOpen]);

  useEffect(() => {
    if (isOpen) {
      Promise.all([getAccounts(), getCategories()]).then(([aRes, cRes]) => {
        setAccounts(aRes.data);
        setCategories(cRes.data);
        // Keep the account used last time, if it still exists.
        if (aRes.data.length > 0) {
          const list: Account[] = aRes.data;
          setAccountId(current => (list.some(a => String(a.id) === current) ? current : String(list[0].id)));
        }
      });
      // Optional: the form works the same without collections.
      setCollectionIds(defaultCollectionIds ?? []);
      getCollections()
        .then(res => setCollections(Array.isArray(res.data) ? res.data.filter(c => !c.is_archived) : []))
        .catch(() => setCollections([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    // Start on "Uncategorized", and drop a pick that does not exist for the
    // new type. Preselecting the first category alphabetically filed every
    // expense the user forgot to categorize under "Education"; an
    // uncategorized one lands in the Review inbox instead, where it gets noticed.
    const filtered = selectableCategories(categories, type);
    setCategoryId(current => (filtered.some(c => String(c.id) === current) ? current : ''));
  }, [type, categories]);

  const handleAddCat = async () => {
    if (!newCatName.trim()) return;
    setAddingCat(true);
    try {
      const res = await createCategory({ name: newCatName.trim(), type, color: newCatColor });
      setCategories(p => [...p, res.data]);
      setCategoryId(String(res.data.id));
      setNewCatName(''); setShowNewCat(false);
    } catch {
      toast.error('Could not add that category');
    } finally { setAddingCat(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    const size = Math.round(Math.abs(parseFloat(amount)) * 100) / 100;
    const finalAmount = type === 'expense' ? -size : size;
    const payload = {
      account_id: parseInt(accountId),
      category_id: categoryId ? parseInt(categoryId) : null,
      amount: finalAmount,
      description: description.trim() || null,
      transaction_date: date,
      ...(collectionIds.length > 0 ? { collection_ids: collectionIds } : {}),
    };

    // Optimistic snapshot rendered in the transaction list until the server
    // confirms. Uses a negative id so it never collides with server ids;
    // pages can filter it out by `id < 0` and add a "syncing" indicator.
    const snapshot = {
      id: -Date.now(),
      user_id: 0,
      ...payload,
      created_at: new Date().toISOString(),
      _pending: true as const,
    };

    try {
      await enqueue({
        kind: 'transaction.create',
        method: 'POST',
        path: '/transactions',
        payload,
        snapshot,
        onSuccess: () => {
          // Server confirmed — pull fresh data so the pending row is replaced
          // by the real one (with the true id, category defaults, etc).
          onSuccess();
        },
        onError: (message) => {
          toast.error(`Save failed: ${message}`);
        },
      });
      // Close immediately; the pending row shows in the list via the queue.
      toast.success(navigator.onLine ? 'Saved' : 'Queued — will sync when back online');
      onClose();
      setAmount(''); setDescription(''); setDate(localDateStr());
    } catch {
      toast.error('Could not queue transaction');
    }
    finally { setLoading(false); }
  };

  const filteredCats = selectableCategories(categories, type);
  const noun = type === 'expense' ? 'expense' : 'income';
  const valid = !!amount && parseFloat(amount) > 0 && !!accountId && !!date;

  const footer = accounts.length > 0 ? (
    <button type="submit" form={formId} disabled={loading || !valid} className="btn-gradient pressable flex-1">
      {loading ? 'Saving…' : `Save ${noun}${valid ? ` · ${dollars(parseFloat(amount))}` : ''}`}
    </button>
  ) : undefined;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={type === 'expense' ? 'Add expense' : 'Add income'} footer={footer}>
      <div className="px-5 pb-6">
        {accounts.length === 0 ? (
          <p className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>Add an account first before recording transactions.</p>
        ) : (
          <form id={formId} onSubmit={handleSubmit} className="space-y-5">
            <DirectionToggle value={type} onChange={setType} />

            <AmountInput id="transaction-amount" value={amount} onChange={setAmount} />

            <div>
              <label className="form-label" htmlFor="transaction-note">Description</label>
              <input id="transaction-note" type="text" value={description} onChange={e => setDescription(e.target.value)}
                className="input-dark" placeholder="What was this for?" autoComplete="off" />
            </div>

            {showNewCat ? (
              <div>
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="form-label mb-0">New category</span>
                  <button type="button" onClick={() => setShowNewCat(false)}
                    className="min-h-[36px] px-2 text-sm font-medium" style={{ color: 'var(--accent)' }}>
                    Cancel
                  </button>
                </div>
                <div className="p-3 rounded-md space-y-3" style={{ border: '1px solid var(--line)' }}>
                  <label className="sr-only" htmlFor="new-category-name">Category name</label>
                  <input id="new-category-name" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddCat(); } }}
                    placeholder="Name, e.g. Dining" className="input-dark text-sm" autoFocus />
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Colour">
                    {SWATCHES.map(c => (
                      <button key={c} type="button" onClick={() => setNewCatColor(c)}
                        className="color-swatch"
                        style={{ backgroundColor: c }}
                        aria-label={`Use ${c} for this category`}
                        aria-pressed={newCatColor === c} />
                    ))}
                  </div>
                  <button type="button" onClick={handleAddCat} disabled={addingCat || !newCatName.trim()}
                    className="btn-gradient pressable w-full">
                    {addingCat ? 'Adding…' : 'Add category'}
                  </button>
                </div>
              </div>
            ) : (
              <CategoryChips
                categories={filteredCats}
                value={categoryId}
                onChange={setCategoryId}
                action={(
                  <button type="button" onClick={() => setShowNewCat(true)}
                    className="min-h-[36px] px-2 text-sm font-medium" style={{ color: 'var(--accent)' }}>
                    + New
                  </button>
                )}
              />
            )}

            <div>
              <label className="form-label" htmlFor="transaction-account">Account</label>
              <select id="transaction-account" value={accountId} onChange={e => setAccountId(e.target.value)} className="input-dark">
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label" htmlFor="transaction-date">Date</label>
              <input id="transaction-date" type="date" value={date} onChange={e => setDate(e.target.value)} className="input-dark" required />
            </div>

            {collections.length > 0 && (
              <CollectionPicker
                collections={collections}
                selected={collectionIds}
                onToggle={id => setCollectionIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))}
                label="Collections (optional)"
              />
            )}
          </form>
        )}
      </div>
    </BottomSheet>
  );
};

export default AddTransactionModal;
