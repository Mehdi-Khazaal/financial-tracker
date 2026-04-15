import React, { useEffect, useState } from 'react';
import { Loan } from '../types';
import { getLoans, updateLoan, deleteLoan } from '../utils/api';
import Navigation from '../components/Navigation';
import AddLoanModal from '../components/modals/AddLoanModal';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Loans: React.FC = () => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [repayInput, setRepayInput] = useState<Record<number, string>>({});
  const [repaying, setRepaying] = useState<number | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try { const res = await getLoans(); setLoans(res.data); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete loan for "${name}"?`)) return;
    try { await deleteLoan(id); load(); }
    catch { alert('Failed to delete'); }
  };

  const handleWriteOff = async (id: number) => {
    if (!window.confirm('Mark this loan as written off (given up on collecting)?')) return;
    try { await updateLoan(id, { status: 'written_off' }); load(); }
    catch { alert('Failed to update'); }
  };

  const handleRepayment = async (loan: Loan) => {
    const input = repayInput[loan.id];
    if (!input || parseFloat(input) <= 0) return;
    setRepaying(loan.id);
    try {
      const newRepaid = Math.min(
        Number(loan.amount_repaid) + parseFloat(input),
        Number(loan.amount)
      );
      await updateLoan(loan.id, { amount_repaid: newRepaid });
      setRepayInput(prev => { const n = { ...prev }; delete n[loan.id]; return n; });
      load();
    } catch { alert('Failed to record repayment'); }
    finally { setRepaying(null); }
  };

  const handleMarkFullyRepaid = async (id: number) => {
    try { await updateLoan(id, { status: 'repaid' }); load(); }
    catch { alert('Failed to update'); }
  };

  const formatDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const getDueStatus = (loan: Loan) => {
    if (!loan.due_date || loan.status !== 'active') return null;
    const today = new Date().toISOString().split('T')[0];
    if (loan.due_date < today) return 'overdue';
    const days = Math.ceil((new Date(loan.due_date).getTime() - new Date(today).getTime()) / 86400000);
    if (days <= 7) return 'soon';
    return 'ok';
  };

  const active      = loans.filter(l => l.status === 'active');
  const repaid      = loans.filter(l => l.status === 'repaid');
  const writtenOff  = loans.filter(l => l.status === 'written_off');

  const totalOutstanding = active.reduce((s, l) => s + Number(l.amount) - Number(l.amount_repaid), 0);
  const totalLent        = loans.reduce((s, l) => s + Number(l.amount), 0);
  const totalRecovered   = loans.reduce((s, l) => s + Number(l.amount_repaid), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: '#0b0d12' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: '#5b8fff', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  const LoanCard: React.FC<{ loan: Loan }> = ({ loan }) => {
    const outstanding = Number(loan.amount) - Number(loan.amount_repaid);
    const progress = Number(loan.amount) > 0 ? (Number(loan.amount_repaid) / Number(loan.amount)) * 100 : 0;
    const dueStatus = getDueStatus(loan);
    const isActive = loan.status === 'active';

    return (
      <div className="card overflow-hidden group">
        {/* Header */}
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-base shrink-0"
                style={{
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(245,166,35,.2), rgba(245,166,35,.1))'
                    : 'rgba(46,204,138,.1)',
                  color: isActive ? '#f5a623' : '#2ecc8a',
                  border: `1px solid ${isActive ? 'rgba(245,166,35,.3)' : 'rgba(46,204,138,.2)'}`,
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
                <p className="font-mono font-bold text-base"
                  style={{ color: isActive ? '#f5a623' : '#2ecc8a' }}>
                  ${fmt(isActive ? outstanding : Number(loan.amount))}
                </p>
                {isActive && Number(loan.amount_repaid) > 0 && (
                  <p className="text-[10px] text-muted">of ${fmt(Number(loan.amount))}</p>
                )}
                {loan.status === 'repaid' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: 'rgba(46,204,138,.15)', color: '#2ecc8a' }}>
                    Repaid ✓
                  </span>
                )}
                {loan.status === 'written_off' && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                    style={{ backgroundColor: 'rgba(120,128,160,.15)', color: '#7880a0' }}>
                    Written off
                  </span>
                )}
              </div>
              <button
                onClick={() => handleDelete(loan.id, loan.borrower_name)}
                className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg flex items-center justify-center text-xs transition-all mt-0.5"
                style={{ backgroundColor: 'rgba(255,95,109,.1)', color: '#ff5f6d' }}>
                ✕
              </button>
            </div>
          </div>

          {/* Note */}
          {loan.note && (
            <p className="text-xs text-muted mb-3 italic">"{loan.note}"</p>
          )}

          {/* Due date badge */}
          {loan.due_date && isActive && (
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: dueStatus === 'overdue' ? 'rgba(255,95,109,.15)' : dueStatus === 'soon' ? 'rgba(245,166,35,.15)' : 'rgba(91,143,255,.1)',
                  color: dueStatus === 'overdue' ? '#ff5f6d' : dueStatus === 'soon' ? '#f5a623' : '#5b8fff',
                }}>
                {dueStatus === 'overdue' ? '⚠ Overdue · ' : '📅 Due '}
                {formatDate(loan.due_date)}
              </span>
            </div>
          )}

          {/* Progress bar */}
          {isActive && Number(loan.amount_repaid) > 0 && (
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-muted mb-1.5">
                <span>Repaid ${fmt(Number(loan.amount_repaid))}</span>
                <span>{progress.toFixed(0)}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full" style={{ backgroundColor: '#252a3a' }}>
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: '#2ecc8a' }} />
              </div>
            </div>
          )}
        </div>

        {/* Repayment actions (active loans only) */}
        {isActive && (
          <div className="px-4 pb-4 pt-0 space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted text-xs">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={repayInput[loan.id] ?? ''}
                  onChange={e => setRepayInput(prev => ({ ...prev, [loan.id]: e.target.value }))}
                  className="input-dark pl-6 text-sm py-2.5"
                  placeholder={`Amount received (of $${fmt(outstanding)} left)`}
                />
              </div>
              <button
                onClick={() => handleRepayment(loan)}
                disabled={repaying === loan.id || !repayInput[loan.id] || parseFloat(repayInput[loan.id] ?? '0') <= 0}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-40 shrink-0"
                style={{ backgroundColor: 'rgba(46,204,138,.15)', color: '#2ecc8a', border: '1px solid rgba(46,204,138,.2)' }}>
                {repaying === loan.id ? '…' : '+ Got paid'}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleMarkFullyRepaid(loan.id)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl transition-all active:scale-95"
                style={{ backgroundColor: 'rgba(46,204,138,.08)', color: '#2ecc8a', border: '1px solid rgba(46,204,138,.15)' }}>
                ✓ Mark fully repaid
              </button>
              <button
                onClick={() => handleWriteOff(loan.id)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl transition-all active:scale-95"
                style={{ backgroundColor: 'rgba(120,128,160,.08)', color: '#7880a0', border: '1px solid rgba(120,128,160,.15)' }}>
                ✗ Write off
              </button>
            </div>
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
              <h1 className="text-xl font-bold text-text">Loans</h1>
              <p className="text-xs text-muted mt-0.5">Money you lent out</p>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#181c28', border: '1px solid #252a3a', color: '#7880a0' }}>
              + New Loan
            </button>
          </div>

          {/* Stats */}
          {loans.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl p-4"
                style={{ backgroundColor: '#11141c', border: '1px solid #252a3a', boxShadow: '0 0 20px rgba(245,166,35,.08)' }}>
                <p className="label mb-1">Outstanding</p>
                <p className="font-mono font-bold text-sm" style={{ color: '#f5a623' }}>${fmt(totalOutstanding)}</p>
              </div>
              <div className="rounded-2xl p-4"
                style={{ backgroundColor: '#11141c', border: '1px solid #252a3a' }}>
                <p className="label mb-1">Total Lent</p>
                <p className="font-mono font-bold text-sm text-text">${fmt(totalLent)}</p>
              </div>
              <div className="rounded-2xl p-4"
                style={{ backgroundColor: '#11141c', border: '1px solid #252a3a', boxShadow: '0 0 20px rgba(46,204,138,.08)' }}>
                <p className="label mb-1">Recovered</p>
                <p className="font-mono font-bold text-sm" style={{ color: '#2ecc8a' }}>${fmt(totalRecovered)}</p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {loans.length === 0 && (
            <div className="card py-14 text-center">
              <p className="text-4xl mb-3">🤝</p>
              <p className="font-semibold text-text mb-1">No loans tracked</p>
              <p className="text-sm text-muted mb-5">Record money you've lent to friends or family</p>
              <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">
                Record a Loan
              </button>
            </div>
          )}

          {/* Active loans */}
          {active.length > 0 && (
            <div className="space-y-3">
              <p className="label">Waiting for repayment <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(245,166,35,.15)', color: '#f5a623' }}>
                {active.length}
              </span></p>
              {active.map(l => <LoanCard key={l.id} loan={l} />)}
            </div>
          )}

          {/* Repaid */}
          {repaid.length > 0 && (
            <div className="space-y-3">
              <p className="label opacity-60">Repaid</p>
              <div className="space-y-2 opacity-60">
                {repaid.map(l => <LoanCard key={l.id} loan={l} />)}
              </div>
            </div>
          )}

          {/* Written off */}
          {writtenOff.length > 0 && (
            <div className="space-y-3">
              <p className="label opacity-40">Written Off</p>
              <div className="space-y-2 opacity-40">
                {writtenOff.map(l => <LoanCard key={l.id} loan={l} />)}
              </div>
            </div>
          )}

        </div>
      </main>

      {/* FAB */}
      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #f5a623, #f97316)', boxShadow: '0 8px 32px rgba(245,166,35,.35)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddLoanModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
    </>
  );
};

export default Loans;
