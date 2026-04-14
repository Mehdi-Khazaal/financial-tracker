import React, { useEffect, useState } from 'react';
import { Account } from '../types';
import { getAccounts, deleteAccount } from '../utils/api';
import Navigation from '../components/Navigation';
import FloatingAddButton from '../components/FloatingAddButton';
import AddAccountModal from '../components/AddAccountModal';

const Accounts: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const response = await getAccounts();
      setAccounts(response.data);
    } catch (error) {
      console.error('Failed to load accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete "${name}"? This will also delete all associated transactions.`)) {
      return;
    }

    try {
      await deleteAccount(id);
      loadAccounts();
    } catch (error) {
      console.error('Failed to delete account:', error);
      alert('Failed to delete account');
    }
  };

  const accountsByType = accounts.reduce((acc, account) => {
    const type = account.type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(account);
    return acc;
  }, {} as Record<string, Account[]>);

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
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-4xl font-bold text-primary">Accounts</h1>
            <button
              onClick={() => setShowAddAccount(true)}
              className="bg-primary text-white px-6 py-2 rounded-lg hover:opacity-90 hidden md:block"
            >
              Add Account
            </button>
          </div>

          {accounts.length === 0 ? (
            <div className="bg-white rounded-lg p-12 text-center">
              <p className="text-xl text-gray mb-6">No accounts yet</p>
              <button
                onClick={() => setShowAddAccount(true)}
                className="bg-primary text-white px-8 py-3 rounded-lg hover:opacity-90"
              >
                Create Your First Account
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(accountsByType).map(([type, typeAccounts]) => (
                <div key={type}>
                  <h2 className="text-2xl font-bold text-navy mb-4 capitalize">
                    {type.replace('_', ' ')} ({typeAccounts.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {typeAccounts.map(account => (
                      <div key={account.id} className="bg-white rounded-lg p-6 shadow hover:shadow-lg transition">
                        <div className="flex justify-between items-start mb-4">
                          <div>
                            <h3 className="text-xl font-bold text-navy mb-1">{account.name}</h3>
                            <span className="text-xs bg-lime text-primary px-2 py-1 rounded">
                              {account.type.replace('_', ' ')}
                            </span>
                          </div>
                        </div>

                        <div className="mb-4">
                          <p className="text-4xl font-bold text-primary">
                            ${Number(account.balance).toFixed(2)}
                          </p>
                          <p className="text-sm text-gray mt-1">{account.currency}</p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDelete(account.id, account.name)}
                            className="flex-1 px-4 py-2 bg-accent text-white rounded-lg hover:opacity-90 transition"
                          >
                            Delete
                          </button>
                        </div>

                        <div className="mt-4 pt-4 border-t border-beige text-xs text-gray">
                          <p>Created: {new Date(account.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <FloatingAddButton
        onAddAccount={() => setShowAddAccount(true)}
        onAddTransaction={() => {}}
      />

      <AddAccountModal
        isOpen={showAddAccount}
        onClose={() => setShowAddAccount(false)}
        onSuccess={loadAccounts}
      />
    </>
  );
};

export default Accounts;