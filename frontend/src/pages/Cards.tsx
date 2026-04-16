import React, { useEffect, useState } from 'react';
import { Account, Transaction } from '../types';
import { getAccounts, getTransactions, deleteAccount } from '../utils/api';
import Navigation from '../components/Navigation';
import TransferModal from '../components/modals/TransferModal';
import AddAccountModal from '../components/modals/AddAccountModal';
import EditAccountModal from '../components/modals/EditAccountModal';
import ProgressBar from '../components/ProgressBar';

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Cards: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [payCard, setPayCard] = useState<Account | null>(null);
  const [editCard, setEditCard] = useState<Account | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [aRes, tRes] = await Promise.all([getAccounts(), getTransactions()]);
      setAccounts(Array.isArray(aRes.data) ? aRes.data.filter((a: Account) => a.type === 'credit_card') : []);
      setTransactions(Array.isArray(tRes.data) ? tRes.data : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try { await deleteAccount(id); load(); }
    catch { alert('Failed to delete'); }
  };

  const totalOwed  = accounts.reduce((s, a) => s + Math.abs(Number(a.balance)), 0);
  const totalLimit = accounts.reduce((s, a) => s + (Number(a.credit_limit) || 0), 0);
  const totalUtil  = totalLimit > 0 ? (totalOwed / totalLimit) * 100 : 0;

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
            <h1 className="text-xl font-bold text-text">Credit Cards</h1>
            <button onClick={() => setShowAdd(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
              style={{ backgroundColor: '#121620', border: '1px solid #1a1f2e', color: '#666e90' }}>
              + Card
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="card py-14 text-center">
              <p className="text-4xl mb-3">💳</p>
              <p className="font-semibold text-text mb-1">No credit cards</p>
              <p className="text-sm text-muted mb-5">Add your credit cards to track spending and limits</p>
              <button onClick={() => setShowAdd(true)} className="btn-gradient px-6 py-2.5 text-sm">Add Credit Card</button>
            </div>
          ) : (
            <>
              {/* Overall utilization */}
              {totalLimit > 0 && (
                <div className="card p-5">
                  <div className="flex justify-between items-center mb-3">
                    <div>
                      <p className="label mb-0.5">Overall Utilization</p>
                      <p className="font-mono font-bold text-xl text-text">{totalUtil.toFixed(0)}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted">Owed</p>
                      <p className="font-mono font-semibold text-sm" style={{ color: '#f43f5e' }}>${fmt(totalOwed)}</p>
                      <p className="text-xs text-muted mt-0.5">Limit ${fmt(totalLimit)}</p>
                    </div>
                  </div>
                  <ProgressBar value={totalUtil} colorAuto showLabel={false} height={8} />
                </div>
              )}

              {/* Card list */}
              {accounts.map(card => {
                const owed      = Math.abs(Number(card.balance));
                const limit     = Number(card.credit_limit) || 0;
                const available = limit > 0 ? limit - owed : 0;
                const utilized  = limit > 0 ? (owed / limit) * 100 : 0;
                const cardTxs   = transactions.filter(t => t.account_id === card.id).slice(0, 5);

                return (
                  <div key={card.id} className="card overflow-hidden">
                    {/* Card visual */}
                    <div className="relative p-5 overflow-hidden" style={{
                      background: 'linear-gradient(135deg, #121620 0%, #1a1f2e 100%)',
                      borderBottom: '1px solid #1a1f2e',
                    }}>
                      <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full opacity-20"
                        style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <p className="font-bold text-text">{card.name}</p>
                          <p className="text-xs text-muted mt-0.5">Credit Card</p>
                        </div>
                        <span className="text-2xl">💳</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-muted mb-1">Balance Owed</p>
                          <p className="font-mono font-bold text-2xl" style={{ color: '#f43f5e' }}>${fmt(owed)}</p>
                        </div>
                        {limit > 0 && (
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-widest text-muted mb-1">Available</p>
                            <p className="font-mono font-bold text-lg" style={{ color: '#10b981' }}>${fmt(available)}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats + progress */}
                    {limit > 0 && (
                      <div className="px-5 py-4" style={{ borderBottom: '1px solid #1a1f2e' }}>
                        <div className="flex justify-between text-xs text-muted mb-2">
                          <span>Used: ${fmt(owed)}</span>
                          <span>Limit: ${fmt(limit)}</span>
                        </div>
                        <ProgressBar value={utilized} colorAuto height={6} />
                      </div>
                    )}

                    {/* Actions */}
                    <div className="px-5 py-3 flex gap-2" style={{ borderBottom: cardTxs.length > 0 ? '1px solid #1a1f2e' : 'none' }}>
                      <button onClick={() => setPayCard(card)}
                        className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
                        style={{ background: 'linear-gradient(135deg, #6366f1, #a855f7)', color: 'white' }}>
                        Pay Card
                      </button>
                      <button onClick={() => setEditCard(card)}
                        className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
                        style={{ backgroundColor: 'rgba(99,102,241,.1)', color: '#6366f1', border: '1px solid rgba(99,102,241,.2)' }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(card.id, card.name)}
                        className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-95"
                        style={{ backgroundColor: 'rgba(244,63,94,.1)', color: '#f43f5e', border: '1px solid rgba(244,63,94,.2)' }}>
                        Delete
                      </button>
                    </div>

                    {/* Recent transactions */}
                    {cardTxs.length > 0 && (
                      <div className="px-5 py-3">
                        <p className="label mb-3">Recent Transactions</p>
                        {cardTxs.map((tx, i) => {
                          const pos = Number(tx.amount) >= 0;
                          return (
                            <div key={tx.id} className={`flex items-center justify-between py-2.5 ${i !== cardTxs.length - 1 ? 'border-b border-border' : ''}`}>
                              <div>
                                <p className="text-sm font-medium text-text">{tx.description || 'No note'}</p>
                                <p className="text-xs text-muted">{tx.transaction_date}</p>
                              </div>
                              <p className="font-mono font-semibold text-sm" style={{ color: pos ? '#10b981' : '#f43f5e' }}>
                                {pos ? '+' : '-'}${fmt(Math.abs(Number(tx.amount)))}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </main>

      {/* FAB */}
      <button onClick={() => setShowAdd(true)}
        className="fixed bottom-24 md:bottom-8 right-5 rounded-full shadow-2xl flex items-center justify-center transition-transform active:scale-90 hover:scale-105 z-30"
        style={{ width: '52px', height: '52px', background: 'linear-gradient(135deg, #6366f1, #a855f7)', boxShadow: '0 8px 32px rgba(99,102,241,.4)' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" className="w-6 h-6">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <AddAccountModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={load} />
      <EditAccountModal isOpen={!!editCard} onClose={() => setEditCard(null)} onSuccess={load} account={editCard} />

      {payCard && (
        <TransferModal
          isOpen={!!payCard}
          onClose={() => setPayCard(null)}
          onSuccess={() => { setPayCard(null); load(); }}
          preselectedToId={payCard.id}
        />
      )}
    </>
  );
};

export default Cards;
