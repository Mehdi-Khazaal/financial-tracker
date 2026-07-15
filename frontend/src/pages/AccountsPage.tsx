import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouteTab } from '../context/TabContext';
import { Account, Loan, MonthSnapshot, Transaction } from '../types';
import {
  getAccounts, deleteAccount, getAccountHistory,
  getLoans, updateLoan, deleteLoan,
  getTransactions, cleanDescription,
} from '../utils/api';
import { localDateStr } from '../utils/date';
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
import LoadErrorBanner from '../components/LoadErrorBanner';

type Tab = 'wallet' | 'cards' | 'loans';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const getDueStatus = (loan: Loan): 'overdue' | 'soon' | 'ok' | null => {
  if (!loan.due_date || loan.status !== 'active') return null;
  const today = localDateStr();
  if (loan.due_date < today) return 'overdue';
  const days = Math.ceil((new Date(loan.due_date).getTime() - new Date(today).getTime()) / 86400000);
  return days <= 7 ? 'soon' : 'ok';
};

const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (data.length < 2) return null;
  const w = 72; const h = 28;
  const min = Math.min(...data); const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

interface LoanCardProps {
  loan: Loan; repayInput: string; repaying: boolean;
  onRepayChange: (id: number, val: string) => void;
  onRepayment: (loan: Loan) => void;
  onMarkRepaid: (id: number) => void;
  onWriteOff: (id: number) => void;
  onDelete: (loan: Loan) => void;
}

const LoanCard: React.FC<LoanCardProps> = ({ loan, repayInput, repaying, onRepayChange, onRepayment, onMarkRepaid, onWriteOff, onDelete }) => {
  const outstanding = Number(loan.amount) - Number(loan.amount_repaid);
  const progress    = Number(loan.amount) > 0 ? (Number(loan.amount_repaid) / Number(loan.amount)) * 100 : 0;
  const dueStatus   = getDueStatus(loan);
  const isActive    = loan.status === 'active';

  return (
    <div className="card overflow-hidden group">
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-base shrink-0"
              style={{ backgroundColor: 'var(--elev-sub)', color: isActive ? '#f59e0b' : 'var(--pos)', border: '1px solid var(--line)' }}>
              {loan.borrower_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm text-text">{loan.borrower_name}</p>
              <p className="text-xs text-muted">{formatDate(loan.loan_date)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="text-right">
              <p className="font-mono font-bold text-base" style={{ color: isActive ? '#f59e0b' : 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>
                ${fmt(isActive ? outstanding : Number(loan.amount))}
              </p>
              {isActive && Number(loan.amount_repaid) > 0 && (
                <p className="text-[10px] text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>of ${fmt(Number(loan.amount))}</p>
              )}
              {loan.status === 'repaid' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' }}>Repaid âœ“</span>
              )}
              {loan.status === 'written_off' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>Written off</span>
              )}
            </div>
            <button onClick={() => onDelete(loan)}
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all"
              aria-label={`Delete loan for ${loan.borrower_name}`}
              style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        {loan.note && <p className="text-xs text-muted mb-3 italic">"{loan.note}"</p>}
        {loan.due_date && isActive && (
          <div className="flex items-center gap-1.5 mb-3">
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
              style={{
                backgroundColor: dueStatus === 'overdue' ? 'oklch(70% 0.17 25 / 0.15)' : dueStatus === 'soon' ? 'rgba(245,158,11,.15)' : 'oklch(72% 0.17 55 / 0.1)',
                color: dueStatus === 'overdue' ? 'var(--neg)' : dueStatus === 'soon' ? '#f59e0b' : 'var(--accent)',
              }}>
              {dueStatus === 'overdue' ? 'Overdue Â· ' : 'Due '}{formatDate(loan.due_date)}
            </span>
          </div>
        )}
        {isActive && Number(loan.amount_repaid) > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-[10px] text-muted mb-1.5">
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>Repaid ${fmt(Number(loan.amount_repaid))}</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: 'var(--line)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: 'var(--pos)' }} />
            </div>
          </div>
        )}
      </div>
      {isActive && (
        <div className="px-4 pb-4 pt-0 space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted text-xs">$</span>
              <input type="number" step="0.01" min="0.01" value={repayInput}
                onChange={e => onRepayChange(loan.id, e.target.value)}
                className="input-dark pl-6 text-sm py-2.5"
                placeholder={`Amount received (of $${fmt(outstanding)} left)`} />
            </div>
            <button onClick={() => onRepayment(loan)}
              disabled={repaying || !repayInput || parseFloat(repayInput) <= 0}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-40 shrink-0"
              style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.2)' }}>
              {repaying ? 'â€¦' : '+ Got paid'}
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onMarkRepaid(loan.id)}
              className="flex-1 py-2 text-xs font-semibold rounded-xl transition-all active:scale-95"
              style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.08)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.15)' }}>
              Mark fully repaid
            </button>
            <button onClick={() => onWriteOff(loan.id)}
              className="flex-1 py-2 text-xs font-semibold rounded-xl transition-all active:scale-95"
              style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
              Write off
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AccountsPage: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useRouteTab('/accounts');
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
      const results = await Promise.allSettled([getAccounts(), getTransactions(), getLoans()]);
      const labels = ['accounts', 'transactions', 'loans'];
      const failed = labels.filter((_, index) => results[index].status === 'rejected');
      const accountsResult = results[0];
      if (accountsResult.status === 'fulfilled') {
        const accs: Account[] = Array.isArray(accountsResult.value.data) ? accountsResult.value.data : [];
        setAccounts(accs);
        const historyResults = await Promise.allSettled(accs.map(account => getAccountHistory(account.id, 6)));
        const historyEntries = historyResults.flatMap((result, index) =>
          result.status === 'fulfilled'
            ? [[accs[index].id, Array.isArray(result.value.data) ? result.value.data : []] as [number, MonthSnapshot[]]]
            : []
        );
        setHistories(previous => ({ ...previous, ...Object.fromEntries(historyEntries) }));
      }
      const transactionsResult = results[1];
      if (transactionsResult.status === 'fulfilled') {
        setTransactions(Array.isArray(transactionsResult.value.data) ? transactionsResult.value.data : []);
      }
      const loansResult = results[2];
      if (loansResult.status === 'fulfilled') {
        setLoans(Array.isArray(loansResult.value.data) ? loansResult.value.data : []);
      }
      setFailedSources(failed);
      setLoadError(failed.length > 0);
    } catch {
      setFailedSources(['accounts', 'transactions', 'loans']);
      setLoadError(true);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

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

  // Derived
  const ccAccounts   = accounts.filter(a => a.type === 'credit_card');
  const spendable    = accounts.filter(a => a.type === 'checking' || a.type === 'cash').reduce((s, a) => s + Number(a.balance), 0);
  const totalAssets  = accounts.filter(a => a.type !== 'credit_card').reduce((s, a) => s + Number(a.balance), 0);
  const totalOwed    = ccAccounts.reduce((s, a) => s + Math.abs(Number(a.balance)), 0);
  const totalLimit   = ccAccounts.reduce((s, a) => s + (Number(a.credit_limit) || 0), 0);
  const totalUtil    = totalLimit > 0 ? (totalOwed / totalLimit) * 100 : 0;
  const groups       = ['Spending', 'Savings', 'Credit', 'Other'];
  const grouped      = groups.reduce<Record<string, Account[]>>((acc, g) => {
    acc[g] = accounts.filter(a => (ACCOUNT_TYPE_META[a.type]?.group ?? 'Other') === g);
    return acc;
  }, {});

  const activeLoans  = loans.filter(l => l.status === 'active');
  const repaidLoans  = loans.filter(l => l.status === 'repaid');
  const writtenOff   = loans.filter(l => l.status === 'written_off');
  const totalOutstanding = activeLoans.reduce((s, l) => s + Number(l.amount) - Number(l.amount_repaid), 0);
  const totalLent    = loans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRecovered = loans.reduce((s, l) => s + Number(l.amount_repaid), 0);

  const exportLoans = (format: 'csv' | 'pdf') => {
    const headers = ['Borrower', 'Amount', 'Repaid', 'Outstanding', 'Note', 'Loan Date', 'Due Date', 'Status'];
    const rows = loans.map(l => [
      l.borrower_name,
      `$${fmt(Number(l.amount))}`,
      `$${fmt(Number(l.amount_repaid))}`,
      `$${fmt(Number(l.amount) - Number(l.amount_repaid))}`,
      l.note ?? '',
      l.loan_date,
      l.due_date ?? 'â€”',
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
          <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-32 rounded-xl" />
            <div className="skeleton h-10 w-full rounded-xl" />
            <div className="skeleton h-32 w-full rounded-xl" />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {[0,1,2,3].map(i => <div key={i} className="skeleton h-24 rounded-xl" />)}
            </div>
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'wallet', label: 'Wallet' },
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

          {/* â”€â”€ WALLET TAB â”€â”€ */}
          {tab === 'wallet' && !failedSources.includes('accounts') && (
            <>
              {/* Hero */}
              <div className="rounded-xl p-5 relative overflow-hidden"
                style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <p className="label mb-1">Spendable Balance</p>
                <p className="font-bold text-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '2.2rem', letterSpacing: '-1px' }}>
                  ${fmt(spendable)}
                </p>
                <div className="flex gap-6 mt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: 'var(--accent)' }}>Total Accounts</p>
                    <p className="font-semibold text-sm text-text" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>${fmt(totalAssets)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: 'var(--muted)' }}>Count</p>
                    <p className="font-semibold text-sm text-text" style={{ fontFamily: 'var(--font-mono)' }}>{accounts.length}</p>
                  </div>
                </div>
              </div>

              {accounts.length === 0 ? (
                <div className="card py-12 text-center">
                  <p className="font-semibold text-text mb-1">No accounts yet</p>
                  <p className="text-sm text-muted mb-5">Add your bank accounts, credit cards, and cash</p>
                  <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">Add First Account</button>
                </div>
              ) : (
                groups.map(group => {
                  const list = grouped[group];
                  if (!list || list.length === 0) return null;
                  return (
                    <div key={group}>
                      <p className="label mb-3">{group}</p>
                      <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {list.map(account => {
                          const meta = ACCOUNT_TYPE_META[account.type] ?? ACCOUNT_TYPE_META.checking;
                          const isCreditCard = account.type === 'credit_card';
                          const owed = isCreditCard ? Math.abs(Number(account.balance)) : 0;
                          const limit = Number(account.credit_limit) || 0;
                          const utilized = limit > 0 ? (owed / limit) * 100 : 0;
                          const available = limit > 0 ? limit - owed : 0;
                          const hist = histories[account.id] ?? [];
                          const sparkData = hist.map(h => h.balance ?? 0);
                          const balanceChange = sparkData.length >= 2 ? sparkData[sparkData.length - 1] - sparkData[0] : 0;
                          const sparkColor = isCreditCard
                            ? (balanceChange <= 0 ? 'var(--pos)' : 'var(--neg)')
                            : (balanceChange >= 0 ? 'var(--pos)' : 'var(--neg)');

                          return (
                            <div key={account.id} className="card card-hover p-4 group transition-all">
                              {/* Top row: icon + name + action buttons */}
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <AccountTypeIcon type={account.type} className="w-9 h-9" iconClassName="w-[18px] h-[18px]" />
                                  <div className="min-w-0">
                                    <p className="font-semibold text-sm text-text leading-snug">{account.name}</p>
                                    <p className="text-xs text-muted">{meta.label}</p>
                                  </div>
                                </div>
                                <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                                  <button onClick={() => setEditAccount(account)}
                                    className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all"
                                    aria-label={`Edit ${account.name}`}
                                    style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)' }}>
                                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                                  </button>
                                  <button onClick={() => handleDeleteAccount(account.id, account.name)}
                                    className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-all"
                                    aria-label={`Delete ${account.name}`}
                                    style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>
                                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                  </button>
                                </div>
                              </div>
                              {/* Bottom row: balance + sparkline */}
                              <div className="flex items-end justify-between">
                                <div>
                                  <p className="font-bold text-lg" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: Number(account.balance) < 0 ? 'var(--neg)' : 'var(--fg)' }}>
                                    {Number(account.balance) < 0 ? '-' : ''}${fmt(Number(account.balance))}
                                  </p>
                                  {sparkData.length >= 2 && balanceChange !== 0 && (
                                    <p className="text-[10px] mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: isCreditCard ? (balanceChange <= 0 ? 'var(--pos)' : 'var(--neg)') : (balanceChange >= 0 ? 'var(--pos)' : 'var(--neg)') }}>
                                      {balanceChange >= 0 ? '+' : ''}{fmt(balanceChange)} <span className="text-muted">6mo</span>
                                    </p>
                                  )}
                                </div>
                                {sparkData.length >= 2 && <Sparkline data={sparkData} color={sparkColor} />}
                              </div>
                              {isCreditCard && limit > 0 && (
                                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                                  <div className="flex justify-between text-xs text-muted mb-2">
                                    <span>Used ${fmt(owed)} of ${fmt(limit)}</span>
                                    <span style={{ color: available > 0 ? 'var(--pos)' : 'var(--neg)' }}>${fmt(available)} available</span>
                                  </div>
                                  <ProgressBar value={utilized} colorAuto />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {/* â”€â”€ CARDS TAB â”€â”€ */}
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
                  {totalLimit > 0 && (
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
                      const owed = Math.abs(Number(card.balance));
                      const limit = Number(card.credit_limit) || 0;
                      const available = limit > 0 ? limit - owed : 0;
                      const utilized = limit > 0 ? (owed / limit) * 100 : 0;
                      const cardTxs = transactions.filter(t => t.account_id === card.id).slice(0, 5);
                      return (
                        <div key={card.id} className="card overflow-hidden">
                          <div className="relative p-5 overflow-hidden" style={{ backgroundColor: 'var(--elev-1)', borderBottom: '1px solid var(--line)' }}>
                            <div className="flex justify-between items-start mb-6">
                              <div>
                                <p className="font-bold text-text">{card.name}</p>
                                <p className="text-xs text-muted mt-0.5">Credit Card</p>
                              </div>
                              <AccountTypeIcon type="credit_card" className="w-9 h-9" iconClassName="w-[18px] h-[18px]" />
                            </div>
                            <div className="flex justify-between items-end">
                              <div>
                                <p className="text-[10px] uppercase tracking-widest text-muted mb-1">Balance Owed</p>
                                <p className="font-bold text-2xl" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--neg)' }}>${fmt(owed)}</p>
                              </div>
                              {limit > 0 && (
                                <div className="text-right">
                                  <p className="text-[10px] uppercase tracking-widest text-muted mb-1">Available</p>
                                  <p className="font-bold text-lg" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--pos)' }}>${fmt(available)}</p>
                                </div>
                              )}
                            </div>
                          </div>
                          {limit > 0 && (
                            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                              <div className="flex justify-between text-xs text-muted mb-2">
                                <span>Used: ${fmt(owed)}</span><span>Limit: ${fmt(limit)}</span>
                              </div>
                              <ProgressBar value={utilized} colorAuto height={6} />
                            </div>
                          )}
                          <div className="px-5 py-3 flex gap-2" style={{ borderBottom: cardTxs.length > 0 ? '1px solid var(--line)' : 'none' }}>
                            <button onClick={() => setPayCard(card)}
                              className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
                              style={{ backgroundColor: 'var(--accent)', color: 'white' }}>Pay Card</button>
                            <button onClick={() => setEditAccount(card)}
                              className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
                              style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.2)' }}>Edit</button>
                            <button onClick={() => handleDeleteAccount(card.id, card.name)}
                              className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
                              style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)', border: '1px solid oklch(70% 0.17 25 / 0.2)' }}>Delete</button>
                          </div>
                          {cardTxs.length > 0 && (
                            <div className="px-5 py-3">
                              <p className="label mb-3">Recent Transactions</p>
                              {cardTxs.map((tx, i) => {
                                const pos = Number(tx.amount) >= 0;
                                return (
                                  <div key={tx.id} className={`flex items-center justify-between py-2.5 ${i !== cardTxs.length - 1 ? 'border-b border-border' : ''}`}>
                                    <div>
                                      <p className="text-sm font-medium text-text">{cleanDescription(tx.description)}</p>
                                      <p className="text-xs text-muted">{tx.transaction_date}</p>
                                    </div>
                                    <p className="font-semibold text-sm" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pos ? 'var(--pos)' : 'var(--neg)' }}>
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

          {/* â”€â”€ LOANS TAB â”€â”€ */}
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
