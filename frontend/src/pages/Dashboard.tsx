import React, { useEffect, useState } from 'react';
import { Account, Transaction } from '../types';
import { getAccounts, getTransactions } from '../utils/api';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddAccountModal from '../components/AddAccountModal';
import AddTransactionModal from '../components/AddTransactionModal';

const Dashboard: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [accountsRes, transactionsRes] = await Promise.all([
        getAccounts(),
        getTransactions(),
      ]);
      setAccounts(accountsRes.data);
      setTransactions(transactionsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance), 0);

  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-xl text-primary">Loading...</div>
    </div>;
  }

  return (
    <>
      <Navigation />
      
      <div className="md:ml-64 min-h-screen bg-beige pb-20 md:pb-8">
        <div className="p-4 md:p-8">
          <h1 className="text-4xl font-bold text-primary mb-8">Financial Tracker</h1>
          
          {/* Total Balance Card */}
          <div className="bg-primary text-white rounded-lg p-6 mb-8 shadow-lg">
            <h2 className="text-lg opacity-90 mb-2">Total Balance</h2>
            <p className="text-5xl font-bold">${totalBalance.toFixed(2)}</p>
          </div>

          {/* Accounts Grid */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-navy mb-4">Accounts</h2>
            {accounts.length === 0 ? (
              <div className="bg-white rounded-lg p-8 text-center">
                <p className="text-gray mb-4">No accounts yet. Add your first account!</p>
                <button
                  onClick={() => setShowAddAccount(true)}
                  className="bg-primary text-white px-6 py-2 rounded-lg hover:opacity-90"
                >
                  Add Account
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {accounts.map(account => (
                  <div key={account.id} className="bg-white rounded-lg p-6 shadow hover:shadow-lg transition">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-navy">{account.name}</h3>
                      <span className="text-xs bg-lime text-primary px-2 py-1 rounded">{account.type}</span>
                    </div>
                    <p className="text-3xl font-bold text-primary">${Number(account.balance).toFixed(2)}</p>
                    <p className="text-sm text-gray mt-1">{account.currency}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Transactions */}
          <div>
            <h2 className="text-2xl font-bold text-navy mb-4">Recent Transactions</h2>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              {transactions.length === 0 ? (
                <p className="p-6 text-gray">No transactions yet</p>
              ) : (
                <div className="divide-y">
                  {transactions.slice(0, 10).map(transaction => (
                    <div key={transaction.id} className="p-4 hover:bg-beige transition">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="font-medium text-navy">{transaction.description || 'No description'}</p>
                          <p className="text-sm text-gray">{transaction.transaction_date}</p>
                        </div>
                        <p className={`text-lg font-bold ${Number(transaction.amount) >= 0 ? 'text-lime' : 'text-accent'}`}>
                          {Number(transaction.amount) >= 0 ? '+' : ''}{Number(transaction.amount).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Add Button */}
      <FloatingAddButton
        onAddAccount={() => setShowAddAccount(true)}
        onAddTransaction={() => setShowAddTransaction(true)}
      />

      {/* Modals */}
      <AddAccountModal
        isOpen={showAddAccount}
        onClose={() => setShowAddAccount(false)}
        onSuccess={loadData}
      />
      <AddTransactionModal
        isOpen={showAddTransaction}
        onClose={() => setShowAddTransaction(false)}
        onSuccess={loadData}
      />
    </>
  );
};

export default Dashboard;