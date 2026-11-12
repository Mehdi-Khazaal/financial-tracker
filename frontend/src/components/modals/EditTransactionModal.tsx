import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BottomSheet from '../BottomSheet';
import AmountInput from '../AmountInput';
import { linkToNewRule } from '../../lib/deepLinks';
import {
  updateTransaction, deleteTransaction, getTransaction, getAccounts, getCategories, cleanDescription,
  getCollections, createCollection, setTransactionCollections,
} from '../../utils/api';
import { Transaction, Account, Category, Collection } from '../../types';
import { buildClassificationContext, classifyTransaction } from '../../features/analytics/calculations/transactions';
import CollectionPicker from '../../features/collections/components/CollectionPicker';
import { pickableCollections } from '../../features/collections/calculations/collections';
import { errorText } from '../../features/collections/errors';
import { useToast } from '../../context/ToastContext';
import { selectableCategories } from './categoryOptions';
import { accountOptionLabel } from './accountOptions';
import SplitEditor from '../../features/transactions/components/SplitEditor';
import OneOffToggle from '../../features/transactions/components/OneOffToggle';
import { CategoryChips, DirectionToggle } from '../../features/transactions/components/TransactionFormFields';
import { dollars } from '../../features/analytics/format';

/**
 * One transaction: its details, and the two ways to change it (edit, split).
 *
 * A side panel on desktop, so the list it came from stays in view; a bottom
 * sheet on a phone. The three steps live in one sheet and slide the way you
 * go — forward into edit or split, back to the details — with the panel
 * easing to each step's height. Actions sit in a pinned footer, so Save never
 * scrolls out of reach behind a long category list.
 *
 * Saving sends only what changed. It used to send every field, which wrote
 * the placeholder "No note" into transactions that had no description and
 * re-marked an untouched category as chosen by hand.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  transaction: Transaction | null;
  /** Loaded transactions, to judge whether a charge repeats (one-offs). */
  history?: Transaction[];
}

type Step = 'view' | 'edit' | 'split';
type Field = 'category' | 'account' | 'date';

interface Draft {
  type: 'income' | 'expense';
  amount: string;
  accountId: string;
  categoryId: string;
  description: string;
  date: string;
}

/** The description as the user typed it: no bank prefix, and empty rather than a placeholder. */
const editableDescription = (raw: string | null | undefined): string => (raw ? cleanDescription(raw) : '');

const draftFrom = (tx: Transaction): Draft => ({
  type: Number(tx.amount) > 0 ? 'income' : 'expense',
  amount: String(Math.abs(Number(tx.amount))),
  accountId: String(tx.account_id),
  categoryId: tx.category_id ? String(tx.category_id) : '',
  description: editableDescription(tx.description),
  date: tx.transaction_date,
});

const toCents = (value: number) => Math.round(value * 100);

/** The fields that differ from the saved transaction, in the shape the API takes. */
function changesFrom(tx: Transaction, draft: Draft): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const size = Math.abs(parseFloat(draft.amount));
  if (Number.isFinite(size)) {
    const signed = (draft.type === 'expense' ? -size : size);
    if (toCents(signed) !== toCents(Number(tx.amount))) changes.amount = toCents(signed) / 100;
  }
  if (draft.accountId !== String(tx.account_id)) changes.account_id = Number(draft.accountId);
  if (draft.categoryId !== (tx.category_id ? String(tx.category_id) : '')) {
    changes.category_id = draft.categoryId ? Number(draft.categoryId) : null;
  }
  const description = draft.description.trim();
  if (description !== editableDescription(tx.description)) changes.description = description || null;
  if (draft.date !== tx.transaction_date) changes.transaction_date = draft.date;
  return changes;
}

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

const Chevron = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0" style={{ color: 'var(--dim)' }} aria-hidden="true">
    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
  </svg>
);

/** Label on the left, value on the right; a button when it leads somewhere. */
const DetailRow: React.FC<{ label: string; children: React.ReactNode; onClick?: () => void; actionLabel?: string }> = ({
  label, children, onClick, actionLabel,
}) => {
  const content = (
    <>
      <span className="text-sm shrink-0" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="flex items-center gap-2 min-w-0 text-sm font-medium text-right" style={{ color: 'var(--fg)' }}>
        {children}
        {onClick && <Chevron />}
      </span>
    </>
  );
  return onClick
    ? <button type="button" className="detail-row" onClick={onClick} aria-label={actionLabel}>{content}</button>
    : <div className="detail-row">{content}</div>;
};

const EditTransactionModal: React.FC<Props> = ({ isOpen, onClose, onSuccess, transaction, history = [] }) => {
  const toast = useToast();
  const navigate = useNavigate();
  const formId = useId();

  const [step, setStep] = useState<Step>('view');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  // The transaction as last saved here. The parent's copy goes stale after an
  // edit, and becomes null while the sheet plays its exit.
  const [current, setCurrent] = useState<Transaction | null>(transaction);
  const [draft, setDraft] = useState<Draft | null>(transaction ? draftFrom(transaction) : null);
  const [focusField, setFocusField] = useState<Field | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberOf, setMemberOf] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingCollections, setSavingCollections] = useState(false);
  const stepRef = useRef<HTMLDivElement>(null);
  // The step focus was last moved for. Opening resets it to 'view' along with
  // the step, so opening never counts as a move (the sheet focuses itself).
  const focusedStep = useRef<Step>('view');

  // A new transaction opened: start on its details with fresh lookups.
  useEffect(() => {
    if (!isOpen || !transaction) return;
    focusedStep.current = 'view';
    setCurrent(transaction);
    setDraft(draftFrom(transaction));
    setStep('view');
    setDirection('forward');
    setMemberOf(transaction.collection_ids ?? []);
    getCollections()
      .then(res => setCollections(Array.isArray(res.data) ? res.data : []))
      .catch(() => setCollections([]));
    Promise.all([getAccounts(), getCategories()])
      .then(([aRes, cRes]) => { setAccounts(aRes.data); setCategories(cRes.data); })
      .catch(() => toast.error('Could not load your accounts and categories'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, transaction]);

  // Moving between steps: keep keyboard focus inside the sheet (the button
  // that was pressed has gone), or on the field a detail row pointed at.
  useEffect(() => {
    if (focusedStep.current === step) return undefined;
    focusedStep.current = step;
    const frame = requestAnimationFrame(() => {
      const target = focusField === 'category'
        ? document.querySelector<HTMLElement>('#tx-edit-category [aria-pressed="true"]')
        : focusField ? document.getElementById(`tx-edit-${focusField}`) : null;
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: 'nearest' });
      } else {
        stepRef.current?.focus({ preventScroll: true });
      }
      setFocusField(null);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const tx = current ?? transaction;
  const changes = tx && draft ? changesFrom(tx, draft) : {};
  const dirty = step === 'edit' && Object.keys(changes).length > 0;
  const amountValid = !!draft && parseFloat(draft.amount) > 0;
  const canSave = dirty && amountValid && !!draft?.date && !!draft?.accountId && !saving;

  const go = (next: Step, dir: 'forward' | 'back') => {
    setDirection(dir);
    setStep(next);
  };

  const discardOk = async () => !dirty || toast.confirm('Your changes to this transaction have not been saved.', {
    title: 'Discard changes?', danger: true, confirmLabel: 'Discard',
  });

  const handleClose = async () => {
    if (await discardOk()) onClose();
  };

  const handleBack = async () => {
    if (!(await discardOk())) return;
    if (tx) setDraft(draftFrom(tx));
    go('view', 'back');
  };

  const openEdit = (field?: Field) => {
    if (!tx) return;
    setDraft(draftFrom(tx));
    setFocusField(field ?? null);
    go('edit', 'forward');
  };

  const patch = (next: Partial<Draft>) => setDraft(d => (d ? { ...d, ...next } : d));

  const changeType = (type: Draft['type']) => {
    setDraft(d => {
      if (!d) return d;
      // Drop a category that does not exist for the other direction.
      const stillValid = selectableCategories(categories, type).some(c => String(c.id) === d.categoryId);
      return { ...d, type, categoryId: stillValid ? d.categoryId : '' };
    });
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tx || !canSave) return;
    setSaving(true);
    try {
      const res = await updateTransaction(tx.id, changes);
      setCurrent(res.data && typeof res.data === 'object' ? { ...tx, ...res.data } : tx);
      onSuccess();
      toast.success('Changes saved');
      go('view', 'back');
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Could not save your changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tx) return;
    const ok = await toast.confirm('It is removed from your history and the account balance is adjusted to match.', {
      title: 'Delete this transaction?', danger: true, confirmLabel: 'Delete',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteTransaction(tx.id);
      onSuccess();
      onClose();
      toast.success('Transaction deleted');
    } catch {
      toast.error('Could not delete the transaction');
    } finally {
      setDeleting(false);
    }
  };

  const splitDone = async () => {
    onSuccess();
    if (tx) {
      try {
        const res = await getTransaction(tx.id);
        setCurrent(res.data);
      } catch { /* the details stay as they were; the list has reloaded */ }
    }
    go('view', 'back');
  };

  // Membership saves straight away: it changes no money, so there is nothing to confirm.
  const saveCollections = async (next: number[]) => {
    if (!tx) return false;
    const previous = memberOf;
    setMemberOf(next);
    setSavingCollections(true);
    try {
      await setTransactionCollections(tx.id, next);
      onSuccess();
      return true;
    } catch (err) {
      setMemberOf(previous);
      toast.error(errorText(err, 'Could not update collections'));
      return false;
    } finally {
      setSavingCollections(false);
    }
  };

  const toggleCollection = (id: number) => {
    void saveCollections(memberOf.includes(id) ? memberOf.filter(x => x !== id) : [...memberOf, id]);
  };

  const createAndAdd = async (name: string): Promise<boolean> => {
    try {
      const res = await createCollection({ name });
      setCollections(prev => [...prev, res.data]);
      return await saveCollections([...memberOf, res.data.id]);
    } catch (err) {
      toast.error(errorText(err, 'Could not create the collection'));
      return false;
    }
  };

  const title = step === 'edit' ? 'Edit transaction' : step === 'split' ? 'Split transaction' : 'Transaction';
  const stepClass = direction === 'back' ? 'sheet-step-back' : 'sheet-step-forward';
  const splits = tx?.splits ?? [];
  const hasSplit = splits.length > 0;

  // ── Footer ──────────────────────────────────────────────────────────────────
  let footer: React.ReactNode = null;
  if (tx && step === 'view') {
    footer = (
      <>
        <button type="button" onClick={handleDelete} disabled={deleting} className="btn-text-danger pressable">
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => go('split', 'forward')} className="btn-ghost pressable">
          {hasSplit ? 'Edit split' : 'Split'}
        </button>
        <button type="button" onClick={() => openEdit()} className="btn-gradient pressable">
          Edit
        </button>
      </>
    );
  } else if (tx && step === 'edit') {
    footer = (
      <>
        <button type="button" onClick={handleBack} className="btn-ghost pressable flex-1">Cancel</button>
        <button type="submit" form={formId} disabled={!canSave} className="btn-gradient pressable flex-1">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </>
    );
  }

  // ── Body ────────────────────────────────────────────────────────────────────
  let body: React.ReactNode = null;
  if (tx && step === 'view') {
    const amount = Number(tx.amount);
    const income = amount > 0;
    const accName = accounts.find(a => a.id === tx.account_id)?.name;
    const cat = categories.find(c => c.id === tx.category_id);
    const description = editableDescription(tx.description);
    const ctx = accounts.length > 0 ? buildClassificationContext(accounts, categories) : null;
    const typeLabel = cat?.type === 'investment' ? 'Investment'
      : cat?.type === 'transfer' ? 'Transfer'
        : income ? 'Income' : 'Expense';

    body = (
      <>
        <div className="pb-5">
          <p className="text-[2rem] leading-none font-semibold tracking-tight tabular-nums"
            style={{ color: income ? 'var(--pos)' : 'var(--fg)' }}>
            {income ? '+' : amount < 0 ? '-' : ''}{dollars(Math.abs(amount))}
          </p>
          <p className="mt-2.5 text-base font-medium break-words" style={{ color: description ? 'var(--fg)' : 'var(--dim)' }}>
            {description || 'No description'}
          </p>
        </div>

        <div>
          <DetailRow
            label="Category"
            onClick={() => (hasSplit ? go('split', 'forward') : openEdit('category'))}
            actionLabel={hasSplit ? `Category: split across ${splits.length} categories. Edit split` : `Category: ${cat?.name ?? 'Uncategorized'}. Change`}
          >
            {hasSplit
              ? <span>Split · {splits.length} categories</span>
              : (
                <>
                  {cat && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} aria-hidden="true" />}
                  <span className="truncate" style={{ color: cat ? 'var(--fg)' : 'var(--dim)' }}>{cat?.name ?? 'Uncategorized'}</span>
                </>
              )}
          </DetailRow>
          <DetailRow label="Account" onClick={() => openEdit('account')} actionLabel={`Account: ${accName ?? 'unknown'}. Change`}>
            <span className="truncate">{accName ?? '—'}</span>
          </DetailRow>
          <DetailRow label="Date" onClick={() => openEdit('date')} actionLabel={`Date: ${longDate(tx.transaction_date)}. Change`}>
            <span>{longDate(tx.transaction_date)}</span>
          </DetailRow>
          <DetailRow label="Counts as">
            <span style={{ color: typeLabel === 'Income' ? 'var(--pos)' : 'var(--fg)' }}>{typeLabel}</span>
          </DetailRow>
        </div>

        {hasSplit && (
          <section className="mt-5" aria-label="Split parts">
            <p className="form-label">Split</p>
            <ul>
              {splits.map(split => {
                const splitCat = categories.find(c => c.id === split.category_id);
                return (
                  <li key={split.id} className="detail-row">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: splitCat?.color ?? 'var(--dim)' }} aria-hidden="true" />
                      <span className="text-sm truncate" style={{ color: 'var(--fg)' }}>{splitCat?.name ?? 'Uncategorized'}</span>
                      {split.note && <span className="text-xs truncate" style={{ color: 'var(--dim)' }}>{split.note}</span>}
                    </span>
                    <span className="text-sm tabular-nums shrink-0" style={{ color: 'var(--muted)' }}>{dollars(Math.abs(Number(split.amount)))}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Collections: a trip, a holiday… Card payments are not spending, so they can't join one. */}
        {ctx && classifyTransaction(tx, ctx) !== 'card-payment' && (
          <div className="mt-6">
            <CollectionPicker
              collections={pickableCollections(collections, memberOf)}
              selected={memberOf}
              onToggle={toggleCollection}
              onCreate={createAndAdd}
              disabled={savingCollections}
            />
          </div>
        )}

        {ctx && (
          <OneOffToggle transaction={tx} history={history} ctx={ctx} onSaved={onSuccess} />
        )}

        {/* A rule from this transaction: the most common reason to want one
            is a row that just arrived uncategorised or misfiled. */}
        {description && (
          <button
            type="button"
            onClick={() => { onClose(); navigate(linkToNewRule(description, tx.category_id)); }}
            className="w-full mt-2 flex items-center justify-between gap-3 text-sm font-medium pressable text-left"
            style={{ color: 'var(--accent)', minHeight: 44 }}
          >
            <span className="min-w-0 truncate">Always file “{description}” as…</span>
            <span aria-hidden="true">→</span>
          </button>
        )}
      </>
    );
  } else if (tx && draft && step === 'edit') {
    const options = selectableCategories(categories, draft.type);
    const currentCat = categories.find(c => String(c.id) === draft.categoryId);
    const chipCats = currentCat && !options.includes(currentCat) ? [...options, currentCat] : options;
    const splitAtRisk = hasSplit && ('amount' in changes || 'category_id' in changes);

    body = (
      <form id={formId} onSubmit={handleSave} className="space-y-5">
        {hasSplit && (
          <p className="text-sm rounded-md px-3 py-2.5" role={splitAtRisk ? 'status' : undefined}
            style={{ backgroundColor: 'var(--elev-sub)', color: splitAtRisk ? 'var(--fg)' : 'var(--muted)' }}>
            This transaction is split across {splits.length} categories. Changing the amount or category files it under one category again.
          </p>
        )}

        <DirectionToggle value={draft.type} onChange={changeType} />

        <AmountInput id="tx-edit-amount" value={draft.amount} onChange={amount => patch({ amount })} autoFocus={false} />

        <div>
          <label className="form-label" htmlFor="tx-edit-description">Description</label>
          <input
            id="tx-edit-description"
            type="text"
            value={draft.description}
            onChange={e => patch({ description: e.target.value })}
            className="input-dark"
            placeholder="e.g. Whole Foods"
            autoComplete="off"
          />
        </div>

        <CategoryChips
          id="tx-edit-category"
          categories={chipCats}
          value={draft.categoryId}
          onChange={categoryId => patch({ categoryId })}
        />

        <div>
          <label className="form-label" htmlFor="tx-edit-account">Account</label>
          <select id="tx-edit-account" value={draft.accountId} onChange={e => patch({ accountId: e.target.value })} className="input-dark">
            {accounts.map(a => <option key={a.id} value={a.id}>{accountOptionLabel(a)}</option>)}
          </select>
        </div>

        <div>
          <label className="form-label" htmlFor="tx-edit-date">Date</label>
          <input id="tx-edit-date" type="date" value={draft.date} onChange={e => patch({ date: e.target.value })} className="input-dark" required />
        </div>
      </form>
    );
  } else if (tx && step === 'split') {
    body = (
      <SplitEditor
        transaction={tx}
        categories={categories}
        onDone={() => { void splitDone(); }}
        onCancel={() => go('view', 'back')}
      />
    );
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => { void handleClose(); }}
      title={title}
      placement="side"
      onBack={step === 'view' ? undefined : () => { void handleBack(); }}
      backLabel="Back to details"
      footer={footer}
      stepKey={step}
    >
      <div key={step} ref={stepRef} tabIndex={-1} className={`px-5 pb-6 ${stepClass}`} style={{ outline: 'none' }}>
        {body}
      </div>
    </BottomSheet>
  );
};

export default EditTransactionModal;
