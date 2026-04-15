import React, { useEffect, useState } from 'react';
import { Account, MonthSnapshot } from '../types';
import { getAccounts, deleteAccount, getAccountHistory } from '../utils/api';
import Navigation from '../components/Navigation';
import AddAccountModal from '../components/modals/AddAccountModal';
import EditAccountModal from '../components/modals/EditAccountModal';
import TransferModal from '../components/modals/TransferModal';
import ProgressBar from '../components/ProgressBar';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_META: Record<string, { icon: string; label: string; group: string }> = {
  checking:    { icon: '🏦', label: 'Checking',    group: 'Spending' },
  savings:     { icon: '💰', label: 'Savings',     group: 'Savings' },
  credit_card: { icon: '💳', label: 'Credit Card', group: 'Credit' },
  cash:        { icon: '💵', label: 'Cash',        group: 'Spending' },
  investment:  { icon: '📈', label: 'Brokerage',   group: 'Other' },
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [histories, setHistories] = useState<Record<number, MonthSnapshot[]>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
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
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"? All transactions will also be deleted.`)) return;
    try { await deleteAccount(id); load(); }
    catch { alert('Failed to delete'); }
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
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#0b0d12' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: '#5b8fff', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#0b0d12' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text">Wallet</h1>
            <div className="flex gap-2">
              <button onClick={() => setShowTransfer(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                style={{ backgroundColor: '#181c28', border: '1px solid #252a3a', color: '#5b8fff' }}>
                ⇄ Transfer
              </button>
              <button onClick={() => setShowAdd(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                style={{ backgroundColor: '#181c28', border: '1px solid #252a3a', color: '#7880a0' }}>
                + Account
              </button>
            </div>
          </div>

          {/* Hero stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-3xl p-5 relative overflow-hidden col-span-2"
              style={{ background: 'linear-gradient(145deg, #11141c, #181c28)', border: '1px solid #252a3a' }}>
              <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-15 pointer-events-none"
                style={{ background: 'radial-gradient(circle, #2ecc8a, transparent)' }} />
              <p className="label mb-1">Spendable Balance</p>
              <p className="font-mono font-bold text-text" style={{ fontSize: '2.2rem', letterSpacing: '-1px' }}>
                ${fmt(spendable)}
              </p>
              <div className="flex gap-4 mt-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#5b8fff' }}>Total Accounts</p>
                  <p className="font-mono font-semibold text-sm text-text">${fmt(totalAssets)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: '#7880a0' }}>Accounts</p>
                  <p className="font-mono font-semibold text-sm text-text">{accounts.length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* No accounts empty state */}
          {accounts.length === 0 && (
            <div className="card py-12 text-center">
              <p className="text-3xl mb-3">🏦</p>
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
                    const meta = TYPE_META[account.type] ?? { icon: '💰', label: account.type };
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
                      ? (balanceChange <= 0 ? '#2ecc8a' : '#ff5f6d')
                      : (balanceChange >= 0 ? '#2ecc8a' : '#ff5f6d');

                    return (
                      <div key={account.id} className="card card-hover p-4 group transition-all">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0"
                              style={{ backgroundColor: '#181c28', border: '1px solid #252a3a' }}>
                              {meta.icon}
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
                                style={{ color: Number(account.balance) < 0 ? '#ff5f6d' : '#e8eaf2' }}>
                                {Number(account.balance) < 0 ? '-' : ''}${fmt(Number(account.balance))}
                              </p>
                              {sparkData.length >= 2 && balanceChange !== 0 && (
                                <p className="text-[10px] font-mono"
                                  style={{ color: isCreditCard ? (balanceChange <= 0 ? '#2ecc8a' : '#ff5f6d') : (balanceChange >= 0 ? '#2ecc8a' : '#ff5f6d') }}>
                                  {balanceChange >= 0 ? '+' : ''}{fmt(balanceChange)} <span className="text-muted">6mo</span>
                                </p>
                              )}
                            </div>
                            {/* Action buttons */}
                            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setEditAccount(account)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
                                style={{ backgroundColor: 'rgba(91,143,255,.1)', color: '#5b8fff' }}
                                title="Edit">
                                ✎
                              </button>
                              <button
                                onClick={() => handleDelete(account.id, account.name)}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
                                style={{ backgroundColor: 'rgba(255,95,109,.1)', color: '#ff5f6d' }}
                                title="Delete">
                                ✕
                              </button>
                            </div>
                          </div>
                        </div>

                        {isCreditCard && limit > 0 && (
                          <div className="mt-3 pt-3" style={{ borderTop: '1px solid #252a3a' }}>
                            <div className="flex justify-between text-xs text-muted mb-2">
                              <span>Used ${fmt(owed)} of ${fmt(limit)}</span>
                              <span style={{ color: available > 0 ? '#2ecc8a' : '#ff5f6d' }}>
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
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #5b8fff, #a78bfa)', boxShadow: '0 8px 32px rgba(91,143,255,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAccountModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      <EditAccountModal isOpen={!!editAccount} onClose={() => setEditAccount(null)} onSuccess={load} account={editAccount} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={load} />
    </>
  );
};

export default Wallet;
