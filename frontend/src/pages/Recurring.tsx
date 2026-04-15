import React, { useEffect, useState } from 'react';
import { RecurringTransaction, Account, Category } from '../types';
import { getRecurring, deleteRecurring, updateRecurring, processDueRecurring, logVariableRecurring, getAccounts, getCategories } from '../utils/api';
import Navigation from '../components/Navigation';
import AddRecurringModal from '../components/modals/AddRecurringModal';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PERIOD_LABELS: Record<string, string> = {
  weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly',
  quarterly: 'Quarterly', yearly: 'Yearly',
};

const PERIOD_COLORS: Record<string, string> = {
  weekly: '#a78bfa', biweekly: '#5b8fff', monthly: '#2ecc8a',
  quarterly: '#f5a623', yearly: '#ff5f6d',
};

const Recurring: React.FC = () => {
  const [items, setItems] = useState<RecurringTransaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [billInputs, setBillInputs] = useState<Record<number, string>>({});
  const [loggingBill, setLoggingBill] = useState<number | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [rRes, aRes, cRes] = await Promise.all([getRecurring(), getAccounts(), getCategories()]);
      setItems(rRes.data);
      setAccounts(aRes.data);
      setCategories(cRes.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this recurring transaction?')) return;
    try { await deleteRecurring(id); load(); }
    catch { alert('Failed to delete'); }
  };

  const handleToggle = async (item: RecurringTransaction) => {
    try { await updateRecurring(item.id, { is_active: !item.is_active }); load(); }
    catch { alert('Failed to update'); }
  };

  const handleProcess = async () => {
    setProcessing(true);
    try {
      const res = await processDueRecurring();
      const count = res.data.length;
      if (count > 0) {
        alert(`✓ Logged ${count} transaction${count !== 1 ? 's' : ''}`);
      } else {
        alert('No fixed recurring transactions due right now');
      }
      load();
    } catch { alert('Failed to process'); }
    finally { setProcessing(false); }
  };

  const handleLogBill = async (item: RecurringTransaction) => {
    const input = billInputs[item.id];
    if (!input || parseFloat(input) <= 0) return;
    setLoggingBill(item.id);
    try {
      const sign = Number(item.amount) < 0 ? -1 : 1;
      const actualAmount = sign * Math.abs(parseFloat(input));
      await logVariableRecurring(item.id, actualAmount);
      setBillInputs(prev => { const n = { ...prev }; delete n[item.id]; return n; });
      load();
    } catch { alert('Failed to log bill'); }
    finally { setLoggingBill(null); }
  };

  const getAccountName = (id: number) => accounts.find(a => a.id === id)?.name ?? 'Unknown';
  const getCategory = (id: number | null) => categories.find(c => c.id === id);

  const today = new Date().toISOString().split('T')[0];
  const dueNow        = items.filter(i => i.is_active && i.next_date <= today);
  const dueFixed      = dueNow.filter(i => !i.is_variable);
  const dueBills      = dueNow.filter(i => i.is_variable);
  const upcoming      = items.filter(i => i.is_active && i.next_date > today);
  const inactive      = items.filter(i => !i.is_active);

  // Monthly cost estimate
  const PERIOD_MULTIPLIERS: Record<string, number> = {
    weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 0.33, yearly: 0.083,
  };
  const monthlyNet = items
    .filter(i => i.is_active)
    .reduce((s, i) => s + Number(i.amount) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);
  const monthlyIncome = items
    .filter(i => i.is_active && Number(i.amount) > 0)
    .reduce((s, i) => s + Number(i.amount) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);
  const monthlyExpense = items
    .filter(i => i.is_active && Number(i.amount) < 0)
    .reduce((s, i) => s + Math.abs(Number(i.amount)) * (PERIOD_MULTIPLIERS[i.period] ?? 1), 0);

  const formatNextDate = (d: string) => {
    const today = new Date().toISOString().split('T')[0];
    if (d === today) return 'Due today';
    if (d < today) return 'Overdue';
    const days = Math.ceil((new Date(d).getTime() - new Date(today).getTime()) / 86400000);
    if (days === 1) return 'Tomorrow';
    if (days <= 7) return `In ${days} days`;
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const isDue = (d: string) => d <= today;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#0b0d12' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: '#5b8fff', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const RecurringItem: React.FC<{ item: RecurringTransaction }> = ({ item }) => {
    const pos = Number(item.amount) > 0;
    const cat = getCategory(item.category_id);
    const due = isDue(item.next_date);

    return (
      <div className="group transition-colors hover:bg-surface2" style={{ borderBottom: '1px solid #1a1f2e' }}>
        <div className="flex items-center gap-3 px-4 py-3.5">
          {/* Color bar */}
          <div className="w-1 h-10 rounded-full shrink-0"
            style={{ backgroundColor: cat?.color ?? (pos ? '#2ecc8a' : '#ff5f6d') }} />

          {/* Icon */}
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: item.is_variable ? 'rgba(245,166,35,.1)' : (pos ? 'rgba(46,204,138,.1)' : 'rgba(255,95,109,.1)'),
                     color: item.is_variable ? '#f5a623' : (pos ? '#2ecc8a' : '#ff5f6d') }}>
            <span className="text-sm font-bold">{item.is_variable ? '~' : (pos ? '↑' : '↓')}</span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium text-text truncate">{item.description || 'Recurring'}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: PERIOD_COLORS[item.period] + '20', color: PERIOD_COLORS[item.period] }}>
                {PERIOD_LABELS[item.period]}
              </span>
              {item.is_variable && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'rgba(245,166,35,.15)', color: '#f5a623' }}>
                  variable
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted flex-wrap">
              <span>{getAccountName(item.account_id)}</span>
              {cat && <><span>·</span><span style={{ color: cat.color }}>{cat.name}</span></>}
              <span>·</span>
              <span style={{ color: due && item.is_active ? '#ff5f6d' : '#7880a0' }}>
                {formatNextDate(item.next_date)}
              </span>
            </div>
          </div>

          {/* Amount + controls */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <p className="font-mono font-bold text-sm" style={{ color: item.is_variable ? '#f5a623' : (pos ? '#2ecc8a' : '#ff5f6d') }}>
                {item.is_variable ? '~' : (pos ? '+' : '-')}${fmt(Math.abs(Number(item.amount)))}
              </p>
              {item.is_variable && <p className="text-[10px] text-muted">last bill</p>}
            </div>
            <button onClick={() => handleToggle(item)}
              className="w-8 h-5 rounded-full transition-all relative shrink-0"
              style={{ backgroundColor: item.is_active ? '#2ecc8a' : '#252a3a' }}
              title={item.is_active ? 'Pause' : 'Resume'}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                style={{ left: item.is_active ? '14px' : '2px' }} />
            </button>
            <button onClick={() => handleDelete(item.id)}
              className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all"
              style={{ backgroundColor: 'rgba(255,95,109,.1)', color: '#ff5f6d' }}>
              ✕
            </button>
          </div>
        </div>

        {/* Variable bill: show amount input when due */}
        {item.is_variable && item.is_active && due && (
          <div className="px-4 pb-3 flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted text-xs">$</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={billInputs[item.id] ?? ''}
                onChange={e => setBillInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                className="input-dark pl-6 text-sm py-2.5"
                placeholder={`This month's amount (last: $${fmt(Math.abs(Number(item.amount)))})`}
              />
            </div>
            <button
              onClick={() => handleLogBill(item)}
              disabled={loggingBill === item.id || !billInputs[item.id] || parseFloat(billInputs[item.id] ?? '0') <= 0}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-40 shrink-0"
              style={{ backgroundColor: 'rgba(245,166,35,.15)', color: '#f5a623', border: '1px solid rgba(245,166,35,.25)' }}>
              {loggingBill === item.id ? '…' : 'Log bill'}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Navigation />
      <main className="md:ml-60 min-h-screen pb-28 md:pb-10" style={{ backgroundColor: '#0b0d12' }}>
        <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5 fade-in">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text">Recurring</h1>
              <p className="text-xs text-muted mt-0.5">Subscriptions, salary, rent</p>
            </div>
            <div className="flex gap-2">
              {dueFixed.length > 0 && (
                <button onClick={handleProcess} disabled={processing}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #ff5f6d, #ff8e53)', color: 'white' }}>
                  {processing ? '…' : `Log ${dueFixed.length} fixed`}
                </button>
              )}
              <button onClick={() => setShowAdd(true)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                style={{ backgroundColor: '#181c28', border: '1px solid #252a3a', color: '#7880a0' }}>
                + Add
              </button>
            </div>
          </div>

          {/* Monthly summary */}
          {items.filter(i => i.is_active).length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl p-4" style={{ backgroundColor: '#11141c', border: '1px solid #252a3a', boxShadow: '0 0 20px rgba(46,204,138,.08)' }}>
                <p className="label mb-1">Est. Income</p>
                <p className="font-mono font-bold text-sm" style={{ color: '#2ecc8a' }}>+${fmt(monthlyIncome)}</p>
                <p className="text-[10px] text-muted mt-0.5">/month</p>
              </div>
              <div className="rounded-2xl p-4" style={{ backgroundColor: '#11141c', border: '1px solid #252a3a', boxShadow: '0 0 20px rgba(255,95,109,.08)' }}>
                <p className="label mb-1">Est. Costs</p>
                <p className="font-mono font-bold text-sm" style={{ color: '#ff5f6d' }}>-${fmt(monthlyExpense)}</p>
                <p className="text-[10px] text-muted mt-0.5">/month</p>
              </div>
              <div className="rounded-2xl p-4" style={{ backgroundColor: '#11141c', border: '1px solid #252a3a', boxShadow: '0 0 20px rgba(91,143,255,.08)' }}>
                <p className="label mb-1">Net</p>
                <p className="font-mono font-bold text-sm" style={{ color: monthlyNet >= 0 ? '#2ecc8a' : '#ff5f6d' }}>
                  {monthlyNet >= 0 ? '+' : '-'}${fmt(Math.abs(monthlyNet))}
                </p>
                <p className="text-[10px] text-muted mt-0.5">/month</p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {items.length === 0 && (
            <div className="card py-14 text-center">
              <p className="text-4xl mb-3">🔄</p>
              <p className="font-semibold text-text mb-1">No recurring transactions</p>
              <p className="text-sm text-muted mb-5">Track rent, salary, subscriptions and more</p>
              <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">
                Add First Recurring
              </button>
            </div>
          )}

          {/* Due now */}
          {dueNow.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#ff5f6d' }} />
                <p className="label" style={{ color: '#ff5f6d' }}>Due Now</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'rgba(255,95,109,.15)', color: '#ff5f6d' }}>
                  {dueNow.length}
                </span>
              </div>
              <div className="card overflow-hidden">
                {dueNow.map(item => <RecurringItem key={item.id} item={item} />)}
              </div>
              {dueFixed.length > 0 && (
                <button onClick={handleProcess} disabled={processing}
                  className="mt-2 w-full py-3 text-sm font-semibold rounded-2xl transition-all active:scale-95 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, rgba(255,95,109,.15), rgba(255,142,83,.15))', color: '#ff5f6d', border: '1px solid rgba(255,95,109,.2)' }}>
                  {processing ? 'Processing…' : `Log all ${dueFixed.length} fixed transactions`}
                </button>
              )}
              {dueBills.length > 0 && (
                <p className="text-xs text-muted mt-2 text-center">
                  {dueBills.length} variable bill{dueBills.length !== 1 ? 's' : ''} above need{dueBills.length === 1 ? 's' : ''} a manual amount
                </p>
              )}
            </div>
          )}

          {/* Upcoming */}
          {upcoming.length > 0 && (
            <div>
              <p className="label mb-3">Upcoming</p>
              <div className="card overflow-hidden">
                {upcoming.map((item, i) => (
                  <div key={item.id} style={{ borderBottom: i < upcoming.length - 1 ? undefined : 'none' }}>
                    <RecurringItem item={item} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inactive / paused */}
          {inactive.length > 0 && (
            <div>
              <p className="label mb-3 opacity-60">Paused</p>
              <div className="card overflow-hidden opacity-60">
                {inactive.map((item, i) => (
                  <div key={item.id} style={{ borderBottom: i < inactive.length - 1 ? undefined : 'none' }}>
                    <RecurringItem item={item} />
                  </div>
                ))}
              </div>
            </div>
          )}

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

      <AddRecurringModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
    </>
  );
};

export default Recurring;
