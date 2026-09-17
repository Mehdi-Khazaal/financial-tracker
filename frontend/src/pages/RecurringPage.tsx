import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import PullToRefresh from '../components/PullToRefresh';
import LoadErrorBanner from '../components/LoadErrorBanner';
import { Skeleton } from '../components/Skeleton';
import AddRecurringModal from '../components/modals/AddRecurringModal';
import { useRouteTab, TabContext } from '../context/TabContext';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import type { RecurringBill, RecurringGroupKey, RecurringOverview, RecurringSuggestion } from '../types';
import {
  confirmRecurringSuggestion, deleteRecurring, dismissRecurringSuggestion, getRecurringOverview,
  logVariableRecurring, processDueRecurring, updateRecurring,
} from '../utils/api';
import RecurringHero from '../features/recurring/components/RecurringHero';
import SuggestionList from '../features/recurring/components/SuggestionList';
import BillGroupCard, { BillRow, type BillActions } from '../features/recurring/components/BillGroupCard';
import { EditBillSheet, GroupPickerSheet, LogAmountSheet, type BillEdits } from '../features/recurring/components/RecurringSheets';
import { needsAttention } from '../features/recurring/calculations';

const TRANSACTION_TABS = [
  { id: 'list', label: 'Timeline' },
  { id: 'transactions', label: 'Review' },
  { id: 'recurring', label: 'Recurring' },
] as const;

type GroupTarget =
  | { kind: 'bill'; bill: RecurringBill }
  | { kind: 'suggestion'; suggestion: RecurringSuggestion };

/**
 * Recurring bills and subscriptions, organised.
 *
 * Reads one server-built overview: this month's expected total, bills grouped
 * by what they are, and repeating charges found in history that are not yet
 * tracked. Bills on bank-linked accounts are marked paid from imported charges,
 * so the page only asks the user to act where the app genuinely cannot know —
 * a variable bill on a manual account.
 */
const RecurringPage: React.FC = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const { setRouteTab } = React.useContext(TabContext);
  const [routeTab, setOwnTab] = useRouteTab('/recurring');

  const [overview, setOverview] = useState<RecurringOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyIdentity, setBusyIdentity] = useState<string | null>(null);
  const [chosenGroups, setChosenGroups] = useState<Record<string, RecurringGroupKey>>({});
  const [groupTarget, setGroupTarget] = useState<GroupTarget | null>(null);
  const [editing, setEditing] = useState<RecurringBill | null>(null);
  const [logging, setLogging] = useState<RecurringBill | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await getRecurringOverview();
      setOverview(res.data as RecurringOverview);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  // The phone's context tab bar treats this page as the third Transactions
  // view. Picking another view goes back to Transactions on that tab.
  useEffect(() => {
    if (!routeTab || routeTab === 'recurring') return;
    setRouteTab('/transactions', routeTab);
    setOwnTab('recurring');
    navigate('/transactions');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeTab]);

  const goToTransactionsTab = (id: string) => {
    if (id === 'recurring') return;
    setRouteTab('/transactions', id);
    navigate('/transactions');
  };

  const groupLabels = useMemo(
    () => Object.fromEntries((overview?.group_options ?? []).map(o => [o.key, o.label])),
    [overview],
  );
  const attention = useMemo(() => (overview ? needsAttention(overview) : []), [overview]);
  const dueManualFixed = attention.filter(b => b.status === 'overdue' && !b.is_variable && !b.linked);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const run = async (work: () => Promise<unknown>, success: string, failure: string) => {
    try {
      await work();
      toast.success(success);
      await load();
    } catch {
      toast.error(failure);
    }
  };

  const track = async (suggestion: RecurringSuggestion) => {
    setBusyIdentity(suggestion.identity);
    const group = chosenGroups[suggestion.identity];
    await run(
      () => confirmRecurringSuggestion(suggestion.identity, group ? { group_key: group } : {}),
      `Tracking ${suggestion.name}`,
      'Could not track this charge — it may have changed. Refresh and try again.',
    );
    setBusyIdentity(null);
  };

  const dismiss = async (suggestion: RecurringSuggestion) => {
    setBusyIdentity(suggestion.identity);
    await run(
      () => dismissRecurringSuggestion(suggestion.identity),
      `${suggestion.name} won't be suggested again`,
      'Could not hide this suggestion',
    );
    setBusyIdentity(null);
  };

  const pickGroup = async (key: RecurringGroupKey) => {
    const target = groupTarget;
    setGroupTarget(null);
    if (!target) return;
    if (target.kind === 'suggestion') {
      setChosenGroups(prev => ({ ...prev, [target.suggestion.identity]: key }));
      return;
    }
    if (target.bill.group_key === key) return;
    await run(
      () => updateRecurring(target.bill.id, { group_key: key }),
      `Moved to ${groupLabels[key] ?? 'group'}`,
      'Could not move this bill',
    );
  };

  const actions: BillActions = {
    onEdit: bill => setEditing(bill),
    onMove: bill => setGroupTarget({ kind: 'bill', bill }),
    onLog: bill => setLogging(bill),
    onTogglePause: bill => void run(
      () => updateRecurring(bill.id, { is_active: !bill.is_active }),
      bill.is_active ? 'Paused' : 'Resumed',
      'Could not update this bill',
    ),
    onDelete: async bill => {
      const ok = await toast.confirm(`Stop tracking ${bill.description ?? 'this bill'}? Past transactions are kept.`, { danger: true });
      if (!ok) return;
      await run(() => deleteRecurring(bill.id), 'Deleted', 'Could not delete this bill');
    },
  };

  const saveEdits = async (bill: RecurringBill, edits: BillEdits) => {
    await run(() => updateRecurring(bill.id, edits), 'Saved', 'Could not save changes');
    setEditing(null);
  };

  const logAmount = async (bill: RecurringBill, amount: number) => {
    await run(() => logVariableRecurring(bill.id, amount), 'Logged', 'Could not log this bill');
    setLogging(null);
  };

  const logDueFixed = async () => {
    setProcessing(true);
    await run(() => processDueRecurring(), 'Due bills logged', 'Could not log due bills');
    setProcessing(false);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const header = (
    <div className="product-page-header topbar-safe">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="product-page-title">Recurring</h1>
        <div className="hidden md:flex p-1 rounded-xl" style={{ backgroundColor: 'var(--elev-1)' }} role="tablist" aria-label="Transaction views">
          {TRANSACTION_TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === 'recurring'}
              onClick={() => goToTransactionsTab(t.id)}
              className="px-3 py-1.5 text-sm font-semibold rounded-lg transition-all"
              style={t.id === 'recurring'
                ? { backgroundColor: 'var(--bg)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                : { color: 'var(--muted)' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="product-header-actions">
        <button type="button" className="header-action header-action--primary" onClick={() => setShowAdd(true)}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden="true">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Add
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <AppShell>
        <PageLayout>
          <div className="max-w-3xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-4" aria-busy="true">
            {header}
            <Skeleton h={220} rounded="rounded-xl" className="w-full" />
            <Skeleton h={140} rounded="rounded-xl" className="w-full" />
            <Skeleton h={180} rounded="rounded-xl" className="w-full" />
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  const hasBills = !!overview && (overview.groups.length > 0 || overview.income.length > 0 || overview.paused.length > 0);

  return (
    <AppShell>
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <PageLayout>
        <div className="max-w-3xl mx-auto px-4 md:px-6 pt-6 md:pt-8 pb-10 space-y-5 fade-in">
          {header}

          {loadError && <LoadErrorBanner onRetry={() => void load()} />}

          {overview && (
            <>
              {hasBills && <RecurringHero overview={overview} />}

              {attention.length > 0 && (
                <section className="card overflow-hidden" aria-labelledby="recurring-attention-heading">
                  <header className="flex items-center justify-between gap-3 px-4 py-3.5">
                    <div>
                      <h2 id="recurring-attention-heading" className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Needs attention</h2>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Due within a week, or not seen when expected</p>
                    </div>
                    {dueManualFixed.length > 0 && (
                      <button type="button" onClick={() => void logDueFixed()} disabled={processing}
                        className="header-action header-action--primary text-xs disabled:opacity-50">
                        {processing ? 'Logging…' : `Log ${dueManualFixed.length} due`}
                      </button>
                    )}
                  </header>
                  <ul>
                    {attention.map(bill => <BillRow key={`attention-${bill.id}`} bill={bill} actions={actions} />)}
                  </ul>
                </section>
              )}

              <SuggestionList
                suggestions={overview.suggestions}
                chosenGroups={chosenGroups}
                groupLabels={groupLabels}
                busyIdentity={busyIdentity}
                onTrack={s => void track(s)}
                onDismiss={s => void dismiss(s)}
                onChangeGroup={s => setGroupTarget({ kind: 'suggestion', suggestion: s })}
              />

              {!hasBills && overview.suggestions.length === 0 && (
                <div className="card py-14 px-6 text-center">
                  <p className="font-semibold mb-1" style={{ color: 'var(--fg)' }}>No recurring bills yet</p>
                  <p className="text-sm max-w-sm mx-auto leading-relaxed mb-5" style={{ color: 'var(--muted)' }}>
                    Once a bill or subscription has charged a couple of times, it shows up here to track in one tap.
                    You can also add rent, salary or anything else by hand.
                  </p>
                  <button type="button" onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">Add a recurring charge</button>
                </div>
              )}

              {overview.groups.map(group => (
                <BillGroupCard
                  key={group.key}
                  groupKey={group.key}
                  label={group.label}
                  monthlyTotal={group.monthly_total}
                  paid={group.paid_this_month}
                  remaining={group.remaining_this_month}
                  bills={group.bills}
                  actions={actions}
                />
              ))}

              {overview.income.length > 0 && (
                <BillGroupCard
                  groupKey="income"
                  label="Income"
                  monthlyTotal={overview.income_typical_monthly}
                  paid="0"
                  remaining="0"
                  bills={overview.income}
                  actions={actions}
                />
              )}

              {overview.paused.length > 0 && (
                <section className="card overflow-hidden">
                  <button type="button" onClick={() => setShowPaused(v => !v)} aria-expanded={showPaused}
                    className="w-full flex items-center justify-between px-4 py-3.5 text-left pressable" style={{ minHeight: 48 }}>
                    <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>Paused · {overview.paused.length}</span>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden="true"
                      style={{ color: 'var(--dim)', transform: showPaused ? 'rotate(180deg)' : 'none', transition: 'transform 180ms var(--ease-out)' }}>
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {showPaused && (
                    <ul>{overview.paused.map(bill => <BillRow key={bill.id} bill={bill} actions={actions} />)}</ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </PageLayout>

      <GroupPickerSheet
        isOpen={!!groupTarget}
        title={groupTarget?.kind === 'bill' ? 'Move to group' : 'File under'}
        options={overview?.group_options ?? []}
        current={groupTarget
          ? groupTarget.kind === 'bill'
            ? groupTarget.bill.group_key
            : chosenGroups[groupTarget.suggestion.identity] ?? groupTarget.suggestion.group_key
          : null}
        onPick={key => void pickGroup(key)}
        onClose={() => setGroupTarget(null)}
      />
      <EditBillSheet bill={editing} onSave={saveEdits} onClose={() => setEditing(null)} />
      <LogAmountSheet bill={logging} onLog={logAmount} onClose={() => setLogging(null)} />
      <AddRecurringModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={() => void load()} />
    </AppShell>
  );
};

export default RecurringPage;
