import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouteTab } from '../context/TabContext';
import { useDeepLinkParams } from '../hooks/useDeepLinkParams';
import { DEEP_LINK_KEYS, parseIdParam } from '../lib/deepLinks';
import { Account, Loan, MonthSnapshot, Transaction } from '../types';
import {
  getAccounts, deleteAccount, getAccountHistories,
  getLoans, updateLoan, deleteLoan,
  fetchAllTransactions, cleanDescription,
} from '../utils/api';
import { downloadCSV, printPDF } from '../utils/export';
import { AppShell, PageLayout } from '../components/layout/AppShell';
import PullToRefresh from '../components/PullToRefresh';
import ProgressBar from '../components/ProgressBar';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import AddAccountModal from '../components/modals/AddAccountModal';
import EditAccountModal from '../components/modals/EditAccountModal';
import TransferModal from '../components/modals/TransferModal';
import WithdrawModal from '../components/modals/WithdrawModal';
import DepositModal from '../components/modals/DepositModal';
import AddLoanModal from '../components/modals/AddLoanModal';
import { ACCOUNT_TYPE_META, AccountTypeIcon } from '../components/dashboard/DashboardPrimitives';
import { calculateAccountTotals } from '../features/accounts/calculations/totals';
import { calculateLoanTotals } from '../features/accounts/calculations/loans';
import AccountCard from '../features/accounts/components/AccountCard';
import AccountsSummary from '../features/accounts/components/AccountsSummary';
import LoanCard from '../features/accounts/components/LoanCard';
import LoadErrorBanner from '../components/LoadErrorBanner';
import { AccountsPageSkeleton } from '../components/Skeleton';

type Tab = 'wallet' | 'cards' | 'loans';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Accounts page
const AccountsPage: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useRouteTab('/accounts');
  const [focusAccountId, setFocusAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [failedSources, setFailedSources] = useState<string[]>([]);

  // Wallet / Cards state
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [histories, setHistories] = useState<Record<number, MonthSnapshot[]>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showFundsMenu, setShowFundsMenu] = useState(false);
  const [payCard, setPayCard] = useState<Account | null>(null);

  // Loans state
  const [loans, setLoans] = useState<Loan[]>([]);
  const [showAddLoan, setShowAddLoan] = useState(false);
  const [repayInput, setRepayInput] = useState<Record<number, string>>({});
  const [repaying, setRepaying] = useState<number | null>(null);
  const [showLoanExport, setShowLoanExport] = useState(false);
  const loanExportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    setFailedSources([]);
    try {
      // Paginated, not the API's default first 500 rows. The Cards tab slices
      // per-card activity out of this list, so a bare fetch meant a card whose
      // recent charges fell outside the newest 500 transactions showed nothing
      // — or worse, an older card's charges — with no indication anything was
      // missing.
      const results = await Promise.allSettled([getAccounts(), fetchAllTransactions(), getLoans(), getAccountHistories(6)]);
      const labels = ['accounts', 'transactions', 'loans', 'history'];
      const failed = labels.filter((_, index) => results[index].status === 'rejected');
      const accountsResult = results[0];
      if (accountsResult.status === 'fulfilled') {
        const accs: Account[] = Array.isArray(accountsResult.value.data) ? accountsResult.value.data : [];
        setAccounts(accs);
      }
      const transactionsResult = results[1];
      if (transactionsResult.status === 'fulfilled') {
        // `fetchAllTransactions` resolves to a page object, not an Axios
        // response. This page shows account-scoped views rather than whole-
        // ledger totals, so the cap is not surfaced here — the Transactions
        // page is where an incomplete ledger is stated.
        const rows = transactionsResult.value?.transactions;
        setTransactions(Array.isArray(rows) ? rows : []);
      }
      const loansResult = results[2];
      if (loansResult.status === 'fulfilled') {
        setLoans(Array.isArray(loansResult.value.data) ? loansResult.value.data : []);
      }
      const historiesResult = results[3];
      if (historiesResult.status === 'fulfilled') {
        const data = historiesResult.value.data;
        setHistories(data && typeof data === 'object' && !Array.isArray(data) ? data : {});
      }
      setFailedSources(failed);
      setLoadError(failed.length > 0);
    } catch {
      setFailedSources(['accounts', 'transactions', 'loans', 'history']);
      setLoadError(true);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  // Arriving from an account named elsewhere. Waits for the accounts to load,
  // otherwise the element to scroll to does not exist yet.
  useDeepLinkParams(params => {
    const requestedTab = params.get(DEEP_LINK_KEYS.tab);
    if (requestedTab === 'wallet' || requestedTab === 'cards' || requestedTab === 'loans') {
      setTab(requestedTab);
    }
    setFocusAccountId(parseIdParam(params.get(DEEP_LINK_KEYS.focusAccount)));
  }, accounts.length > 0);

  // Scroll the named account into view and mark it, then release the mark so a
  // highlight from an old link never sticks to the page.
  useEffect(() => {
    if (focusAccountId == null) return;
    const node = document.getElementById(`account-${focusAccountId}`);
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = window.setTimeout(() => setFocusAccountId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [focusAccountId, tab]);

  const handleDeleteAccount = useCallback(async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete "${name}"? All linked transactions will also be deleted.`, { danger: true });
    if (!ok) return;
    try { await deleteAccount(id); load(); toast.success('Account deleted'); }
    catch { toast.error('Failed to delete account'); }
  }, [toast, load]);

  const handleRepayChange = useCallback((id: number, val: string) => setRepayInput(prev => ({ ...prev, [id]: val })), []);

  const handleDeleteLoan = useCallback(async (loan: Loan) => {
    const ok = await toast.confirm(`Delete loan for "${loan.borrower_name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteLoan(loan.id); load(); toast.success('Loan deleted'); }
    catch { toast.error('Failed to delete'); }
  }, [toast, load]);

  const handleWriteOff = useCallback(async (id: number) => {
    const ok = await toast.confirm("Mark this loan as written off?", { danger: true });
    if (!ok) return;
    try { await updateLoan(id, { status: 'written_off' }); load(); toast.success('Loan written off'); }
    catch { toast.error('Failed to update'); }
  }, [toast, load]);

  const handleRepayment = useCallback(async (loan: Loan) => {
    const input = repayInput[loan.id];
    if (!input || parseFloat(input) <= 0) return;
    setRepaying(loan.id);
    try {
      const newRepaid = Math.min(Number(loan.amount_repaid) + parseFloat(input), Number(loan.amount));
      await updateLoan(loan.id, { amount_repaid: newRepaid });
      setRepayInput(prev => { const n = { ...prev }; delete n[loan.id]; return n; });
      load(); toast.success(`Recorded $${fmt(parseFloat(input))} repayment`);
    } catch { toast.error('Failed to record repayment'); }
    finally { setRepaying(null); }
  }, [repayInput, toast, load]);

  const handleMarkRepaid = useCallback(async (id: number) => {
    try { await updateLoan(id, { status: 'repaid' }); load(); toast.success('Marked as fully repaid'); }
    catch { toast.error('Failed to update'); }
  }, [toast, load]);

  // Derived — every figure below comes from the canonical definitions in
  // `features/accounts/calculations/totals`, which Overview, Analytics and the
  // backend's net-worth series all share. This page used to compute its own,
  // and quietly disagreed with them about credit-card debt.
  const ccAccounts   = accounts.filter(a => a.type === 'credit_card');
  const totals       = calculateAccountTotals(accounts);
  const totalOwed    = totals.cardDebt;
  const totalLimit   = totals.creditLimit;
  const totalUtil    = totals.utilization;
  const groups       = ['Spending', 'Savings', 'Credit', 'Other'];
  const grouped      = groups.reduce<Record<string, Account[]>>((acc, g) => {
    acc[g] = accounts.filter(a => (ACCOUNT_TYPE_META[a.type]?.group ?? 'Other') === g);
    return acc;
  }, {});

  const activeLoans  = loans.filter(l => l.status === 'active');
  const repaidLoans  = loans.filter(l => l.status === 'repaid');
  const writtenOff   = loans.filter(l => l.status === 'written_off');
  // Shared with the loan cards, so the summary and the rows agree about
  // overpayment and written-off loans.
  const loanTotals   = calculateLoanTotals(loans);
  const totalOutstanding = loanTotals.outstanding;
  const totalLent    = loanTotals.lent;
  const totalRecovered = loanTotals.recovered;

  const exportLoans = (format: 'csv' | 'pdf') => {
    const headers = ['Borrower', 'Amount', 'Repaid', 'Outstanding', 'Note', 'Loan Date', 'Due Date', 'Status'];
    const rows = loans.map(l => [
      l.borrower_name,
      `$${fmt(Number(l.amount))}`,
      `$${fmt(Number(l.amount_repaid))}`,
      `$${fmt(Number(l.amount) - Number(l.amount_repaid))}`,
      l.note ?? '',
      l.loan_date,
      l.due_date ?? 'N/A',
      l.status,
    ]);
    if (format === 'csv') downloadCSV(`loans-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    else printPDF('Loans', headers, rows);
    setShowLoanExport(false);
  };

  if (loading) {
    return (
      <AppShell>
        <PageLayout>
          <AccountsPageSkeleton />
        </PageLayout>
      </AppShell>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'wallet', label: 'Banking' },
    { id: 'cards', label: 'Cards' },
    { id: 'loans', label: 'Loans' },
  ];

  return (
    <AppShell>
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <PageLayout>
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="product-page-header topbar-safe">
            <h1 className="product-page-title">Accounts</h1>
            <div className="product-header-actions">
              {tab === 'wallet' && (
                <>
                  <div className="relative">
                    <button onClick={() => setShowFundsMenu(v => !v)}
                      className="header-action header-action--positive"
                      aria-haspopup="menu" aria-expanded={showFundsMenu}>
                      Funds
                    </button>
                    {showFundsMenu && (
                      <>
                        <div className="menu-backdrop fixed inset-0" onClick={() => setShowFundsMenu(false)} />
                        <div className="menu-surface absolute left-0 top-12 min-w-[144px]" role="menu">
                          <button onClick={() => { setShowFundsMenu(false); setShowDeposit(true); }}
                            className="menu-item text-sm font-semibold" style={{ color: 'var(--pos)' }} role="menuitem">
                            Deposit
                          </button>
                          <button onClick={() => { setShowFundsMenu(false); setShowWithdraw(true); }}
                            className="menu-item text-sm font-semibold border-t border-line" style={{ color: 'var(--accent)' }} role="menuitem">
                            Withdraw
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button onClick={() => setShowTransfer(true)}
                    className="header-action header-action--primary">
                    Transfer
                  </button>
                  <button onClick={() => setShowAdd(true)}
                    className="header-action">
                    + Account
                  </button>
                </>
              )}
              {tab === 'cards' && (
                <button onClick={() => setShowAdd(true)}
                  className="header-action">
                  + Card
                </button>
              )}
              {tab === 'loans' && (
                <>
                  {loans.length > 0 && (
                    <div ref={loanExportRef} className="relative">
                      <button onClick={() => setShowLoanExport(v => !v)}
                        className="header-action"
                        aria-haspopup="menu" aria-expanded={showLoanExport}>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                        Export
                      </button>
                      {showLoanExport && (
                        <>
                          <div className="menu-backdrop fixed inset-0" onClick={() => setShowLoanExport(false)} />
                          <div className="menu-surface absolute right-0 top-12 min-w-[120px]" role="menu">
                            <button onClick={() => exportLoans('csv')}
                              className="menu-item text-sm font-semibold" style={{ color: 'var(--pos)' }} role="menuitem">
                              CSV
                            </button>
                            <button onClick={() => exportLoans('pdf')}
                              className="menu-item text-sm font-semibold border-t border-line" style={{ color: 'var(--neg)' }} role="menuitem">
                              PDF
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <button onClick={() => setShowAddLoan(true)}
                    className="header-action header-action--primary">
                    + Loan
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="hidden md:block sticky z-20 py-2 -mx-6 px-6" style={{ top: 0, backgroundColor: 'var(--bg)' }}>
            <div className="flex p-1 rounded-xl gap-0.5" style={{ backgroundColor: 'var(--elev-1)' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-all"
                  style={tab === t.id
                    ? { backgroundColor: 'var(--bg)', color: 'var(--fg)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
                    : { color: 'var(--muted)' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {loadError && <LoadErrorBanner message={`Some data could not be refreshed: ${failedSources.join(', ')}. Available tabs are still shown.`} onRetry={() => void load()} />}

          {/* Wallet tab */}
          {tab === 'wallet' && !failedSources.includes('accounts') && (
            <>
              <AccountsSummary totals={totals} />

              {accounts.length === 0 ? (
                <div className="card py-12 text-center">
                  <p className="font-semibold text-text mb-1">No accounts yet</p>
                  <p className="text-sm text-muted mb-5">Add your bank accounts, credit cards, and cash</p>
                  <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">Add First Account</button>
                </div>
              ) : (
                // Groups flow into columns rather than stacking full-width.
                // Stacked, a group holding one account left three quarters of a
                // 1440 viewport empty and squeezed the card into a quarter-width
                // column that truncated its own name.
                <div className="lg:columns-2 xl:columns-3 gap-4 space-y-5 lg:space-y-0">
                {groups.map(group => {
                  const list = grouped[group];
                  if (!list || list.length === 0) return null;
                  return (
                    <div key={group} className="break-inside-avoid mb-5">
                      <p className="label mb-3">{group}</p>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-3">
                        {list.map(account => (
                          <AccountCard
                            key={account.id}
                            account={account}
                            history={histories[account.id]}
                            isFocused={focusAccountId === account.id}
                            onEdit={setEditAccount}
                            onDelete={a => handleDeleteAccount(a.id, a.name)}
                            onRecordPayment={setPayCard}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </>
          )}

          {/* Cards tab */}
          {tab === 'cards' && !failedSources.includes('accounts') && (
            <>
              {ccAccounts.length === 0 ? (
                <div className="card py-14 text-center">
                  <AccountTypeIcon type="credit_card" className="w-12 h-12 mx-auto mb-3" iconClassName="w-6 h-6" />
                  <p className="font-semibold text-text mb-1">No credit cards</p>
                  <p className="text-sm text-muted mb-5">Add your credit cards to track spending and limits</p>
                  <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">Add Credit Card</button>
                </div>
              ) : (
                <>
                  {totalUtil != null && (
                    <div className="card p-5">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <p className="label mb-0.5">Overall Utilization</p>
                          <p className="font-bold text-xl text-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{totalUtil.toFixed(0)}%</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted">Total Owed</p>
                          <p className="font-semibold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--neg)' }}>${fmt(totalOwed)}</p>
                          <p className="text-xs text-muted mt-0.5">Limit ${fmt(totalLimit)}</p>
                        </div>
                      </div>
                      <ProgressBar value={totalUtil} colorAuto showLabel={false} height={8} />
                    </div>
                  )}
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {ccAccounts.map(card => {
                      const cardTxs = transactions.filter(t => t.account_id === card.id).slice(0, 5);
                      return (
                        <div key={card.id} className="flex flex-col gap-3">
                          {/* The same card component the Wallet tab uses — one
                              implementation of owed / available / utilisation,
                              so the two tabs cannot drift apart again. */}
                          <AccountCard
                            account={card}
                            history={histories[card.id]}
                            isFocused={focusAccountId === card.id}
                            onEdit={setEditAccount}
                            onDelete={a => handleDeleteAccount(a.id, a.name)}
                            onRecordPayment={setPayCard}
                          />

                          {/* Tab-specific detail, not a second account card. */}
                          {cardTxs.length > 0 && (
                            <div className="card px-4 py-3">
                              <p className="label mb-2.5">Recent on this card</p>
                              {cardTxs.map((tx, i) => {
                                const pos = Number(tx.amount) >= 0;
                                return (
                                  <div
                                    key={tx.id}
                                    className="flex items-center justify-between gap-3 py-2"
                                    style={{ borderBottom: i !== cardTxs.length - 1 ? '1px solid var(--line)' : 'none' }}
                                  >
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium truncate" style={{ color: 'var(--fg)' }} title={cleanDescription(tx.description)}>
                                        {cleanDescription(tx.description)}
                                      </p>
                                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>{tx.transaction_date}</p>
                                    </div>
                                    <p
                                      className="font-mono tabular-nums font-semibold text-xs shrink-0"
                                      style={{ color: pos ? 'var(--pos)' : 'var(--neg)' }}
                                    >
                                      {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}

          {/* Loans tab */}
          {tab === 'loans' && !failedSources.includes('loans') && (
            <>
              {loans.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Outstanding', value: `$${fmt(totalOutstanding)}`, color: '#f59e0b' },
                    { label: 'Total Lent',  value: `$${fmt(totalLent)}`,        color: 'var(--fg)' },
                    { label: 'Recovered',   value: `$${fmt(totalRecovered)}`,   color: 'var(--pos)' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                      <p className="label mb-1">{s.label}</p>
                      <p className="font-mono font-bold text-sm" style={{ color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {loans.length === 0 ? (
                <div className="card py-14 text-center">
                  <p className="font-semibold text-text mb-1">No loans tracked</p>
                  <p className="text-sm text-muted mb-5">Record money you've lent to friends or family.</p>
                  <button onClick={() => setShowAddLoan(true)} className="btn-gradient px-6 py-2.5 text-sm">Record a Loan</button>
                </div>
              ) : (
                <div className="space-y-5">
                  {activeLoans.length > 0 && (
                    <div className="space-y-3">
                      <p className="label">Waiting for repayment
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(245,158,11,.15)', color: '#f59e0b' }}>
                          {activeLoans.length}
                        </span>
                      </p>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {activeLoans.map(l => (
                          <LoanCard key={l.id} loan={l} repayInput={repayInput[l.id] ?? ''} repaying={repaying === l.id}
                            onRepayChange={handleRepayChange} onRepayment={handleRepayment}
                            onMarkRepaid={handleMarkRepaid} onWriteOff={handleWriteOff} onDelete={handleDeleteLoan} />
                        ))}
                      </div>
                    </div>
                  )}
                  {repaidLoans.length > 0 && (
                    <div className="space-y-3">
                      <p className="label opacity-60">Repaid</p>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-60">
                        {repaidLoans.map(l => (
                          <LoanCard key={l.id} loan={l} repayInput="" repaying={false}
                            onRepayChange={handleRepayChange} onRepayment={handleRepayment}
                            onMarkRepaid={handleMarkRepaid} onWriteOff={handleWriteOff} onDelete={handleDeleteLoan} />
                        ))}
                      </div>
                    </div>
                  )}
                  {writtenOff.length > 0 && (
                    <div className="space-y-3">
                      <p className="label opacity-40">Written Off</p>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3 opacity-40">
                        {writtenOff.map(l => (
                          <LoanCard key={l.id} loan={l} repayInput="" repaying={false}
                            onRepayChange={handleRepayChange} onRepayment={handleRepayment}
                            onMarkRepaid={handleMarkRepaid} onWriteOff={handleWriteOff} onDelete={handleDeleteLoan} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="h-4 md:hidden" />
        </div>
      </PageLayout>

      <AddAccountModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      <EditAccountModal isOpen={!!editAccount} onClose={() => setEditAccount(null)} onSuccess={load} account={editAccount} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
      <TransferModal isOpen={!!payCard} onClose={() => setPayCard(null)} onSuccess={() => { setPayCard(null); load(); }} preselectedToId={payCard?.id} />
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} onSuccess={load} />
      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} onSuccess={load} />
      <AddLoanModal isOpen={showAddLoan} onClose={() => setShowAddLoan(false)} onSuccess={load} />
    </AppShell>
  );
};

export default AccountsPage;
