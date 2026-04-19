import React, { useEffect, useState, useCallback } from 'react';
import { Account, SavingsGoal } from '../types';
import { getAccounts, getSavingsGoals, deleteSavingsGoal } from '../utils/api';
import Navigation from '../components/Navigation';
import AddSavingsGoalModal from '../components/modals/AddSavingsGoalModal';
import ManageAllocationsModal from '../components/modals/ManageAllocationsModal';
import SpendFromGoalModal from '../components/modals/SpendFromGoalModal';
import ProgressBar from '../components/ProgressBar';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TYPE_COLORS: Record<string, string> = {
  checking: 'var(--accent)', savings: 'var(--pos)', cash: '#f59e0b',
  investment: '#a855f7', credit_card: 'var(--neg)',
};

const Savings: React.FC = () => {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [editGoal, setEditGoal] = useState<SavingsGoal | null>(null);
  const [spendGoal, setSpendGoal] = useState<SavingsGoal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, gRes] = await Promise.all([getAccounts(), getSavingsGoals()]);
      setAccounts(Array.isArray(aRes.data) ? aRes.data : []);
      setGoals(Array.isArray(gRes.data) ? gRes.data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  const handleDeleteGoal = async (id: number, name: string) => {
    const ok = await toast.confirm(`Delete goal "${name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteSavingsGoal(id); load(); toast.success('Goal deleted'); }
    catch { toast.error('Failed to delete goal'); }
  };

  // Total allocated per account across all goals
  const allocatedPerAccount: Record<number, number> = {};
  goals.forEach(g => {
    g.allocations.forEach(a => {
      allocatedPerAccount[a.account_id] = (allocatedPerAccount[a.account_id] ?? 0) + Number(a.amount);
    });
  });

  // Available (unallocated) balance per account
  const availablePerAccount = accounts.reduce<Record<number, number>>((acc, a) => {
    acc[a.id] = Math.max(0, Number(a.balance) - (allocatedPerAccount[a.id] ?? 0));
    return acc;
  }, {});

  const totalBalance = accounts
    .filter(a => a.type !== 'credit_card')
    .reduce((s, a) => s + Number(a.balance), 0);
  const totalAllocated = Object.values(allocatedPerAccount).reduce((s, v) => s + v, 0);
  const totalUnallocated = Math.max(0, totalBalance - totalAllocated);
  const totalGoalTarget = goals.reduce((s, g) => s + Number(g.target_amount), 0);

  const getDaysLeft = (deadline: string | null) => {
    if (!deadline) return null;
    return Math.ceil((new Date(deadline + 'T00:00:00').getTime() - Date.now()) / 86400000);
  };

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-24 rounded-xl" />
            <div className="skeleton h-36 w-full rounded-3xl" />
            {[0, 1].map(i => <div key={i} className="skeleton h-40 rounded-2xl" />)}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <PullToRefresh pulling={pulling} refreshing={refreshing} pullDistance={pullDistance} />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Savings</h1>
            <button onClick={() => setShowAddGoal(true)}
              className="hidden md:block text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: 'var(--muted)' }}>
              + Goal
            </button>
          </div>

          {/* Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
            <p className="label mb-1">Total Balance</p>
            <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
              ${fmt(totalBalance)}
            </p>
            <div className="flex gap-6 flex-wrap">
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Allocated</p>
                <p className="font-mono text-sm font-semibold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>${fmt(totalAllocated)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Unallocated</p>
                <p className="font-mono text-sm font-semibold" style={{ color: 'var(--pos)', fontVariantNumeric: 'tabular-nums' }}>${fmt(totalUnallocated)}</p>
              </div>
              {goals.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Goals Target</p>
                  <p className="font-mono text-sm font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(totalGoalTarget)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Account overview */}
          {accounts.filter(a => a.type !== 'credit_card').length > 0 && (
            <div>
              <p className="label mb-3">Accounts</p>
              <div className="space-y-2">
                {accounts.filter(a => a.type !== 'credit_card').map(account => {
                  const allocated = allocatedPerAccount[account.id] ?? 0;
                  const available = availablePerAccount[account.id];
                  const allocPct = Number(account.balance) > 0 ? (allocated / Number(account.balance)) * 100 : 0;
                  const color = TYPE_COLORS[account.type] ?? 'var(--accent)';
                  return (
                    <div key={account.id} className="card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <p className="font-semibold text-sm text-text">{account.name}</p>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full capitalize"
                            style={{ backgroundColor: 'var(--elev-sub)', color }}>
                            {account.type.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="font-mono font-bold text-sm text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(Number(account.balance))}</p>
                      </div>
                      {allocated > 0 && (
                        <>
                          <div className="w-full h-1.5 rounded-full overflow-hidden mb-1" style={{ backgroundColor: 'var(--line)' }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.min(allocPct, 100)}%`, backgroundColor: color }} />
                          </div>
                          <div className="flex justify-between text-xs text-muted">
                            <span>${fmt(allocated)} allocated</span>
                            <span style={{ color: available > 0 ? 'var(--pos)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>${fmt(available)} free</span>
                          </div>
                        </>
                      )}
                      {allocated === 0 && (
                        <p className="text-xs text-muted">Fully unallocated</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Goals */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Goals</p>
              <button onClick={() => setShowAddGoal(true)}
                className="text-xs font-semibold transition-colors" style={{ color: 'var(--accent)' }}>
                + New Goal
              </button>
            </div>

            {goals.length === 0 ? (
              <div className="card py-12 text-center">
                <p className="text-3xl mb-3">🎯</p>
                <p className="font-semibold text-text mb-1">No savings goals</p>
                <p className="text-sm text-muted mb-5">Set a target and allocate money from your accounts</p>
                <button onClick={() => setShowAddGoal(true)} className="btn-gradient px-6 py-2.5 text-sm">
                  Create First Goal
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {goals.map(goal => {
                  const current = Number(goal.current_amount);
                  const target  = Number(goal.target_amount);
                  const progress = Math.min((current / target) * 100, 100);
                  const remaining = Math.max(target - current, 0);
                  const isComplete = progress >= 100;
                  const daysLeft = getDaysLeft(goal.deadline ?? null);

                  return (
                    <div key={goal.id} className="card p-4 group">
                      {/* Goal header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm text-text">{goal.name}</p>
                            {isComplete && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' }}>
                                Complete ✓
                              </span>
                            )}
                          </div>
                          {daysLeft !== null && (
                            <p className="text-xs mt-0.5" style={{ color: daysLeft < 30 ? 'var(--neg)' : 'var(--muted)' }}>
                              {daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? 'Due today' : 'Overdue'}
                              {goal.deadline && ` · ${new Date(goal.deadline + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {goal.allocations.length > 0 && (
                            <button
                              onClick={() => setSpendGoal(goal)}
                              className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-all"
                              style={{ backgroundColor: 'oklch(70% 0.17 25 / 0.1)', color: 'var(--neg)' }}>
                              Spend
                            </button>
                          )}
                          <button
                            onClick={() => setEditGoal(goal)}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg transition-all"
                            style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.1)', color: 'var(--accent)' }}>
                            Allocate
                          </button>
                          <button onClick={() => handleDeleteGoal(goal.id, goal.name)}
                            className="opacity-0 group-hover:opacity-100 transition-all"
                            style={{ color: 'var(--dim)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--neg)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                          </button>
                        </div>
                      </div>

                      {/* Progress */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(current)} allocated</span>
                          <span className="font-mono font-semibold" style={{ color: isComplete ? 'var(--pos)' : 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                            ${fmt(target)} goal
                          </span>
                        </div>
                        <ProgressBar value={progress} colorAuto height={6} showLabel={false} />
                      </div>

                      {/* Allocation breakdown */}
                      {goal.allocations.length > 0 ? (
                        <div className="pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                          <p className="text-[10px] uppercase tracking-widest text-muted mb-2">Sources</p>
                          <div className="flex flex-wrap gap-2">
                            {goal.allocations.map(a => {
                              const acc = accounts.find(ac => ac.id === a.account_id);
                              const color = acc ? (TYPE_COLORS[acc.type] ?? 'var(--accent)') : 'var(--accent)';
                              return (
                                <span key={a.id} className="text-xs px-2.5 py-1 rounded-full font-mono"
                                  style={{ backgroundColor: 'var(--elev-sub)', color, fontVariantNumeric: 'tabular-nums' }}>
                                  {a.account_name} · ${fmt(Number(a.amount))}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                          <button onClick={() => setEditGoal(goal)}
                            className="text-xs text-muted hover:text-accent transition-colors"
                            style={{ color: 'var(--dim)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--dim)')}>
                            + Allocate money from your accounts
                          </button>
                        </div>
                      )}

                      <div className="flex justify-between items-center mt-3">
                        <p className="text-xs text-muted">
                          {isComplete ? '🎉 Goal reached!' : `$${fmt(remaining)} remaining`}
                        </p>
                        <p className="font-mono text-sm font-bold" style={{ color: isComplete ? 'var(--pos)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                          {progress.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Empty overall state */}
          {accounts.filter(a => a.type !== 'credit_card').length === 0 && goals.length === 0 && (
            <div className="card py-12 text-center">
              <p className="text-3xl mb-3">💰</p>
              <p className="font-semibold text-text mb-1">No accounts yet</p>
              <p className="text-sm text-muted">Add accounts in Wallet to get started</p>
            </div>
          )}
        </div>
      </main>

      {/* FAB */}
      <button onClick={() => setShowAddGoal(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', backgroundColor: 'var(--accent)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddSavingsGoalModal isOpen={showAddGoal} onClose={() => setShowAddGoal(false)} onSuccess={load} />
      <SpendFromGoalModal
        isOpen={!!spendGoal}
        onClose={() => setSpendGoal(null)}
        onSuccess={load}
        goal={spendGoal}
      />
      <ManageAllocationsModal
        isOpen={!!editGoal}
        onClose={() => setEditGoal(null)}
        onSuccess={load}
        goal={editGoal}
        allGoals={goals}
        accounts={accounts}
      />
    </>
  );
};

export default Savings;
