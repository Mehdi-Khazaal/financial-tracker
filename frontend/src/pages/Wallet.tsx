import React, { useEffect, useState, useCallback } from 'react';
import { Account, MonthSnapshot } from '../types';
import { getAccounts, deleteAccount, getAccountHistory } from '../utils/api';
import Navigation from '../components/Navigation';
import AddAccountModal from '../components/modals/AddAccountModal';
import EditAccountModal from '../components/modals/EditAccountModal';
import TransferModal from '../components/modals/TransferModal';
import WithdrawModal from '../components/modals/WithdrawModal';
import DepositModal from '../components/modals/DepositModal';
import ProgressBar from '../components/ProgressBar';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_META: Record<string, { iconPath: string; iconColor: string; label: string; group: string }> = {
  checking:    { iconPath: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z', iconColor: '#6366f1', label: 'Checking',    group: 'Spending' },
  savings:     { iconPath: 'M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267zm4-4.849a3 3 0 11-6 0 3 3 0 016 0z M10 18a8 8 0 100-16 8 8 0 000 16z', iconColor: '#10b981', label: 'Savings',     group: 'Savings' },
  credit_card: { iconPath: 'M2 5a2 2 0 012-2h12a2 2 0 012 2v2H2V5zm0 4h16v7a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm3 3a1 1 0 000 2h.01a1 1 0 000-2H5zm2 0a1 1 0 000 2h3a1 1 0 000-2H7z', iconColor: '#f43f5e', label: 'Credit Card', group: 'Credit' },
  cash:        { iconPath: 'M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z', iconColor: '#f59e0b', label: 'Cash',        group: 'Spending' },
  investment:  { iconPath: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z', iconColor: '#a855f7', label: 'Brokerage',   group: 'Other' },
};

// Tiny sparkline using SVG
const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (data.length < 2) return null;
  const w = 72; const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - min) / range) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const Wallet: React.FC = () => {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [histories, setHistories] = useState<Record<number, MonthSnapshot[]>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getAccounts();
      const accs: Account[] = res.data;
      setAccounts(accs);
      // Fetch balance history for all accounts in parallel
      const histEntries = await Promise.all(
        accs.map(async a => {
          try {
            const h = await getAccountHistory(a.id, 6);
            return [a.id, h.data] as [number, MonthSnapshot[]];
          } catch { return [a.id, []] as [number, MonthSnapshot[]]; }
        })
      );
      setHistories(Object.fromEntries(histEntries));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  const handleDelete = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete "${name}"? All linked transactions will also be deleted.`, { danger: true });
    if (!ok) return;
    try { await deleteAccount(id); load(); toast.success('Account deleted'); }
    catch { toast.error('Failed to delete account'); }
  };

  const spendable = accounts.filter(a => a.type === 'checking' || a.type === 'cash')
    .reduce((s, a) => s + Number(a.balance), 0);
  const totalAssets = accounts.filter(a => a.type !== 'credit_card')
    .reduce((s, a) => s + Number(a.balance), 0);

  const groups = ['Spending', 'Savings', 'Credit', 'Other'];
  const grouped = groups.reduce<Record<string, Account[]>>((acc, g) => {
    acc[g] = accounts.filter(a => (TYPE_META[a.type]?.group ?? 'Other') === g);
    return acc;
  }, {});

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen" style={{ backgroundColor: '#070810' }}>
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-24 rounded-xl" />
            <div className="skeleton h-32 w-full rounded-3xl" />
            {[0,1].map(g => (
              <div key={g} className="space-y-2">
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton h-20 rounded-2xl" />
                <div className="skeleton h-20 rounded-2xl" />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text">Wallet</h1>
            <div className="flex gap-2">
              <button onClick={() => setShowDeposit(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                style={{ backgroundColor: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.2)', color: '#10b981' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Deposit
              </button>
              <button onClick={() => setShowWithdraw(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                style={{ backgroundColor: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.2)', color: '#f59e0b' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" />
                </svg>
                Withdraw
              </button>
              <button onClick={() => setShowTransfer(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                style={{ backgroundColor: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.2)', color: '#6366f1' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" /></svg>
                Transfer
              </button>
              <button onClick={() => setShowAdd(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                style={{ backgroundColor: '#121620', border: '1px solid #1a1f2e', color: '#666e90' }}>
                + Account
              </button>
            </div>
          </div>

          {/* Hero stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl p-5 relative overflow-hidden col-span-2"
              style={{ background: 'linear-gradient(145deg, #0d1018, #121620)', border: '1px solid #1a1f2e' }}>
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-15 pointer-events-none"
                style={{ background: 'radial-gradient(circle, #10b981, transparent)' }} />
              <p className="label mb-1">Spendable Balance</p>
              <p className="font-mono font-bold text-text" style={{ fontSize: '2.2rem', letterSpacing: '-1px' }}>
                ${fmt(spendable)}
              </p>
              <div className="flex gap-4 mt-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#6366f1' }}>Total Accounts</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(totalAssets)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#666e90' }}>Accounts</p>
                  <p className="font-mono font-semibold text-sm text-text">{accounts.length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* No accounts empty state */}
          {accounts.length === 0 && (
            <div className="card py-12 text-center">
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: 'rgba(99,102,241,.1)' }}>
                <svg viewBox="0 0 20 20" fill="#6366f1" className="w-6 h-6"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" /></svg>
              </div>
              <p className="font-semibold text-text mb-1">No accounts yet</p>
              <p className="text-sm text-muted mb-5">Add your bank accounts, credit cards, and cash</p>
              <button onClick={() => setShowAdd(true)}
                className="btn-gradient px-6 py-2.5 text-sm">Add First Account</button>
            </div>
          )}

          {/* Account groups */}
          {groups.map(group => {
            const list = grouped[group];
            if (!list || list.length === 0) return null;
            return (
              <div key={group}>
                <p className="label mb-3">{group}</p>
                <div className="space-y-2">
                  {list.map(account => {
                    const meta = TYPE_META[account.type] ?? { iconPath: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9z', iconColor: '#6366f1', label: account.type, group: 'Other' };
                    const isCreditCard = account.type === 'credit_card';
                    const owed = isCreditCard ? Math.abs(Number(account.balance)) : 0;
                    const limit = Number(account.credit_limit) || 0;
                    const utilized = limit > 0 ? (owed / limit) * 100 : 0;
                    const available = limit > 0 ? limit - owed : 0;
                    const hist = histories[account.id] ?? [];
                    const sparkData = hist.map(h => h.balance ?? 0);
                    const balanceChange = sparkData.length >= 2
                      ? sparkData[sparkData.length - 1] - sparkData[0]
                      : 0;
                    const sparkColor = isCreditCard
                      ? (balanceChange <= 0 ? '#10b981' : '#f43f5e')
                      : (balanceChange >= 0 ? '#10b981' : '#f43f5e');

                    return (
                      <div key={account.id} className="card card-hover p-4 group transition-all">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                              style={{ backgroundColor: meta.iconColor + '15', border: `1px solid ${meta.iconColor}25` }}>
                              <svg viewBox="0 0 20 20" fill={meta.iconColor} className="w-5 h-5">
                                <path d={meta.iconPath} />
                              </svg>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-sm text-text truncate">{account.name}</p>
                              <p className="text-xs text-muted">{meta.label}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {/* Sparkline */}
                            {sparkData.length >= 2 && (
                              <div className="hidden sm:block">
                                <Sparkline data={sparkData} color={sparkColor} />
                              </div>
                            )}
                            <div className="text-right">
                              <p className="font-mono font-bold text-base"
                                style={{ color: Number(account.balance) < 0 ? '#f43f5e' : '#eef0f8' }}>
                                {Number(account.balance) < 0 ? '-' : ''}${fmt(Number(account.balance))}
                              </p>
                              {sparkData.length >= 2 && balanceChange !== 0 && (
                                <p className="text-[10px] font-mono"
                                  style={{ color: isCreditCard ? (balanceChange <= 0 ? '#10b981' : '#f43f5e') : (balanceChange >= 0 ? '#10b981' : '#f43f5e') }}>
                                  {balanceChange >= 0 ? '+' : ''}{fmt(balanceChange)} <span className="text-muted">6mo</span>
                                </p>
                              )}
                            </div>
                            {/* Action buttons */}
                            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setEditAccount(account)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                                style={{ backgroundColor: 'rgba(99,102,241,.1)', color: '#6366f1' }}
                                title="Edit">
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>
                              </button>
                              <button
                                onClick={() => handleDelete(account.id, account.name)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                                style={{ backgroundColor: 'rgba(244,63,94,.1)', color: '#f43f5e' }}
                                title="Delete">
                                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                              </button>
                            </div>
                          </div>
                        </div>

                        {isCreditCard && limit > 0 && (
                          <div className="mt-3 pt-3" style={{ borderTop: '1px solid #1a1f2e' }}>
                            <div className="flex justify-between text-xs text-muted mb-2">
                              <span>Used ${fmt(owed)} of ${fmt(limit)}</span>
                              <span style={{ color: available > 0 ? '#10b981' : '#f43f5e' }}>
                                ${fmt(available)} available
                              </span>
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
          })}

          <div className="h-4 md:hidden" />
        </div>
      </main>

      {/* FAB */}
      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 32px rgba(99,102,241,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAccountModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      <EditAccountModal isOpen={!!editAccount} onClose={() => setEditAccount(null)} onSuccess={load} account={editAccount} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} onSuccess={load} />
      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} onSuccess={load} />
    </>
  );
};

export default Wallet;
