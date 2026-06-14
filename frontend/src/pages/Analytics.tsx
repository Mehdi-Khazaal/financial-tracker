import React, { useEffect, useRef, useMemo, useState } from 'react';
import {
  PieChart, Pie, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { getTransactions, getAccounts, getCategories, getNetWorthHistory } from '../utils/api';
import { Transaction, Account, Category, MonthSnapshot } from '../types';
import Navigation from '../components/Navigation';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };

const PERIODS = ['This month', 'Last 3 months', 'Last 6 months', 'All time', 'Custom'] as const;
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
  const [customMonth, setCustomMonth] = useState<string>(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [pieHovered, setPieHovered] = useState<{ name: string; value: number; color: string } | null>(null);

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

  const availableMonths = useMemo(() => {
    const s = new Set(transactions.map(t => t.transaction_date.slice(0, 7)));
    return Array.from(s).sort().reverse();
  }, [transactions]);

  useEffect(() => {
    if (!showMonthPicker) return;
    const handler = (e: MouseEvent) => {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) setShowMonthPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMonthPicker]);

  const filterByPeriod = (txs: Transaction[]) => {
    const now = new Date();
    let from: Date;
    if (period === 'This month') {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'Last 3 months') {
      from = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    } else if (period === 'Last 6 months') {
      from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    } else if (period === 'Custom') {
      return txs.filter(t => t.transaction_date.startsWith(customMonth));
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

  // â”€â”€ Year-over-Year â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Spending Insights: previous-period comparison â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const prevFiltered = (() => {
    const now = new Date();
    if (period === 'This month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to   = new Date(now.getFullYear(), now.getMonth(), 1);
      return transactions.filter(t => { const d = new Date(t.transaction_date + 'T00:00:00'); return d >= from && d < to; });
    } else if (period === 'Last 3 months') {
      const currFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const prevFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      return transactions.filter(t => { const d = new Date(t.transaction_date + 'T00:00:00'); return d >= prevFrom && d < currFrom; });
    } else if (period === 'Last 6 months') {
      const currFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const prevFrom = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      return transactions.filter(t => { const d = new Date(t.transaction_date + 'T00:00:00'); return d >= prevFrom && d < currFrom; });
    } else if (period === 'Custom') {
      const [y, m] = customMonth.split('-').map(Number);
      const from = new Date(y, m - 2, 1);
      const to   = new Date(y, m - 1, 1);
      return transactions.filter(t => { const d = new Date(t.transaction_date + 'T00:00:00'); return d >= from && d < to; });
    }
    return [];
  })();

  const prevPeriodLabel = (() => {
    const now = new Date();
    if (period === 'This month')   return new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (period === 'Last 3 months') return 'previous 3 months';
    if (period === 'Last 6 months') return 'previous 6 months';
    if (period === 'Custom') {
      const [y, m] = customMonth.split('-').map(Number);
      return new Date(y, m - 2, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    return '';
  })();

  const getCatSpend = (txs: Transaction[]) => {
    const map: Record<number, number> = {};
    txs.filter(t => Number(t.amount) < 0).forEach(t => {
      if (t.category_id) map[t.category_id] = (map[t.category_id] ?? 0) + Math.abs(Number(t.amount));
    });
    return map;
  };
  const currCatMap = getCatSpend(filtered);
  const prevCatMap = getCatSpend(prevFiltered);

  const categoryInsights = categories
    .filter(c => c.type === 'expense')
    .map(c => ({
      id: c.id, name: c.name, color: c.color,
      curr: currCatMap[c.id] ?? 0,
      prev: prevCatMap[c.id] ?? 0,
      delta: (currCatMap[c.id] ?? 0) - (prevCatMap[c.id] ?? 0),
      pctChange: (prevCatMap[c.id] ?? 0) > 0
        ? (((currCatMap[c.id] ?? 0) - (prevCatMap[c.id] ?? 0)) / (prevCatMap[c.id] ?? 0)) * 100
        : null,
    }))
    .filter(c => c.curr > 0 || c.prev > 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const prevIncome    = prevFiltered.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const prevExpenses  = prevFiltered.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
  const prevNet       = prevIncome - prevExpenses;
  const prevSavRate   = prevIncome > 0 ? (prevNet / prevIncome) * 100 : null;
  const savRateChange = prevSavRate !== null ? savingsRate - prevSavRate : null;
  const topMover      = categoryInsights[0] ?? null;
  const hasInsights   = period !== 'All time' && (categoryInsights.length > 0 || prevFiltered.length > 0);

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
          <div className="topbar-safe flex items-center justify-between">
            <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Analytics</h1>
          </div>

          {/* Period selector */}
          <div className="space-y-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {PERIODS.map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className="pill shrink-0 transition-all"
                  style={period === p
                    ? { backgroundColor: 'oklch(72% 0.17 55 / 0.15)', color: 'var(--accent)', border: '1px solid oklch(72% 0.17 55 / 0.3)' }
                    : { backgroundColor: 'var(--elev-1)', color: 'var(--muted)' }}>
                  {p === 'Custom' && period === 'Custom'
                    ? new Date(customMonth + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                    : p}
                </button>
              ))}
            </div>
            {period === 'Custom' && (
              <div ref={monthPickerRef} className="relative inline-block">
                <button
                  onClick={() => setShowMonthPicker(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold transition-all"
                  style={{ backgroundColor: 'var(--elev-1)', color: 'var(--fg)', border: '1px solid var(--line)' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--line-strong)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}
                >
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M13.25 3v2.25M3 8.25h14M5.25 3.75h9.5A2.25 2.25 0 0117 6v10.5A2.25 2.25 0 0114.75 18.75H5.25A2.25 2.25 0 013 16.5V6A2.25 2.25 0 015.25 3.75z" />
                  </svg>
                  <span>{formatMonth(customMonth)}</span>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 shrink-0" style={{ color: 'var(--dim)', transform: showMonthPicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                {showMonthPicker && availableMonths.length > 0 && (
                  <div className="absolute top-full left-0 mt-1.5 rounded-xl overflow-hidden z-50"
                    style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', minWidth: 170, boxShadow: '0 8px 32px rgba(0,0,0,0.45)', paddingTop: 4, paddingBottom: 4 }}>
                    {availableMonths.map(m => (
                      <button key={m}
                        onClick={() => { setCustomMonth(m); setShowMonthPicker(false); }}
                        className="w-full text-left flex items-center justify-between px-4 py-2.5 text-sm font-medium transition-colors"
                        style={m === customMonth
                          ? { backgroundColor: 'oklch(72% 0.17 55 / 0.12)', color: 'var(--accent)' }
                          : { color: 'var(--fg)' }}
                        onMouseEnter={e => { if (m !== customMonth) e.currentTarget.style.backgroundColor = 'var(--elev-sub)'; }}
                        onMouseLeave={e => { if (m !== customMonth) e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        {formatMonth(m)}
                        {m === customMonth && (
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Net Worth Hero */}
          <div className="hero-card rounded-2xl p-6 relative overflow-hidden"
            style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
            <p className="label mb-2">Net Worth</p>
            <p className="value-display mb-2" style={{ fontSize: 'clamp(2rem, 5vw, 3.25rem)' }}>
              ${fmt(netWorth)}
            </p>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Income',       value: `+$${fmt(totalIncome)}`,                                                                          color: 'var(--pos)', topBorder: '#22C55E' },
              { label: 'Expenses',     value: `-$${fmt(totalExpenses)}`,                                                                        color: 'var(--neg)', topBorder: '#EF4444' },
              { label: 'Net',          value: `${net >= 0 ? '+' : '-'}$${fmt(Math.abs(net))}`,                                                  color: net >= 0 ? 'var(--pos)' : 'var(--neg)', topBorder: net >= 0 ? '#22C55E' : '#EF4444' },
              { label: 'Savings Rate', value: `${savingsRate.toFixed(1)}%`,                                                                     color: savingsRate >= 20 ? 'var(--pos)' : savingsRate >= 0 ? '#f59e0b' : 'var(--neg)', topBorder: '#f59e0b' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4"
                style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', borderTop: `2px solid ${s.topBorder}` }}>
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
                <AreaChart data={netWorthTrend}>
                  <defs>
                    <linearGradient id="nwGradA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#F97316" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#F97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--dim)' }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip {...tooltipStyle} formatter={(v: any) => [`$${fmt(Number(v))}`, 'Net Worth']} />
                  <Area type="monotone" dataKey="Value" stroke="#F97316" strokeWidth={2}
                    fill="url(#nwGradA)" dot={false}
                    activeDot={{ r: 4, fill: '#F97316', stroke: 'var(--bg)', strokeWidth: 2 }} />
                </AreaChart>
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
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <p className="font-semibold text-text text-sm">Spending by Category</p>
                <p className="text-xs text-muted mt-0.5">{spendingByCategory.length} active categories</p>
              </div>
              <div className="text-right shrink-0">
                <p className="label mb-0.5">Total</p>
                <p className="font-mono font-bold text-sm text-text" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(totalExpenses)}</p>
              </div>
            </div>
            {spendingByCategory.length > 0 ? (
              <>
                <div className="grid gap-6 sm:grid-cols-[190px_1fr] items-center">
                  <div className="relative shrink-0 mx-auto" style={{ width: 190, height: 190 }}>
                    {pieHovered && (
                      <div className="absolute pointer-events-none" style={{
                        top: 4, left: '50%', transform: 'translateX(-50%)',
                        backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line-strong)',
                        borderRadius: 10, padding: '5px 9px', whiteSpace: 'nowrap', zIndex: 20,
                        boxShadow: 'var(--edge-light), var(--shadow-card)',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: pieHovered.color }}>{pieHovered.name}</span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--fg)', fontVariantNumeric: 'tabular-nums', marginLeft: 5 }}>${fmt(pieHovered.value)}</span>
                      </div>
                    )}
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={spendingByCategory} cx="50%" cy="50%" innerRadius={61} outerRadius={85}
                          dataKey="value" paddingAngle={2} cornerRadius={5}
                          onMouseEnter={(data: any) => setPieHovered({ name: data.name, value: data.value, color: data.color })}
                          onMouseLeave={() => setPieHovered(null)}
                        >
                          {spendingByCategory.map((e, i) => (
                            <Cell key={i} fill={e.color} stroke="transparent" strokeWidth={0} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 2 }}>largest</p>
                      <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg)', textAlign: 'center', lineHeight: 1.15, maxWidth: 76 }}>{spendingByCategory[0].name.slice(0, 14)}</p>
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: spendingByCategory[0].color, fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>
                        {totalExpenses > 0 ? ((spendingByCategory[0].value / totalExpenses) * 100).toFixed(0) : 0}%
                      </p>
                    </div>
                  </div>
                  <div className="space-y-3 w-full min-w-0">
                    {spendingByCategory.slice(0, 6).map((cat, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--dim)', width: 16 }}>{String(i + 1).padStart(2, '0')}</span>
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                          <p className="text-xs text-text flex-1 truncate">{cat.name}</p>
                          <p className="font-mono text-xs font-semibold text-text shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(cat.value)}</p>
                          <p className="text-[10px] text-muted text-right shrink-0" style={{ minWidth: 32 }}>
                            {totalExpenses > 0 ? ((cat.value / totalExpenses) * 100).toFixed(0) : 0}%
                          </p>
                        </div>
                        <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--line)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${totalExpenses > 0 ? Math.min((cat.value / totalExpenses) * 100, 100) : 0}%`,
                              backgroundColor: cat.color,
                            }}
                          />
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

          {/* â”€â”€ Spending Insights â”€â”€ */}
          {hasInsights && (
            <div className="card p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>Spending Insights</p>
                  <p className="text-xs mt-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>vs. {prevPeriodLabel}</p>
                </div>
                {savRateChange !== null && (
                  <div className="text-right">
                    <p className="label mb-0.5">Savings Rate</p>
                    <p className="font-mono font-bold text-sm" style={{ fontVariantNumeric: 'tabular-nums', color: savRateChange >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                      {savRateChange >= 0 ? '+' : ''}{savRateChange.toFixed(1)}pp
                    </p>
                  </div>
                )}
              </div>

              {/* Hero mover */}
              {topMover && topMover.delta !== 0 && (
                <div className="rounded-xl p-4 mb-4" style={{
                  backgroundColor: 'var(--bg)',
                  border: `1px solid ${topMover.delta > 0 ? 'rgba(239,68,68,0.18)' : 'rgba(34,197,94,0.18)'}`,
                }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: topMover.color }} />
                    <p className="label">{topMover.delta > 0 ? 'Biggest increase' : 'Biggest drop'}</p>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <p className="font-semibold text-sm" style={{ color: 'var(--fg)' }}>{topMover.name}</p>
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold" style={{
                        fontSize: 'clamp(1.1rem, 3vw, 1.4rem)',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                        color: topMover.delta > 0 ? 'var(--neg)' : 'var(--pos)',
                      }}>
                        {topMover.delta > 0 ? '+' : 'âˆ’'}${fmt(Math.abs(topMover.delta))}
                      </p>
                      {topMover.pctChange !== null && (
                        <p className="text-xs mt-0.5" style={{
                          fontFamily: 'var(--font-mono)',
                          color: topMover.delta > 0 ? 'var(--neg)' : 'var(--pos)',
                        }}>
                          {topMover.delta > 0 ? 'â–²' : 'â–¼'} {Math.abs(topMover.pctChange).toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Category rows */}
              {categoryInsights.length > 0 ? (
                <div className="space-y-3">
                  {categoryInsights.slice(0, 7).map(cat => {
                    const isUp   = cat.delta > 0;
                    const isNew  = cat.prev === 0 && cat.curr > 0;
                    const isGone = cat.curr === 0 && cat.prev > 0;
                    const unchanged = cat.delta === 0;
                    return (
                      <div key={cat.id} className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <p className="text-sm flex-1 truncate" style={{ color: isGone ? 'var(--dim)' : 'var(--fg)' }}>
                          {cat.name}
                        </p>
                        {/* Progress bar */}
                        <div className="w-16 h-1 rounded-full overflow-hidden shrink-0" style={{ backgroundColor: 'var(--line)' }}>
                          <div style={{
                            height: '100%',
                            borderRadius: 999,
                            width: `${totalExpenses > 0 ? Math.min((cat.curr / totalExpenses) * 100, 100) : 0}%`,
                            backgroundColor: cat.color,
                            opacity: isGone ? 0.3 : 1,
                          }} />
                        </div>
                        <div className="text-right shrink-0" style={{ minWidth: '84px' }}>
                          <p className="font-mono text-xs font-semibold" style={{ color: isGone ? 'var(--dim)' : 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>
                            ${fmt(cat.curr)}
                          </p>
                          <p className="text-[10px]" style={{
                            fontFamily: 'var(--font-mono)',
                            fontVariantNumeric: 'tabular-nums',
                            color: isNew ? 'var(--accent)' : isGone ? 'var(--dim)' : unchanged ? 'var(--dim)' : isUp ? 'var(--neg)' : 'var(--pos)',
                          }}>
                            {isNew ? 'new' : isGone ? 'none' : unchanged ? 'â€”' : `${isUp ? 'â–²' : 'â–¼'} $${fmt(Math.abs(cat.delta))}`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-center py-4" style={{ color: 'var(--muted)' }}>No previous data to compare</p>
              )}

              {/* Summary footer */}
              {categoryInsights.length > 0 && (
                <div className="flex gap-5 mt-5 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
                  <div>
                    <p className="label mb-0.5">Increased</p>
                    <p className="font-mono text-sm font-semibold" style={{ color: 'var(--neg)' }}>
                      {categoryInsights.filter(c => c.delta > 0).length} <span style={{ color: 'var(--dim)', fontWeight: 400 }}>categories</span>
                    </p>
                  </div>
                  <div>
                    <p className="label mb-0.5">Decreased</p>
                    <p className="font-mono text-sm font-semibold" style={{ color: 'var(--pos)' }}>
                      {categoryInsights.filter(c => c.delta < 0).length} <span style={{ color: 'var(--dim)', fontWeight: 400 }}>categories</span>
                    </p>
                  </div>
                  {categoryInsights.filter(c => c.prev === 0 && c.curr > 0).length > 0 && (
                    <div>
                      <p className="label mb-0.5">New</p>
                      <p className="font-mono text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                        {categoryInsights.filter(c => c.prev === 0 && c.curr > 0).length} <span style={{ color: 'var(--dim)', fontWeight: 400 }}>categories</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
