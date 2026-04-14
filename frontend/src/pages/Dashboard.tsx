import React, { useEffect, useState } from 'react';
import { Account, Transaction } from '../types';
import { getAccounts, getTransactions } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddAccountModal from '../components/AddAccountModal';
import AddTransactionModal from '../components/AddTransactionModal';

const accountTypeIcons: Record<string, string> = {
  checking: '💳',
  savings: '🏦',
  credit_card: '💰',
  investment: '📈',
  cash: '💵',
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [accRes, txRes] = await Promise.all([getAccounts(), getTransactions()]);
      setAccounts(accRes.data);
      setTransactions(txRes.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0);
  const recentTx = [...transactions]
    .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime())
    .slice(0, 8);
  const monthIncome = transactions
    .filter((t) => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  const monthExpenses = transactions
    .filter((t) => Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-beige">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-gray text-sm">Loading your finances...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <div className="md:ml-64 min-h-screen bg-slate-50 pb-24 md:pb-8">
        <div className="p-4 md:p-8 max-w-6xl">
          {/* Header */}
          <div className="mb-8">
            <p className="text-gray text-sm mb-1">Good day,</p>
            <h1 className="text-3xl font-bold text-navy">{user?.username} 👋</h1>
          </div>

          {/* Net worth hero card */}
          <div className="bg-primary rounded-2xl p-6 mb-6 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-40 h-40 bg-white opacity-5 rounded-full -translate-y-10 translate-x-10" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-white opacity-5 rounded-full translate-y-8 -translate-x-8" />
            <p className="text-white text-opacity-70 text-sm mb-1 relative">Total Balance</p>
            <p className="text-4xl font-bold mb-4 relative">${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <div className="flex gap-6 relative">
              <div>
                <p className="text-white text-opacity-60 text-xs mb-0.5">Income</p>
                <p className="text-lime font-semibold">+${monthIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
              <div>
                <p className="text-white text-opacity-60 text-xs mb-0.5">Expenses</p>
                <p className="text-peach font-semibold">-${monthExpenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>

          {/* Accounts */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-navy">Accounts</h2>
              <button
                onClick={() => setShowAddAccount(true)}
                className="text-sm text-primary font-medium hover:underline"
              >
                + Add account
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-slate-100">
                <p className="text-4xl mb-3">🏦</p>
                <p className="font-semibold text-navy mb-1">No accounts yet</p>
                <p className="text-gray text-sm mb-4">Add your first account to get started</p>
                <button
                  onClick={() => setShowAddAccount(true)}
                  className="bg-primary text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:opacity-90"
                >
                  Add Account
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {accounts.map((account) => (
                  <div key={account.id} className="bg-white rounded-2xl p-5 border border-slate-100 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-3">
                      <div className="w-10 h-10 rounded-xl bg-beige flex items-center justify-center text-xl">
                        {accountTypeIcons[account.type] || '💰'}
                      </div>
                      <span className="text-xs bg-slate-100 text-gray px-2 py-1 rounded-lg capitalize">
                        {account.type.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-gray mb-1">{account.name}</p>
                    <p className="text-2xl font-bold text-navy">
                      ${Number(account.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-gray mt-1">{account.currency}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Transactions */}
          <div>
            <h2 className="text-lg font-bold text-navy mb-4">Recent Transactions</h2>
            {recentTx.length === 0 ? (
              <div className="bg-white rounded-2xl p-8 text-center border border-slate-100">
                <p className="text-4xl mb-3">💸</p>
                <p className="font-semibold text-navy mb-1">No transactions yet</p>
                <p className="text-gray text-sm">Your transactions will appear here</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                {recentTx.map((tx, i) => (
                  <div
                    key={tx.id}
                    className={`flex items-center justify-between p-4 ${i !== recentTx.length - 1 ? 'border-b border-slate-50' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold ${Number(tx.amount) >= 0 ? 'bg-primary' : 'bg-accent'}`}>
                        {Number(tx.amount) >= 0 ? '↑' : '↓'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-navy">{tx.description || 'No description'}</p>
                        <p className="text-xs text-gray">{tx.transaction_date}</p>
                      </div>
                    </div>
                    <p className={`font-bold text-sm ${Number(tx.amount) >= 0 ? 'text-primary' : 'text-accent'}`}>
                      {Number(tx.amount) >= 0 ? '+' : ''}${Math.abs(Number(tx.amount)).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <FloatingAddButton
        actions={[
          { label: 'Add Transaction', icon: '↕', color: '#B12B24', onClick: () => setShowAddTransaction(true) },
          { label: 'Add Account', icon: '🏦', color: '#1F422C', onClick: () => setShowAddAccount(true) },
        ]}
      />

      <AddAccountModal isOpen={showAddAccount} onClose={() => setShowAddAccount(false)} onSuccess={loadData} />
      <AddTransactionModal isOpen={showAddTransaction} onClose={() => setShowAddTransaction(false)} onSuccess={loadData} />
    </>
  );
};

export default Dashboard;
