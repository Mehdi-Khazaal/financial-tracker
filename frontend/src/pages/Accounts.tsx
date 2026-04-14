import React, { useEffect, useState } from 'react';
import { Account } from '../types';
import { getAccounts, deleteAccount } from '../utils/api';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddAccountModal from '../components/AddAccountModal';

const typeConfig: Record<string, { icon: string; bg: string }> = {
  checking: { icon: '💳', bg: 'bg-blue-50' },
  savings: { icon: '🏦', bg: 'bg-green-50' },
  credit_card: { icon: '💰', bg: 'bg-orange-50' },
  investment: { icon: '📈', bg: 'bg-purple-50' },
  cash: { icon: '💵', bg: 'bg-yellow-50' },
};

const Accounts: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => { loadAccounts(); }, []);

  const loadAccounts = async () => {
    try {
      const res = await getAccounts();
      setAccounts(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"? This will also delete all associated transactions.`)) return;
    try {
      await deleteAccount(id);
      loadAccounts();
    } catch {
      alert('Failed to delete account');
    }
  };

  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0);

  const grouped = accounts.reduce<Record<string, Account[]>>((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <div className="md:ml-64 min-h-screen bg-slate-50 pb-24 md:pb-8">
        <div className="p-4 md:p-8 max-w-5xl">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-navy">Accounts</h1>
            <button
              onClick={() => setShowAdd(true)}
              className="hidden md:flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:opacity-90 transition"
            >
              + Add Account
            </button>
          </div>

          {/* Summary card */}
          <div className="bg-primary text-white rounded-2xl p-6 mb-8 flex justify-between items-center">
            <div>
              <p className="text-white text-opacity-70 text-sm mb-1">Total across all accounts</p>
              <p className="text-4xl font-bold">${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-white text-opacity-70 text-sm">{accounts.length} account{accounts.length !== 1 ? 's' : ''}</p>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
              <p className="text-5xl mb-4">🏦</p>
              <p className="text-xl font-bold text-navy mb-2">No accounts yet</p>
              <p className="text-gray mb-6">Add your bank accounts, credit cards, and cash accounts</p>
              <button onClick={() => setShowAdd(true)} className="bg-primary text-white px-8 py-3 rounded-xl font-medium hover:opacity-90">
                Add Your First Account
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(grouped).map(([type, typeAccounts]) => {
                const config = typeConfig[type] ?? { icon: '💰', bg: 'bg-slate-50' };
                return (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-xl">{config.icon}</span>
                      <h2 className="text-lg font-bold text-navy capitalize">{type.replace('_', ' ')}</h2>
                      <span className="text-sm text-gray">({typeAccounts.length})</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {typeAccounts.map((account) => (
                        <div key={account.id} className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-md transition-shadow group">
                          <div className="flex justify-between items-start mb-4">
                            <div className={`w-10 h-10 rounded-xl ${config.bg} flex items-center justify-center text-xl`}>
                              {config.icon}
                            </div>
                            <button
                              onClick={() => handleDelete(account.id, account.name)}
                              className="opacity-0 group-hover:opacity-100 text-xs text-accent hover:underline transition-opacity"
                            >
                              Delete
                            </button>
                          </div>
                          <p className="font-semibold text-navy mb-1">{account.name}</p>
                          <p className="text-2xl font-bold text-primary">
                            ${Number(account.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                          <p className="text-xs text-gray mt-1">{account.currency}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <FloatingAddButton
        actions={[{ label: 'Add Account', icon: '🏦', color: '#1F422C', onClick: () => setShowAdd(true) }]}
      />

      <AddAccountModal isOpen={showAdd} onClose={() => setShowAdd(false)} onSuccess={loadAccounts} />
    </>
  );
};

export default Accounts;
