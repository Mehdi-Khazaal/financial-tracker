import React, { useEffect, useState, useCallback } from 'react';
import { localDateStr } from '../utils/date';
import { Loan } from '../types';
import { getLoans, updateLoan, deleteLoan } from '../utils/api';
import Navigation from '../components/Navigation';
import AddLoanModal from '../components/modals/AddLoanModal';
import EmptyState from '../components/EmptyState';
import PullToRefresh from '../components/PullToRefresh';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';

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

// ── LoanCard defined OUTSIDE Loans to prevent remount on every keystroke ──────
interface LoanCardProps {
  loan: Loan;
  repayInput: string;
  repaying: boolean;
  onRepayChange: (id: number, val: string) => void;
  onRepayment: (loan: Loan) => void;
  onMarkRepaid: (id: number) => void;
  onWriteOff: (id: number) => void;
  onDelete: (loan: Loan) => void;
}

const LoanCard: React.FC<LoanCardProps> = ({
  loan, repayInput, repaying, onRepayChange, onRepayment, onMarkRepaid, onWriteOff, onDelete,
}) => {
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
              style={{
                backgroundColor: 'var(--elev-sub)',
                color: isActive ? '#f59e0b' : 'var(--pos)',
                border: `1px solid var(--line)`,
              }}>
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
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)' }}>Repaid ✓</span>
              )}
              {loan.status === 'written_off' && (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ backgroundColor: 'var(--elev-sub)', color: 'var(--muted)' }}>Written off</span>
              )}
            </div>
            <button
              onClick={() => onDelete(loan)}
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
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              {dueStatus === 'overdue' ? 'Overdue · ' : 'Due '}
              {formatDate(loan.due_date)}
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
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={repayInput}
                onChange={e => onRepayChange(loan.id, e.target.value)}
                className="input-dark pl-6 text-sm py-2.5"
                placeholder={`Amount received (of $${fmt(outstanding)} left)`}
              />
            </div>
            <button
              onClick={() => onRepayment(loan)}
              disabled={repaying || !repayInput || parseFloat(repayInput) <= 0}
              className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-40 shrink-0"
              style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.15)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.2)' }}>
              {repaying ? '…' : '+ Got paid'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onMarkRepaid(loan.id)}
              className="flex-1 py-2 text-xs font-semibold rounded-xl transition-all active:scale-95"
              style={{ backgroundColor: 'oklch(78% 0.16 150 / 0.08)', color: 'var(--pos)', border: '1px solid oklch(78% 0.16 150 / 0.15)' }}>
              Mark fully repaid
            </button>
            <button
              onClick={() => onWriteOff(loan.id)}
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

// ── Main page ─────────────────────────────────────────────────────────────────
const Loans: React.FC = () => {
  const toast = useToast();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [repayInput, setRepayInput] = useState<Record<number, string>>({});
  const [repaying, setRepaying] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { const res = await getLoans(); setLoans(Array.isArray(res.data) ? res.data : []); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { pulling, refreshing, pullDistance } = usePullToRefresh(load);

  const handleRepayChange = useCallback((id: number, val: string) => {
    setRepayInput(prev => ({ ...prev, [id]: val }));
  }, []);

  const handleDelete = useCallback(async (loan: Loan) => {
    const ok = await toast.confirm(`Delete loan for "${loan.borrower_name}"?`, { danger: true });
    if (!ok) return;
    try { await deleteLoan(loan.id); load(); toast.success('Loan deleted'); }
    catch { toast.error('Failed to delete'); }
  }, [toast, load]);

  const handleWriteOff = useCallback(async (id: number) => {
    const ok = await toast.confirm('Mark this loan as written off? This means you\'ve given up on collecting.', { danger: true });
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
      load();
      toast.success(`Recorded $${fmt(parseFloat(input))} repayment`);
    } catch { toast.error('Failed to record repayment'); }
    finally { setRepaying(null); }
  }, [repayInput, toast, load]);

  const handleMarkRepaid = useCallback(async (id: number) => {
    try { await updateLoan(id, { status: 'repaid' }); load(); toast.success('Marked as fully repaid'); }
    catch { toast.error('Failed to update'); }
  }, [toast, load]);

  const active     = loans.filter(l => l.status === 'active');
  const repaid     = loans.filter(l => l.status === 'repaid');
  const writtenOff = loans.filter(l => l.status === 'written_off');

  const totalOutstanding = active.reduce((s, l) => s + Number(l.amount) - Number(l.amount_repaid), 0);
  const totalLent        = loans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRecovered   = loans.reduce((s, l) => s + Number(l.amount_repaid), 0);

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="md:ml-60 min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
          <div className="max-w-2xl mx-auto px-4 md:px-6 pt-6 md:pt-8 space-y-5">
            <div className="skeleton h-7 w-24 rounded-xl" />
            <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
            {[0,1].map(i => <div key={i} className="skeleton h-36 rounded-2xl" />)}
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

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text" style={{ fontFamily: 'var(--font-serif)' }}>Loans</h1>
              <p className="text-xs text-muted mt-0.5">Money you lent out</p>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)', color: '#f59e0b' }}>
              + New Loan
            </button>
          </div>

          {loans.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Outstanding', value: `$${fmt(totalOutstanding)}`, color: '#f59e0b' },
                { label: 'Total Lent',  value: `$${fmt(totalLent)}`,        color: 'var(--fg)' },
                { label: 'Recovered',  value: `$${fmt(totalRecovered)}`,    color: 'var(--pos)' },
              ].map(s => (
                <div key={s.label} className="rounded-2xl p-4"
                  style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}>
                  <p className="label mb-1">{s.label}</p>
                  <p className="font-mono font-bold text-sm" style={{ color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {loans.length === 0 && (
            <EmptyState
              iconPath="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v1h8v-1zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-1a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v1h-3zM4.75 12.094A5.973 5.973 0 004 15v1H1v-1a3 3 0 013.75-2.906z"
              iconColor="#f59e0b"
              title="No loans tracked"
              description="Record money you've lent to friends or family and track repayments."
              action={{ label: 'Record a Loan', onClick: () => setShowAdd(true) }}
            />
          )}

          {active.length > 0 && (
            <div className="space-y-3">
              <p className="label">Waiting for repayment
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'rgba(245,158,11,.15)', color: '#f59e0b' }}>
                  {active.length}
                </span>
              </p>
              {active.map(l => (
                <LoanCard key={l.id} loan={l}
                  repayInput={repayInput[l.id] ?? ''}
                  repaying={repaying === l.id}
                  onRepayChange={handleRepayChange}
                  onRepayment={handleRepayment}
                  onMarkRepaid={handleMarkRepaid}
                  onWriteOff={handleWriteOff}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {repaid.length > 0 && (
            <div className="space-y-3">
              <p className="label opacity-60">Repaid</p>
              <div className="space-y-2 opacity-60">
                {repaid.map(l => (
                  <LoanCard key={l.id} loan={l} repayInput="" repaying={false}
                    onRepayChange={handleRepayChange} onRepayment={handleRepayment}
                    onMarkRepaid={handleMarkRepaid} onWriteOff={handleWriteOff} onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}

          {writtenOff.length > 0 && (
            <div className="space-y-3">
              <p className="label opacity-40">Written Off</p>
              <div className="space-y-2 opacity-40">
                {writtenOff.map(l => (
                  <LoanCard key={l.id} loan={l} repayInput="" repaying={false}
                    onRepayChange={handleRepayChange} onRepayment={handleRepayment}
                    onMarkRepaid={handleMarkRepaid} onWriteOff={handleWriteOff} onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      </main>

      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', backgroundColor: 'var(--accent)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddLoanModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
    </>
  );
};

export default Loans;
