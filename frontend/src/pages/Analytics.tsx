import React, { useEffect, useState } from 'react';
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { getTransactions, getAccounts, getCategories, getAssets, getNetWorthHistory } from '../utils/api';
import { Transaction, Account, Category, Asset, MonthSnapshot } from '../types';
import Navigation from '../components/Navigation';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PERIODS = ['This month', 'Last 3 months', 'Last 6 months', 'All time'] as const;
type Period = typeof PERIODS[number];

const Analytics: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [netWorthSnapshots, setNetWorthSnapshots] = useState<MonthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('This month');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [txRes, accRes, catRes, asRes, nwRes] = await Promise.all([
        getTransactions(), getAccounts(), getCategories(), getAssets(), getNetWorthHistory(12),
      ]);
      setTransactions(txRes.data);
      setAccounts(accRes.data);
      setCategories(catRes.data);
      setAssets(asRes.data);
      setNetWorthSnapshots(nwRes.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const filterByPeriod = (txs: Transaction[]) => {
    const now = new Date();
    let from: Date;
    if (period === 'This month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'Last 3 months') {
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    } else if (period === 'Last 6 months') {
      from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    } else {
      return txs;
    }
    return txs.filter(t => new Date(t.transaction_date) >= from);
  };

  const filtered = filterByPeriod(transactions);

  const totalIncome   = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const net           = totalIncome - totalExpenses;
  const savingsRate   = totalIncome > 0 ? (net / totalIncome) * 100 : 0;
  const netWorth      = accounts.reduce((s, a) => s + Number(a.balance), 0) + assets.reduce((s, a) => s + Number(a.total_value), 0);

  const spendingByCategory = categories
    .filter(c => c.type === 'expense')
    .map(c => ({
      name: c.name,
      value: filtered.filter(t => t.category_id === c.id && Number(t.amount) < 0)
        .reduce((s, t) => s + Math.abs(Number(t.amount)), 0),
      color: c.color,
    }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const monthlyData = (() => {
    const months: Record<string, { income: number; expenses: number }> = {};
    filtered.forEach(t => {
      const m = t.transaction_date.substring(0, 7);
      if (!months[m]) months[m] = { income: 0, expenses: 0 };
      if (Number(t.amount) > 0) months[m].income += Number(t.amount);
      else months[m].expenses += Math.abs(Number(t.amount));
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short' }),
        Income: data.income,
        Expenses: data.expenses,
      }));
  })();

  const netWorthTrend = netWorthSnapshots
    .slice(-12)
    .map(snap => ({
      month: new Date(snap.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      Value: snap.net_worth ?? 0,
    }));

  const nwChange = netWorthTrend.length >= 2
    ? netWorthTrend[netWorthTrend.length - 1].Value - netWorthTrend[0].Value
    : 0;

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: '#121620',
      border: '1px solid #1a1f2e',
      borderRadius: 12,
      fontSize: 12,
      color: '#eef0f8',
    },
    cursor: { fill: 'rgba(99,102,241,.05)' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#070810' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: '#6366f1', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#070810' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text">Analytics</h1>
          </div>

          {/* Period selector */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className="pill shrink-0 transition-all"
                style={period === p
                  ? { backgroundColor: 'rgba(99,102,241,.15)', color: '#6366f1', border: '1px solid rgba(99,102,241,.3)' }
                  : { backgroundColor: '#0d1018', color: '#666e90' }}>
                {p}
              </button>
            ))}
          </div>

          {/* Net Worth Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ background: 'linear-gradient(145deg, #0d1018, #121620)', border: '1px solid #1a1f2e' }}>
            <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-15 pointer-events-none"
              style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
            <p className="label mb-1">Net Worth</p>
            <p className="font-mono font-bold text-text mb-4" style={{ fontSize: '2.5rem', letterSpacing: '-1px' }}>
              ${fmt(netWorth)}
            </p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Income', value: `+$${fmt(totalIncome)}`, color: '#10b981', glow: 'rgba(16,185,129,.1)' },
              { label: 'Expenses', value: `-$${fmt(totalExpenses)}`, color: '#f43f5e', glow: 'rgba(244,63,94,.1)' },
              { label: 'Net', value: `${net >= 0 ? '+' : '-'}$${fmt(Math.abs(net))}`, color: net >= 0 ? '#10b981' : '#f43f5e', glow: 'rgba(99,102,241,.1)' },
              { label: 'Savings Rate', value: `${savingsRate.toFixed(1)}%`, color: savingsRate >= 20 ? '#10b981' : savingsRate >= 0 ? '#f59e0b' : '#f43f5e', glow: 'rgba(245,158,11,.1)' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4"
                style={{ backgroundColor: '#0d1018', border: '1px solid #1a1f2e', boxShadow: `0 0 20px ${s.glow}` }}>
                <p className="label mb-1.5">{s.label}</p>
                <p className="font-mono font-bold text-sm" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Monthly bar chart */}
          <div className="card p-5">
            <p className="font-semibold text-text mb-4 text-sm">Income vs Expenses</p>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1f2e" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#666e90' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => `$${fmt(Number(v))}`} />
                  <Bar dataKey="Income"   fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted text-sm text-center py-8">No data for this period</p>
            )}
            <div className="flex gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10b981' }} />
                <span className="text-[11px] text-muted">Income</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f43f5e' }} />
                <span className="text-[11px] text-muted">Expenses</span>
              </div>
            </div>
          </div>

          {/* Net worth history */}
          {netWorthTrend.length > 1 && (
            <div className="card p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-semibold text-text text-sm">Net Worth Over Time</p>
                  <p className="text-xs text-muted mt-0.5">12-month history</p>
                </div>
                {nwChange !== 0 && (
                  <div className="text-right">
                    <p className="text-xs text-muted">Change</p>
                    <p className="font-mono font-bold text-sm" style={{ color: nwChange >= 0 ? '#10b981' : '#f43f5e' }}>
                      {nwChange >= 0 ? '+' : '-'}${fmt(Math.abs(nwChange))}
                    </p>
                  </div>
                )}
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={netWorthTrend}>
                  <defs>
                    <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#666e90' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => [`$${fmt(Number(v))}`, 'Net Worth']} />
                  <Line
                    type="monotone" dataKey="Value" stroke="#6366f1" strokeWidth={2.5}
                    dot={false} activeDot={{ r: 5, fill: '#6366f1', stroke: '#070810', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Spending by category */}
          <div className="card p-5">
            <p className="font-semibold text-text mb-4 text-sm">Spending by Category</p>
            {spendingByCategory.length > 0 ? (
              <>
                <div className="flex flex-col sm:flex-row gap-4 items-center">
                  <ResponsiveContainer width={160} height={160}>
                    <PieChart>
                      <Pie data={spendingByCategory} cx="50%" cy="50%" innerRadius={45} outerRadius={70}
                        dataKey="value" paddingAngle={3}>
                        {spendingByCategory.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#121620', border: '1px solid #1a1f2e', borderRadius: 12, fontSize: 12, color: '#eef0f8' }}
                        formatter={(v: any) => `$${fmt(Number(v))}`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2 w-full">
                    {spendingByCategory.slice(0, 6).map((cat, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <p className="text-xs text-text flex-1 truncate">{cat.name}</p>
                        <div className="text-right shrink-0">
                          <p className="font-mono text-xs font-semibold text-text">${fmt(cat.value)}</p>
                          <p className="text-[10px] text-muted">
                            {totalExpenses > 0 ? ((cat.value / totalExpenses) * 100).toFixed(0) : 0}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted text-sm text-center py-8">No expense data for this period</p>
            )}
          </div>

          {/* Transactions count */}
          <div className="card p-4 flex items-center justify-between">
            <p className="text-sm text-muted">Transactions this period</p>
            <p className="font-mono font-bold text-text">{filtered.length}</p>
          </div>

        </div>
      </main>
    </>
  );
};

export default Analytics;
