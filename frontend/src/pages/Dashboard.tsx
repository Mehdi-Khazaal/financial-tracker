import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Account, Transaction, SavingsGoal } from '../types';
import { getAccounts, getTransactions, getSavingsGoals, cleanDescription } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import AddTransactionModal from '../components/modals/AddTransactionModal';
import TransferModal from '../components/modals/TransferModal';
import AddAccountModal from '../components/modals/AddAccountModal';
import WithdrawModal from '../components/modals/WithdrawModal';
import DepositModal from '../components/modals/DepositModal';
import ProgressBar from '../components/ProgressBar';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ACCOUNT_ICON_COLORS: Record<string, string> = {
  checking:    'var(--accent)',
  savings:     'var(--pos)',
  credit_card: 'var(--neg)',
  investment:  '#a855f7',
  cash:        '#f59e0b',
};

const AccountIcon: React.FC<{ type: string }> = ({ type }) => {
  const color = ACCOUNT_ICON_COLORS[type] ?? 'var(--accent)';
  const initials = type.replace('_', ' ').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0 font-mono text-[10px] font-bold"
      style={{ backgroundColor: 'var(--elev-sub)', color }}>
      {initials}
    </div>
  );
};

const DashboardSkeleton: React.FC = () => (
  <div className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
    <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2"><div className="skeleton h-3 w-24" /><div className="skeleton h-6 w-40" /></div>
        <div className="skeleton h-7 w-24 rounded-full" />
      </div>
      <div className="skeleton h-36 w-full" />
      <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <div key={i} className="skeleton h-16" />)}</div>
      <div className="grid grid-cols-3 gap-2">{[0,1,2].map(i => <div key={i} className="skeleton h-14" />)}</div>
      <div className="space-y-3">
        <div className="skeleton h-3 w-20" />
        <div className="grid grid-cols-2 gap-3">{[0,1,2,3].map(i => <div key={i} className="skeleton h-24" />)}</div>
      </div>
    </div>
  </div>
);

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts]           = useState<Account[]>([]);
  const [transactions, setTransactions]   = useState<Transaction[]>([]);
  const [savingsGoals, setSavingsGoals]   = useState<SavingsGoal[]>([]);
  const [loading, setLoading]             = useState(true);
  const [showTx, setShowTx]               = useState(false);
  const [txType, setTxType]               = useState<'income' | 'expense'>('expense');
  const [showTransfer, setShowTransfer]   = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showWithdraw, setShowWithdraw]   = useState(false);
  const [showDeposit, setShowDeposit]     = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [aRes, tRes, gRes] = await Promise.all([getAccounts(), getTransactions(), getSavingsGoals()]);
      setAccounts(Array.isArray(aRes.data) ? aRes.data : []);
      setTransactions(Array.isArray(tRes.data) ? tRes.data : []);
      setSavingsGoals(Array.isArray(gRes.data) ? gRes.data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  // ── Derived ──────────────────────────────────────────────────────
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const nonCCAccounts  = accounts.filter(a => a.type !== 'credit_card');
  const ccAccounts     = accounts.filter(a => a.type === 'credit_card');
  const accountsTotal  = accounts.filter(a => a.type !== 'investment').reduce((s, a) => s + Number(a.balance), 0);
  const netWorth       = accountsTotal;
  const spendable      = nonCCAccounts
    .filter(a => a.type === 'checking' || a.type === 'cash')
    .reduce((s, a) => s + Number(a.balance), 0);

  const monthTx        = transactions.filter(t => t.transaction_date.startsWith(thisMonth));
  const monthIncome    = monthTx.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const monthExpenses  = monthTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const savingsRate    = monthIncome > 0 ? ((monthIncome - monthExpenses) / monthIncome) * 100 : 0;

  const lastMonthDate  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth      = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthTx    = transactions.filter(t => t.transaction_date.startsWith(lastMonth));
  const lastMonthExpenses = lastMonthTx.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const expenseDiff    = lastMonthExpenses > 0 ? monthExpenses - lastMonthExpenses : null;

  const activeGoals    = savingsGoals.slice(0, 3).map(g => {
    const current  = Number(g.current_amount);
    const progress = Math.min((current / Number(g.target_amount)) * 100, 100);
    return { ...g, current, progress };
  });

  const recent = transactions.slice(0, 8);

  if (loading) {
    return (
      <>
        <Navigation />
        <DashboardSkeleton />
      </>
    );
  }

  const monthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* ── Greeting ── */}
          <div className="flex items-center justify-between">
            <div>
              <p className="label mb-1">{monthLabel}</p>
              <h1 className="font-serif text-xl font-medium mt-0.5" style={{ color: 'var(--fg)', letterSpacing: '-0.02em' }}>
                Hey, {user?.username}
              </h1>
            </div>
            <button onClick={() => setShowAddAccount(true)}
              className="text-xs font-medium px-3 py-1.5 rounded-md transition-all"
              style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', color: 'var(--muted)' }}
              onMouseEnter={e => { (e.currentTarget.style.color = 'var(--fg)'); (e.currentTarget.style.borderColor = 'var(--line-strong)'); }}
              onMouseLeave={e => { (e.currentTarget.style.color = 'var(--muted)'); (e.currentTarget.style.borderColor = 'var(--line)'); }}>
              + Account
            </button>
          </div>

          {/* ── Net Worth Hero ── */}
          <div className="rounded-lg p-6" style={{ backgroundColor: 'var(--elev-1)' }}>
            <p className="label mb-3">Net Worth</p>
            <p className="font-mono font-medium tabular-nums" style={{ fontSize: '2.5rem', letterSpacing: '-0.03em', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
              ${fmt(netWorth)}
            </p>
            <div className="flex gap-6 mt-5 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
              <div>
                <p className="label mb-1">Accounts</p>
                <p className="font-mono tabular-nums text-sm font-medium" style={{ color: 'var(--fg)' }}>${fmt(accountsTotal)}</p>
              </div>
              <div>
                <p className="label mb-1">Spendable</p>
                <p className="font-mono tabular-nums text-sm font-medium" style={{ color: 'var(--pos)' }}>${fmt(spendable)}</p>
              </div>
            </div>
          </div>

          {/* ── Month stats ── */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Income',   value: `+$${fmt(monthIncome)}`,           color: 'var(--pos)' },
              { label: 'Expenses', value: `-$${fmt(monthExpenses)}`,          color: 'var(--neg)' },
              { label: 'Saved',    value: `${savingsRate.toFixed(0)}%`,       color: savingsRate >= 0 ? 'var(--pos)' : 'var(--neg)' },
            ].map(s => (
              <div key={s.label} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                <p className="label mb-2">{s.label}</p>
                <p className="font-mono tabular-nums text-sm font-medium" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* ── Month-over-month ── */}
          {expenseDiff !== null && (
            <div className="rounded-md px-4 py-3 flex items-center gap-3"
              style={{
                backgroundColor: expenseDiff > 0 ? 'oklch(70% 0.17 25 / 0.06)' : 'oklch(78% 0.16 150 / 0.06)',
                border: `1px solid ${expenseDiff > 0 ? 'oklch(70% 0.17 25 / 0.15)' : 'oklch(78% 0.16 150 / 0.15)'}`,
              }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0"
                style={{ color: expenseDiff > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                {expenseDiff > 0
                  ? <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  : <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                }
              </svg>
              <p className="text-xs">
                <span className="font-semibold" style={{ color: expenseDiff > 0 ? 'var(--neg)' : 'var(--pos)' }}>
                  {expenseDiff > 0 ? '+' : '−'}${fmt(Math.abs(expenseDiff))} spending
                </span>
                <span style={{ color: 'var(--muted)' }}> vs last month</span>
              </p>
            </div>
          )}

          {/* ── Quick Actions ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: 'Expense',  action: () => { setTxType('expense'); setShowTx(true); },
                icon: <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" /> },
              { label: 'Income',   action: () => { setTxType('income'); setShowTx(true); },
                icon: <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" /> },
              { label: 'Transfer', action: () => setShowTransfer(true),
                icon: <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" /> },
              { label: 'Withdraw', action: () => setShowWithdraw(true),
                icon: <path d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" /> },
              { label: 'Deposit',  action: () => setShowDeposit(true), wide: true,
                icon: <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /> },
            ].map(({ label, action, icon, wide }) => (
              <button key={label} onClick={action}
                className={`flex items-center justify-center gap-2 py-3 rounded-md text-sm font-medium transition-all active:scale-95 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}
                style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px solid var(--line)' }}
                onMouseEnter={e => { (e.currentTarget.style.color = 'var(--fg)'); (e.currentTarget.style.borderColor = 'var(--line-strong)'); }}
                onMouseLeave={e => { (e.currentTarget.style.color = 'var(--muted)'); (e.currentTarget.style.borderColor = 'var(--line)'); }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">{icon}</svg>
                {label}
              </button>
            ))}
          </div>

          {/* ── Accounts preview ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Accounts</p>
              <Link to="/wallet" className="text-xs font-medium transition-colors" style={{ color: 'var(--accent)' }}>View all →</Link>
            </div>
            {accounts.length === 0 ? (
              <button onClick={() => setShowAddAccount(true)}
                className="w-full rounded-lg py-8 text-center text-sm transition-all"
                style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)', border: '1px dashed var(--line)' }}>
                + Add your first account
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {accounts.slice(0, 4).map(a => (
                  <div key={a.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <AccountIcon type={a.type} />
                      <p className="label">{a.type.replace('_', ' ')}</p>
                    </div>
                    <p className="text-xs truncate mb-1" style={{ color: 'var(--muted)' }}>{a.name}</p>
                    <p className="font-mono tabular-nums text-lg font-medium" style={{ color: Number(a.balance) < 0 ? 'var(--neg)' : 'var(--fg)' }}>
                      {Number(a.balance) < 0 ? '−' : ''}${fmt(Number(a.balance))}
                    </p>
                    {a.type === 'credit_card' && a.credit_limit && (
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--dim)' }}>
                        Limit ${fmt(Number(a.credit_limit))}
                      </p>
                    )}
                  </div>
                ))}
                {accounts.length > 4 && (
                  <Link to="/wallet" className="rounded-lg p-4 flex items-center justify-center text-sm transition-colors"
                    style={{ backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}>
                    +{accounts.length - 4} more
                  </Link>
                )}
              </div>
            )}
          </div>

          {/* ── Credit cards preview ── */}
          {ccAccounts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="label">Credit Cards</p>
                <Link to="/cards" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Manage →</Link>
              </div>
              <div className="space-y-3">
                {ccAccounts.slice(0, 2).map(card => {
                  const owed  = Math.abs(Number(card.balance));
                  const limit = Number(card.credit_limit) || 0;
                  const used  = limit > 0 ? (owed / limit) * 100 : 0;
                  return (
                    <div key={card.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{card.name}</p>
                          {limit > 0 && <p className="label mt-0.5">Limit ${fmt(limit)}</p>}
                        </div>
                        <p className="font-mono tabular-nums text-lg font-medium" style={{ color: 'var(--neg)' }}>${fmt(owed)}</p>
                      </div>
                      {limit > 0 && (
                        <div className="w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--elev-sub)' }}>
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.min(used, 100)}%`, backgroundColor: used > 70 ? 'var(--neg)' : used > 30 ? '#f59e0b' : 'var(--pos)' }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Savings Goals ── */}
          {activeGoals.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="label">Savings Goals</p>
                <Link to="/savings" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all →</Link>
              </div>
              <div className="space-y-2">
                {activeGoals.map(goal => (
                  <div key={goal.id} className="rounded-lg p-4" style={{ backgroundColor: 'var(--elev-1)' }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium" style={{ color: 'var(--fg)' }}>{goal.name}</p>
                      <div className="flex items-center gap-2">
                        <p className="font-mono tabular-nums text-xs" style={{ color: 'var(--muted)' }}>
                          ${fmt(goal.current)}<span style={{ color: 'var(--dim)' }}> / ${fmt(Number(goal.target_amount))}</span>
                        </p>
                        <p className="font-mono tabular-nums text-xs font-bold" style={{ color: goal.progress >= 100 ? 'var(--pos)' : 'var(--accent)' }}>
                          {goal.progress.toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <ProgressBar value={goal.progress} colorAuto height={4} showLabel={false} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Recent Transactions ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="label">Recent</p>
              <Link to="/transactions" className="text-xs font-medium" style={{ color: 'var(--accent)' }}>View all →</Link>
            </div>
            {recent.length === 0 ? (
              <div className="rounded-lg py-10 text-center" style={{ backgroundColor: 'var(--elev-1)' }}>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>No transactions yet</p>
                <button onClick={() => { setTxType('expense'); setShowTx(true); }}
                  className="mt-3 text-xs font-medium" style={{ color: 'var(--accent)' }}>
                  Add one →
                </button>
              </div>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--elev-1)' }}>
                {recent.map((tx, i) => {
                  const pos  = Number(tx.amount) >= 0;
                  const desc = cleanDescription(tx.description);
                  const initials = desc.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() || '??';
                  return (
                    <div key={tx.id}
                      className="flex items-center gap-3 px-4 py-3"
                      style={{ borderBottom: i !== recent.length - 1 ? '1px solid var(--line)' : 'none' }}>
                      <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 font-mono text-[10px] font-bold"
                        style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>
                        {initials.slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{desc}</p>
                        <p className="text-xs" style={{ color: 'var(--muted)' }}>{tx.transaction_date}</p>
                      </div>
                      <p className="font-mono tabular-nums text-sm shrink-0 font-medium" style={{ color: pos ? 'var(--pos)' : 'var(--neg)' }}>
                        {pos ? '+' : '−'}${fmt(Math.abs(Number(tx.amount)))}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </main>

      <AddTransactionModal isOpen={showTx} onClose={() => setShowTx(false)} onSuccess={loadAll} defaultType={txType} />
      <TransferModal isOpen={showTransfer} onClose={() => setShowTransfer(false)} onSuccess={loadAll} />
      <AddAccountModal isOpen={showAddAccount} onClose={() => setShowAddAccount(false)} onSuccess={loadAll} />
      <WithdrawModal isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} onSuccess={loadAll} />
      <DepositModal isOpen={showDeposit} onClose={() => setShowDeposit(false)} onSuccess={loadAll} />
    </>
  );
};

export default Dashboard;
