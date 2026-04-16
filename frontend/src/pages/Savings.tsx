import React, { useEffect, useState, useCallback } from 'react';
import { Account, SavingsGoal } from '../types';
import { getAccounts, getSavingsGoals, deleteSavingsGoal } from '../utils/api';
import Navigation from '../components/Navigation';
import AddSavingsGoalModal from '../components/modals/AddSavingsGoalModal';
import ProgressBar from '../components/ProgressBar';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Savings: React.FC = () => {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddGoal, setShowAddGoal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, gRes] = await Promise.all([getAccounts(), getSavingsGoals()]);
      setAccounts(aRes.data.filter((a: Account) => a.type === 'savings'));
      setGoals(gRes.data);
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

  const totalSavings = accounts.reduce((s, a) => s + Number(a.balance), 0);
  const totalGoalTarget = goals.reduce((s, g) => s + Number(g.target_amount), 0);

  const getDaysLeft = (deadline: string | null) => {
    if (!deadline) return null;
    const diff = new Date(deadline).getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    return days;
  };

  const getGoalProgress = (goal: SavingsGoal) => {
    if (!goal.account_id) return 0;
    const account = accounts.find(a => a.id === goal.account_id);
    if (!account) return 0;
    return Math.min((Number(account.balance) / Number(goal.target_amount)) * 100, 100);
  };

  const getGoalBalance = (goal: SavingsGoal) => {
    if (!goal.account_id) return 0;
    const account = accounts.find(a => a.id === goal.account_id);
    return account ? Number(account.balance) : 0;
  };

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen" style={{ backgroundColor: '#070810' }}>
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-24 rounded-xl" />
            <div className="skeleton h-36 w-full rounded-3xl" />
            {[0,1].map(i => <div key={i} className="skeleton h-32 rounded-2xl" />)}
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
            <h1 className="text-xl font-bold text-text">Savings</h1>
            <button onClick={() => setShowAddGoal(true)}
              className="hidden md:block text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#121620', border: '1px solid #1a1f2e', color: '#666e90' }}>
              + Goal
            </button>
          </div>

          {/* Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ background: 'linear-gradient(145deg, #0d1018, #121620)', border: '1px solid #1a1f2e' }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-15 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #10b981, transparent)' }} />
            <p className="label mb-1">Total Savings</p>
            <p className="font-mono font-bold text-text mb-3" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>
              ${fmt(totalSavings)}
            </p>
            <div className="flex gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Accounts</p>
                <p className="font-mono text-sm font-semibold text-text">{accounts.length}</p>
              </div>
              {goals.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-0.5 text-muted">Goals Target</p>
                  <p className="font-mono text-sm font-semibold text-text">${fmt(totalGoalTarget)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Savings accounts */}
          {accounts.length > 0 && (
            <div>
              <p className="label mb-3">Savings Accounts</p>
              <div className="space-y-2">
                {accounts.map(account => (
                  <div key={account.id} className="card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">💰</span>
                      <div>
                        <p className="font-semibold text-sm text-text">{account.name}</p>
                        <p className="text-xs text-muted">Savings Account</p>
                      </div>
                    </div>
                    <p className="font-mono font-bold text-lg" style={{ color: '#10b981' }}>
                      ${fmt(Number(account.balance))}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Savings goals */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Goals</p>
              <button onClick={() => setShowAddGoal(true)}
                className="text-xs font-semibold transition-colors" style={{ color: '#6366f1' }}>
                + New Goal
              </button>
            </div>

            {goals.length === 0 ? (
              <div className="card py-12 text-center">
                <p className="text-3xl mb-3">🎯</p>
                <p className="font-semibold text-text mb-1">No savings goals</p>
                <p className="text-sm text-muted mb-5">Set targets and track your progress</p>
                <button onClick={() => setShowAddGoal(true)} className="btn-gradient px-6 py-2.5 text-sm">
                  Create First Goal
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {goals.map(goal => {
                  const progress = getGoalProgress(goal);
                  const balance = getGoalBalance(goal);
                  const daysLeft = getDaysLeft(goal.deadline ?? null);
                  const remaining = Math.max(Number(goal.target_amount) - balance, 0);
                  const isComplete = progress >= 100;

                  return (
                    <div key={goal.id} className="card p-4 group">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-sm text-text">{goal.name}</p>
                            {isComplete && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                style={{ backgroundColor: 'rgba(16,185,129,.15)', color: '#10b981' }}>
                                Complete ✓
                              </span>
                            )}
                          </div>
                          {daysLeft !== null && (
                            <p className="text-xs mt-0.5" style={{ color: daysLeft < 30 ? '#f43f5e' : '#666e90' }}>
                              {daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? 'Due today' : 'Overdue'}
                              {goal.deadline && ` · ${new Date(goal.deadline + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                            </p>
                          )}
                        </div>
                        <button onClick={() => handleDeleteGoal(goal.id, goal.name)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] transition-all"
                          style={{ color: '#363d56' }}
                          onMouseEnter={e => (e.target as HTMLElement).style.color = '#f43f5e'}
                          onMouseLeave={e => (e.target as HTMLElement).style.color = '#363d56'}>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                        </button>
                      </div>

                      <div className="mb-3">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-muted">
                            ${fmt(balance)} saved
                          </span>
                          <span className="font-mono font-semibold" style={{ color: isComplete ? '#10b981' : '#eef0f8' }}>
                            ${fmt(Number(goal.target_amount))} goal
                          </span>
                        </div>
                        <ProgressBar value={progress} colorAuto height={6} showLabel={false} />
                      </div>

                      <div className="flex justify-between items-center">
                        <p className="text-xs text-muted">
                          {isComplete ? '🎉 Goal reached!' : `$${fmt(remaining)} remaining`}
                        </p>
                        <p className="font-mono text-sm font-bold" style={{ color: isComplete ? '#10b981' : '#6366f1' }}>
                          {progress.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Empty savings state */}
          {accounts.length === 0 && goals.length === 0 && (
            <div className="card py-12 text-center">
              <p className="text-3xl mb-3">💰</p>
              <p className="font-semibold text-text mb-1">No savings accounts</p>
              <p className="text-sm text-muted">Add a savings account in Wallet to get started</p>
            </div>
          )}
        </div>
      </main>

      {/* FAB */}
      <button onClick={() => setShowAddGoal(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #10b981, #6366f1)', boxShadow: '0 8px 32px rgba(16,185,129,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddSavingsGoalModal isOpen={showAddGoal} onClose={() => setShowAddGoal(false)} onSuccess={load} />
    </>
  );
};

export default Savings;
