import React, { useEffect, useState } from 'react';
import {
  PieChart, Pie, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { getTransactions, getAccounts, getCategories, getNetWorthHistory } from '../utils/api';
import { Transaction, Account, Category, MonthSnapshot } from '../types';
import Navigation from '../components/Navigation';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PERIODS = ['This month', 'Last 3 months', 'Last 6 months', 'All time'] as const;
type Period = typeof PERIODS[number];

const pct = (curr: number, prev: number) => {
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
};
const fmtPct = (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;

const Analytics: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [netWorthSnapshots, setNetWorthSnapshots] = useState<MonthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('This month');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [txRes, accRes, catRes, nwRes] = await Promise.all([
        getTransactions(), getAccounts(), getCategories(), getNetWorthHistory(12),
      ]);
      setTransactions(Array.isArray(txRes.data) ? txRes.data : []);
      setAccounts(Array.isArray(accRes.data) ? accRes.data : []);
      setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      setNetWorthSnapshots(Array.isArray(nwRes.data) ? nwRes.data : []);
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
    return txs.filter(t => new Date(t.transaction_date + 'T00:00:00') >= from);
  };

  const filtered = filterByPeriod(transactions);

  const totalIncome   = filtered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const totalExpenses = filtered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const net           = totalIncome - totalExpenses;
  const savingsRate   = totalIncome > 0 ? (net / totalIncome) * 100 : 0;
  const netWorth      = accounts.filter(a => a.type !== 'investment').reduce((s, a) => s + Number(a.balance), 0);

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
        month: new Date(month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' }),
        Income: data.income,
        Expenses: data.expenses,
      }));
  })();

  const netWorthTrend = netWorthSnapshots
    .slice(-12)
    .map(snap => ({
      month: new Date(snap.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      Value: snap.net_worth ?? 0,
    }));

  const nwChange = netWorthTrend.length >= 2
    ? netWorthTrend[netWorthTrend.length - 1].Value - netWorthTrend[0].Value
    : 0;

  // ── Year-over-Year ────────────────────────────────────────────────────────────
  const now = new Date();
  const thisMonthKey     = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastYearMonthKey = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const thisMonthTxs     = transactions.filter(t => t.transaction_date.startsWith(thisMonthKey));
  const lastYearMonthTxs = transactions.filter(t => t.transaction_date.startsWith(lastYearMonthKey));

  const yoyThisIncome    = thisMonthTxs.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const yoyLastIncome    = lastYearMonthTxs.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const yoyThisExpenses  = thisMonthTxs.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const yoyLastExpenses  = lastYearMonthTxs.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const incomeChange   = pct(yoyThisIncome, yoyLastIncome);
  const expensesChange = pct(yoyThisExpenses, yoyLastExpenses);

  const yoyMonthLabel = now.toLocaleDateString('en-US', { month: 'long' });

  const yoyBarData = [
    {
      name: String(now.getFullYear() - 1),
      Income: yoyLastIncome,
      Expenses: yoyLastExpenses,
    },
    {
      name: String(now.getFullYear()),
      Income: yoyThisIncome,
      Expenses: yoyThisExpenses,
    },
  ];

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: 'var(--elev-sub)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      fontSize: 12,
      color: 'var(--fg)',
    },
    cursor: { fill: 'oklch(72% 0.17 55 / 0.05)' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Analytics</h1>
          </div>

          {/* Period selector */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PERIODS.map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className="pill shrink-0 transition-all"
                style={period === p
                  ? { backgroundColor: 'oklch(72% 0.17 55 / 0.15)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.3)' }
                  : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                {p}
              </button>
            ))}
          </div>

          {/* Net Worth Hero */}
          <div className="rounded-3xl p-6 relative overflow-hidden"
            style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
            <p className="label mb-1">Net Worth</p>
            <p className="font-mono font-bold text-text mb-4" style={{ fontSize: '2.5rem', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
              ${fmt(netWorth)}
            </p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Income', value: `+$${fmt(totalIncome)}`, color: 'var(--pos)' },
              { label: 'Expenses', value: `-$${fmt(totalExpenses)}`, color: 'var(--neg)' },
              { label: 'Net', value: `${net >= 0 ? '+' : '-'}$${fmt(Math.abs(net))}`, color: net >= 0 ? 'var(--pos)' : 'var(--neg)' },
              { label: 'Savings Rate', value: `${savingsRate.toFixed(1)}%`, color: savingsRate >= 20 ? 'var(--pos)' : savingsRate >= 0 ? '#f59e0b' : 'var(--neg)' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4"
                style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                <p className="label mb-1.5">{s.label}</p>
                <p className="font-mono font-bold text-sm" style={{ color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Monthly bar chart */}
          <div className="card p-5">
            <p className="font-semibold text-text mb-4 text-sm">Income vs Expenses</p>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyData} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => `$${fmt(Number(v))}`} />
                  <Bar dataKey="Income"   fill="var(--pos)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="var(--neg)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-muted text-sm text-center py-8">No data for this period</p>
            )}
            <div className="flex gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--pos)' }} />
                <span className="text-[11px] text-muted">Income</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--neg)' }} />
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
                    <p className="font-mono font-bold text-sm" style={{ color: nwChange >= 0 ? 'var(--pos)' : 'var(--neg)', fontVariantNumeric: 'tabular-nums' }}>
                      {nwChange >= 0 ? '+' : '-'}${fmt(Math.abs(nwChange))}
                    </p>
                  </div>
                )}
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={netWorthTrend}>
                  <defs>
                    <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => [`$${fmt(Number(v))}`, 'Net Worth']} />
                  <Line
                    type="monotone" dataKey="Value" stroke="var(--accent)" strokeWidth={2.5}
                    dot={false} activeDot={{ r: 5, fill: 'var(--accent)', stroke: 'var(--bg)', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Year-over-Year */}
          {(yoyThisIncome > 0 || yoyThisExpenses > 0 || yoyLastIncome > 0 || yoyLastExpenses > 0) && (
            <div className="card p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="font-semibold text-text text-sm">Year over Year</p>
                  <p className="text-xs text-muted mt-0.5">{yoyMonthLabel} this year vs last year</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'Income', curr: yoyThisIncome, change: incomeChange, positive: true },
                  { label: 'Expenses', curr: yoyThisExpenses, change: expensesChange, positive: false },
                ].map(({ label, curr, change, positive }) => (
                  <div key={label} className="rounded-xl p-3" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--line)' }}>
                    <p className="label mb-1">{label}</p>
                    <p className="font-mono font-bold text-sm text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(curr)}</p>
                    {change !== null && (
                      <p className="text-xs font-semibold mt-1"
                        style={{ color: (positive ? change >= 0 : change <= 0) ? 'var(--pos)' : 'var(--neg)' }}>
                        {fmtPct(change)} vs last year
                      </p>
                    )}
                    {change === null && <p className="text-xs text-muted mt-1">No data last year</p>}
                  </div>
                ))}
              </div>

              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={yoyBarData} barCategoryGap="40%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => `$${fmt(Number(v))}`} />
                  <Bar dataKey="Income"   fill="var(--pos)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses" fill="var(--neg)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--pos)' }} />
                  <span className="text-[11px] text-muted">Income</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--neg)' }} />
                  <span className="text-[11px] text-muted">Expenses</span>
                </div>
              </div>
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
                        contentStyle={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', borderRadius: 12, fontSize: 12, color: 'var(--fg)' }}
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
                          <p className="font-mono text-xs font-semibold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(cat.value)}</p>
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
            <p className="font-mono font-bold text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>{filtered.length}</p>
          </div>

        </div>
      </main>
    </>
  );
};

export default Analytics;
