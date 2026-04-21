import React, { useEffect, useState, useCallback } from 'react';
import { useRouteTab } from '../context/TabContext';
import { Account, Loan, MonthSnapshot, Transaction } from '../types';
import {
  getAccounts, deleteAccount, getAccountHistory,
  getLoans, updateLoan, deleteLoan,
  getTransactions, cleanDescription,
} from '../utils/api';
import { localDateStr } from '../utils/date';
import Navigation from '../components/Navigation';
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

const TYPE_META: Record<string, { iconPath: string; iconColor: string; label: string; group: string }> = {
  checking:    { iconPath: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z', iconColor: 'var(--accent)', label: 'Checking',    group: 'Spending' },
  savings:     { iconPath: 'M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267zm4-4.849a3 3 0 11-6 0 3 3 0 016 0z M10 18a8 8 0 100-16 8 8 0 000 16z', iconColor: 'var(--pos)', label: 'Savings',     group: 'Savings' },
  credit_card: { iconPath: 'M2 5a2 2 0 012-2h12a2 2 0 012 2v2H2V5zm0 4h16v7a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm3 3a1 1 0 000 2h.01a1 1 0 000-2H5zm2 0a1 1 0 000 2h3a1 1 0 000-2H7z', iconColor: 'var(--neg)', label: 'Credit Card', group: 'Credit' },
  cash:        { iconPath: 'M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z', iconColor: '#f59e0b', label: 'Cash',        group: 'Spending' },
  investment:  { iconPath: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z', iconColor: '#a855f7', label: 'Brokerage',   group: 'Other' },
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
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' }}>Repaid ✓</span>
              )}
              {loan.status === 'written_off' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>Written off</span>
              )}
            </div>
            <button onClick={() => onDelete(loan)}
              className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center transition-all mt-0.5"
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
              {dueStatus === 'overdue' ? 'Overdue · ' : 'Due '}{formatDate(loan.due_date)}
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
              {repaying ? '…' : '+ Got paid'}
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

// ─────────────────────────────────────────────────────────────────────────────
const AccountsPage: React.FC = () => {
  const toast = useToast();
  const [tab, setTab] = useRouteTab('/accounts');
  const [loading, setLoading] = useState(true);

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

  const load = useCallback(async () => {
    try {
      const [aRes, tRes, lRes] = await Promise.all([getAccounts(), getTransactions(), getLoans()]);
      const accs: Account[] = Array.isArray(aRes.data) ? aRes.data : [];
      setAccounts(accs);
      setTransactions(Array.isArray(tRes.data) ? tRes.data : []);
      setLoans(Array.isArray(lRes.data) ? lRes.data : []);
      // Sparklines
      const histEntries = await Promise.all(
        accs.map(async a => {
          try { const h = await getAccountHistory(a.id, 6); return [a.id, h.data] as [number, MonthSnapshot[]]; }
          catch { return [a.id, []] as [number, MonthSnapshot[]]; }
        })
      );
      setHistories(Object.fromEntries(histEntries));
    } catch { /* ignore */ }
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
    acc[g] = accounts.filter(a => (TYPE_META[a.type]?.group ?? 'Other') === g);
    return acc;
  }, {});

  const activeLoans  = loans.filter(l => l.status === 'active');
  const repaidLoans  = loans.filter(l => l.status === 'repaid');
  const writtenOff   = loans.filter(l => l.status === 'written_off');
  const totalOutstanding = activeLoans.reduce((s, l) => s + Number(l.amount) - Number(l.amount_repaid), 0);
  const totalLent    = loans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRecovered = loans.reduce((s, l) => s + Number(l.amount_repaid), 0);

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="max-w-5xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-32 rounded-xl" />
            <div className="skeleton h-10 w-full rounded-xl" />
            <div className="skeleton h-32 w-full rounded-3xl" />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0,1,2,3].map(i => <div key={i} className="skeleton h-24 rounded-2xl" />)}
            </div>
          </div>
        </div>
      </>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'wallet', label: 'Wallet' },
    { id: 'cards', label: 'Cards' },
    { id: 'loans', label: 'Loans' },
  ];

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <main className="md:ml-60 min-h-screen pb-44 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-5xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between pr-12 md:pr-0">
            <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Accounts</h1>
            <div className="flex gap-2">
              {tab === 'wallet' && (
                <>
                  <div className="relative">
                    <button onClick={() => setShowFundsMenu(v => !v)}
                      className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                      style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.1)', border: '1px solid oklch(78% 0.16 150 / 0.2)', color: 'var(--pos)' }}>
                      Funds
                    </button>
                    {showFundsMenu && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowFundsMenu(false)} />
                        <div className="absolute right-0 top-9 z-20 rounded-xl overflow-hidden shadow-2xl"
                          style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', minWidth: '130px' }}>
                          <button onClick={() => { setShowFundsMenu(false); setShowDeposit(true); }}
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--pos)' }}>
                            Deposit
                          </button>
                          <button onClick={() => { setShowFundsMenu(false); setShowWithdraw(true); }}
                            className="flex items-center gap-2 w-full px-4 py-2.5 text-xs font-semibold" style={{ color: '#f59e0b', borderTop: '1px solid var(--line)' }}>
                            Withdraw
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button onClick={() => setShowTransfer(true)}
                    className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                    style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', border: '1px solid oklch(72% 0.17 55 / 0.2)', color: 'var(--accent)' }}>
                    Transfer
                  </button>
                  <button onClick={() => setShowAdd(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-full"
                    style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                    + Account
                  </button>
                </>
              )}
              {tab === 'cards' && (
                <button onClick={() => setShowAdd(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
                  + Card
                </button>
              )}
              {tab === 'loans' && (
                <button onClick={() => setShowAddLoan(true)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: '#f59e0b' }}>
                  + Loan
                </button>
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

          {/* ── WALLET TAB ── */}
          {tab === 'wallet' && (
            <>
              {/* Hero */}
              <div className="rounded-3xl p-5 relative overflow-hidden"
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
                      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {list.map(account => {
                          const meta = TYPE_META[account.type] ?? { iconPath: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z', iconColor: 'var(--accent)', label: account.type, group: 'Other' };
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
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}>
                                    <svg viewBox="0 0 20 20" fill={meta.iconColor} className="w-5 h-5">
                                      <path d={meta.iconPath} />
                                    </svg>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-sm text-text truncate">{account.name}</p>
                                    <p className="text-xs text-muted">{meta.label}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {sparkData.length >= 2 && (
                                    <div className="hidden lg:block">
                                      <Sparkline data={sparkData} color={sparkColor} />
                                    </div>
                                  )}
                                  <div className="text-right">
                                    <p className="font-bold text-base" style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: Number(account.balance) < 0 ? 'var(--neg)' : 'var(--fg)' }}>
                                      {Number(account.balance) < 0 ? '-' : ''}${fmt(Number(account.balance))}
                                    </p>
                                    {sparkData.length >= 2 && balanceChange !== 0 && (
                                      <p className="text-[10px]" style={{ fontFamily: 'var(--font-mono)', color: isCreditCard ? (balanceChange <= 0 ? 'var(--pos)' : 'var(--neg)') : (balanceChange >= 0 ? 'var(--pos)' : 'var(--neg)') }}>
                                        {balanceChange >= 0 ? '+' : ''}{fmt(balanceChange)} <span className="text-muted">6mo</span>
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => setEditAccount(account)}
                                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                                      style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)' }}>
                                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                                    </button>
                                    <button onClick={() => handleDeleteAccount(account.id, account.name)}
                                      className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                                      style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>
                                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                    </button>
                                  </div>
                                </div>
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

          {/* ── CARDS TAB ── */}
          {tab === 'cards' && (
            <>
              {ccAccounts.length === 0 ? (
                <div className="card py-14 text-center">
                  <p className="text-4xl mb-3">💳</p>
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
                  <div className="grid md:grid-cols-2 gap-4">
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
                              <span className="text-2xl">💳</span>
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

          {/* ── LOANS TAB ── */}
          {tab === 'loans' && (
            <>
              {loans.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Outstanding', value: `$${fmt(totalOutstanding)}`, color: '#f59e0b' },
                    { label: 'Total Lent',  value: `$${fmt(totalLent)}`,        color: 'var(--fg)' },
                    { label: 'Recovered',   value: `$${fmt(totalRecovered)}`,   color: 'var(--pos)' },
                  ].map(s => (
                    <div key={s.label} className="rounded-2xl p-4" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
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
                      <div className="grid md:grid-cols-2 gap-3">
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
                      <div className="grid md:grid-cols-2 gap-3 opacity-60">
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
                      <div className="grid md:grid-cols-2 gap-3 opacity-40">
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
      </main>

      {/* FAB */}
      <button
        onClick={() => tab === 'loans' ? setShowAddLoan(true) : setShowAdd(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', backgroundColor: tab === 'loans' ? '#f59e0b' : 'var(--accent)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAccountModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      <EditAccountModal isOpen={!!editAccount} onClose={() => setEditAccount(null)} onSuccess={load} account={editAccount} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
      <TransferModal isOpen={!!payCard} onClose={() => setPayCard(null)} onSuccess={() => { setPayCard(null); load(); }} preselectedToId={payCard?.id} />
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} onSuccess={load} />
      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} onSuccess={load} />
      <AddLoanModal isOpen={showAddLoan} onClose={() => setShowAddLoan(false)} onSuccess={load} />
    </>
  );
};

export default AccountsPage;
