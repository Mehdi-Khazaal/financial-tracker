import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Account, Category, Collection, Transaction } from '../types';
import {
  cleanDescription, getAccounts, getCategories, getCollection, getCollectionTransactions,
} from '../utils/api';
import { localDateStr } from '../utils/date';
import { downloadCSV, printPDF } from '../utils/export';
import { linkToCollectTransactions, linkToCollections } from '../lib/deepLinks';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import LoadErrorBanner from '../components/LoadErrorBanner';
import ProgressBar from '../components/ProgressBar';
import TransactionCard from '../components/transactions/TransactionCard';
import EditTransactionModal from '../components/modals/EditTransactionModal';
import DayHeader from '../features/transactions/components/DayHeader';
import { groupByDay } from '../features/transactions/calculations/timeline';
import { buildClassificationContext, classifyTransaction } from '../features/analytics/calculations/transactions';
import { dayLabel, dollars, percent, plural } from '../features/analytics/format';
import { daysBetween } from '../features/analytics/period';
import {
  budgetProgress, categoryBreakdown, collectionColor, collectionTotals, dailySpending,
  dateRangeLabel, netDisplay, statusLabel, topMerchants,
} from '../features/collections/calculations/collections';
import CollectionBadge from '../features/collections/components/CollectionBadge';
import CollectionFormSheet from '../features/collections/components/CollectionFormSheet';
import SuggestionsSheet from '../features/collections/components/SuggestionsSheet';
import { useToast } from '../context/ToastContext';

/**
 * One collection: what the trip (or holiday, or move) cost, where the money
 * went, and every transaction in it.
 *
 * All figures are computed here from the collection's own transactions with
 * the Analytics classifier, so they agree with the rest of the app: refunds
 * and money paid back come off the cost, card payments never count.
 */
const CollectionPage: React.FC = () => {
  const { id } = useParams();
  const collectionId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [showExport, setShowExport] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const todayKey = localDateStr();

  const load = useCallback(async () => {
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setFailed(false);
    try {
      const [cRes, tRes, aRes, catRes] = await Promise.all([
        getCollection(collectionId), getCollectionTransactions(collectionId), getAccounts(), getCategories(),
      ]);
      setCollection(cRes.data);
      setTransactions(Array.isArray(tRes.data) ? tRes.data : []);
      setAccounts(Array.isArray(aRes.data) ? aRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) setNotFound(true);
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [collectionId]);

  useEffect(() => { void load(); }, [load]);

  // Arriving with ?review=1 (just created, or from the Dashboard) opens the suggestions.
  useEffect(() => {
    if (!collection || searchParams.get('review') !== '1') return;
    if (collection.start_date) setReviewing(true);
    const next = new URLSearchParams(searchParams);
    next.delete('review');
    setSearchParams(next, { replace: true });
  }, [collection, searchParams, setSearchParams]);

  useEffect(() => {
    if (!showExport) return;
    const close = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) setShowExport(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showExport]);

  const ctx = useMemo(() => buildClassificationContext(accounts, categories), [accounts, categories]);
  const totals = useMemo(() => collectionTotals(transactions, ctx), [transactions, ctx]);
  const slices = useMemo(() => categoryBreakdown(transactions, categories, ctx), [transactions, categories, ctx]);
  const days = useMemo(() => dailySpending(transactions, ctx), [transactions, ctx]);
  const merchants = useMemo(() => topMerchants(transactions, ctx), [transactions, ctx]);
  const timeline = useMemo(() => groupByDay(transactions, ctx, new Date()), [transactions, ctx]);

  if (loading) {
    return (
      <AppShell>
        <PageLayout>
          <div className="max-w-4xl mx-auto px-4 md:px-8 pt-6 space-y-3" aria-busy="true" aria-label="Loading collection">
            <div className="h-16 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--elev-1)' }} />
            <div className="h-40 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--elev-1)' }} />
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  if (notFound || (!collection && !failed)) {
    return (
      <AppShell>
        <PageLayout>
          <div className="max-w-xl mx-auto px-4 pt-16 text-center">
            <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>This collection doesn't exist</p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>It may have been deleted. Its transactions are still in your Timeline.</p>
            <Link to={linkToCollections()} className="inline-block mt-4 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              ← All collections
            </Link>
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  if (!collection) {
    return (
      <AppShell>
        <PageLayout>
          <div className="max-w-xl mx-auto px-4 pt-10">
            <LoadErrorBanner message="This collection could not be loaded." onRetry={() => void load()} />
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  const color = collectionColor(collection);
  const range = dateRangeLabel(collection, todayKey);
  const status = statusLabel(collection, todayKey);
  const budget = budgetProgress(totals.net, collection.budget);
  const dayCount = collection.start_date
    ? daysBetween(collection.start_date, (collection.end_date && collection.end_date < todayKey ? collection.end_date : todayKey)) + 1
    : 0;
  const perDay = dayCount > 0 && collection.start_date && collection.start_date <= todayKey && totals.net > 0 ? totals.net / dayCount : null;
  const net = netDisplay(totals.net);
  const maxDay = days.reduce((max, d) => Math.max(max, d.amount), 0);
  const accountName = (accountId: number) => accounts.find(a => a.id === accountId)?.name ?? '';
  const categoryName = (categoryId: number | null) => categories.find(c => c.id === categoryId)?.name ?? null;

  const exportRows = () => [...transactions]
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    .map(tx => [
      tx.transaction_date,
      cleanDescription(tx.description),
      accountName(tx.account_id),
      categoryName(tx.category_id) ?? 'Uncategorized',
      Number(tx.amount).toFixed(2),
      classifyTransaction(tx, ctx),
    ]);
  const headers = ['Date', 'Description', 'Account', 'Category', 'Amount', 'Counted as'];
  const slug = collection.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection';

  const exportCsv = () => {
    downloadCSV(`${slug}-${todayKey}.csv`, headers, exportRows());
    setShowExport(false);
  };
  const exportPdf = () => {
    const summary: (string | number)[][] = [
      ['', '', '', 'Spent', dollars(totals.spent), ''],
      ['', '', '', 'Came back', dollars(totals.returned), ''],
      ['', '', '', net.label, net.text, ''],
    ];
    printPDF(`${collection.name}${range ? ` — ${range}` : ''}`, headers, [...exportRows(), ...summary]);
    setShowExport(false);
  };

  const afterChange = (updated?: Collection) => {
    if (updated) setCollection(updated);
    void load();
  };

  return (
    <AppShell>
      <PageLayout>
        <div className="max-w-4xl mx-auto px-4 md:px-8 pt-5 md:pt-8 pb-10 space-y-5">
          {/* ── Header ── */}
          <div className="product-page-header topbar-safe flex-wrap gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                to={linkToCollections()}
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 pressable"
                style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}
                aria-label="Back to collections"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </Link>
              <CollectionBadge collection={collection} size="lg" />
              <div className="min-w-0">
                <h1 className="product-page-title truncate" title={collection.name}>{collection.name}</h1>
                <p className="text-xs mt-0.5" style={{ color: collection.active ? color : 'var(--dim)' }}>
                  {[range, status].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div ref={exportRef} className="relative">
                <button type="button" onClick={() => setShowExport(v => !v)} className="header-action text-sm"
                  aria-haspopup="menu" aria-expanded={showExport} disabled={transactions.length === 0}>
                  Export
                </button>
                {showExport && (
                  <div className="menu-surface absolute top-full right-0 mt-1.5 min-w-[180px] py-1" role="menu">
                    <button type="button" role="menuitem" className="menu-item text-sm" style={{ color: 'var(--fg)' }} onClick={exportCsv}>
                      Spreadsheet (CSV)
                    </button>
                    <button type="button" role="menuitem" className="menu-item text-sm" style={{ color: 'var(--fg)' }} onClick={exportPdf}>
                      Print or save as PDF
                    </button>
                  </div>
                )}
              </div>
              <Link to={linkToCollectTransactions(collection.id)} className="header-action text-sm">Add</Link>
              <button type="button" onClick={() => setEditing(true)} className="header-action text-sm">Edit</button>
            </div>
          </div>

          {failed && <LoadErrorBanner message="Some of this collection could not be refreshed." onRetry={() => void load()} />}

          {collection.note && (
            <p className="text-sm leading-relaxed px-1" style={{ color: 'var(--muted)' }}>{collection.note}</p>
          )}

          {/* ── Suggestions waiting ── */}
          {collection.start_date && !collection.is_archived && (
            <div className="rounded-xl px-4 py-3 flex items-center justify-between gap-3"
              style={{
                backgroundColor: collection.suggestion_count > 0 ? 'oklch(72% 0.17 55 / 0.1)' : 'var(--elev-1)',
                border: `1px solid ${collection.suggestion_count > 0 ? 'oklch(72% 0.17 55 / 0.25)' : 'var(--line)'}`,
              }}>
              <p className="text-sm min-w-0" style={{ color: 'var(--fg)' }}>
                {collection.suggestion_count > 0
                  ? `${plural(collection.suggestion_count, 'transaction')} from these dates might belong here`
                  : 'Missing something from these dates?'}
              </p>
              <button type="button" onClick={() => setReviewing(true)} className="text-sm font-semibold shrink-0 pressable px-1"
                style={{ color: 'var(--accent)', minHeight: 40 }}>
                {collection.suggestion_count > 0 ? 'Review' : 'Find'}
              </button>
            </div>
          )}

          {/* ── What it cost ── */}
          <section className="ledger-panel p-5" aria-labelledby="collection-cost">
            <p id="collection-cost" className="label mb-1">{net.label}</p>
            <p className="font-mono tabular-nums text-3xl md:text-4xl font-bold" style={{ color: net.color ?? 'var(--fg)' }}>{net.text}</p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
              {dollars(totals.spent)} spent
              {totals.returned > 0 && <> · <span style={{ color: 'var(--pos)' }}>{dollars(totals.returned)} came back</span></>}
              {' · '}{plural(totals.count, 'transaction')}
              {perDay != null && totals.count > 0 && <> · {dollars(perDay)} a day</>}
            </p>
            {budget && (
              <div className="mt-4">
                <ProgressBar value={budget.percent} color={budget.over ? 'var(--neg)' : color} height={6} semantics="progress"
                  label={`${dollars(budget.used)} of ${dollars(budget.budget)} budget used`} />
                <p className="text-xs mt-1.5" style={{ color: budget.over ? 'var(--neg)' : 'var(--dim)' }}>
                  {budget.over
                    ? `${dollars(-budget.remaining)} over the ${dollars(budget.budget)} budget`
                    : `${dollars(budget.remaining)} left of the ${dollars(budget.budget)} budget`}
                </p>
              </div>
            )}
            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--dim)' }}>
              These transactions still count in their categories and in your monthly totals. Refunds and money paid back come off the cost.
            </p>
          </section>

          {transactions.length === 0 ? (
            <div className="rounded-xl py-10 px-6 text-center" style={{ backgroundColor: 'var(--elev-1)', border: '1px dashed var(--line)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Nothing in this collection yet</p>
              <p className="text-xs mt-1.5 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--muted)' }}>
                {collection.start_date
                  ? 'Use “Find” above to pick transactions from its dates, or pick them from the Timeline.'
                  : 'Pick transactions from the Timeline, or give this collection dates to get suggestions.'}
              </p>
              <Link to={linkToCollectTransactions(collection.id)} className="btn-gradient inline-flex items-center mt-4 px-5 min-h-[44px] text-sm">
                Pick from Timeline
              </Link>
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-5 items-start">
                {/* ── By category ── */}
                <section className="ledger-panel p-5" aria-labelledby="collection-categories">
                  <p id="collection-categories" className="label mb-3">By category</p>
                  {slices.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--dim)' }}>No spending to break down.</p>
                  ) : (
                    <ul className="space-y-3">
                      {slices.map(slice => (
                        <li key={String(slice.id)}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                              <span className="text-sm truncate" style={{ color: 'var(--fg)' }}>{slice.name}</span>
                            </span>
                            <span className="font-mono tabular-nums text-sm shrink-0" style={{ color: 'var(--fg)' }}>
                              {dollars(slice.amount)} <span style={{ color: 'var(--dim)' }}>{percent(slice.share, 0)}</span>
                            </span>
                          </div>
                          <ProgressBar value={slice.share * 100} color={slice.color} height={4} semantics="progress" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <div className="space-y-5">
                  {/* ── By day ── */}
                  {days.length > 1 && (
                    <section className="ledger-panel p-5" aria-labelledby="collection-days">
                      <p id="collection-days" className="label mb-3">By day</p>
                      <div className="flex items-end gap-1 h-28" role="list">
                        {days.map(day => (
                          <div key={day.date} role="listitem" className="flex-1 min-w-0 flex flex-col items-center justify-end h-full"
                            aria-label={`${dayLabel(day.date)}: ${dollars(day.amount)}`} title={`${dayLabel(day.date)}: ${dollars(day.amount)}`}>
                            <div className="w-full rounded-t" style={{ height: `${maxDay > 0 ? Math.max(4, (day.amount / maxDay) * 100) : 4}%`, backgroundColor: color, opacity: 0.85 }} />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between mt-1.5 text-[10px] font-mono" style={{ color: 'var(--dim)' }}>
                        <span>{dayLabel(days[0].date)}</span>
                        <span>{dayLabel(days[days.length - 1].date)}</span>
                      </div>
                    </section>
                  )}

                  {/* ── Where ── */}
                  {merchants.length > 0 && (
                    <section className="ledger-panel p-5" aria-labelledby="collection-places">
                      <p id="collection-places" className="label mb-3">Where it went</p>
                      <ul className="space-y-2">
                        {merchants.map(m => (
                          <li key={m.key} className="flex items-center justify-between gap-3">
                            <span className="text-sm truncate" style={{ color: 'var(--fg)' }}>
                              {m.name}{m.count > 1 && <span style={{ color: 'var(--dim)' }}> ×{m.count}</span>}
                            </span>
                            <span className="font-mono tabular-nums text-sm shrink-0" style={{ color: 'var(--muted)' }}>{dollars(m.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              </div>

              {/* ── Transactions ── */}
              <section className="ledger-panel overflow-hidden" aria-labelledby="collection-transactions">
                <div className="px-4 pt-4 pb-2">
                  <p id="collection-transactions" className="label">Transactions</p>
                </div>
                {timeline.map(day => (
                  <div key={day.date} role="group" aria-label={day.label}>
                    <DayHeader day={day} />
                    {day.transactions.map(tx => (
                      <TransactionCard
                        key={tx.id}
                        tx={tx}
                        accounts={accounts}
                        isDragging={false}
                        noDrag
                        kind={classifyTransaction(tx, ctx)}
                        categoryName={categoryName(tx.category_id)}
                        onDragStart={() => {}}
                        onDragEnd={() => {}}
                        onClick={() => setEditTx(tx)}
                        onDelete={() => {}}
                      />
                    ))}
                  </div>
                ))}
              </section>
            </>
          )}
        </div>
      </PageLayout>

      <CollectionFormSheet
        isOpen={editing}
        onClose={() => setEditing(false)}
        editing={collection}
        onSaved={updated => afterChange(updated)}
        onDeleted={() => { toast.info('Its transactions are still in your Timeline'); navigate(linkToCollections()); }}
      />
      <SuggestionsSheet
        collection={collection}
        isOpen={reviewing}
        onClose={() => setReviewing(false)}
        accounts={accounts}
        onReviewed={result => afterChange(result.collection)}
      />
      <EditTransactionModal isOpen={!!editTx} onClose={() => setEditTx(null)} onSuccess={() => void load()} transaction={editTx} />
    </AppShell>
  );
};

export default CollectionPage;
