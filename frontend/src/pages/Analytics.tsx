import React, { useEffect, useState } from 'react';
import { PieChart, Pie, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { getTransactions, getAccounts, getCategories, getAssets } from '../utils/api';
import { Transaction, Account, Category, Asset } from '../types';
import Navigation from '../components/Navigation';

const Analytics: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [transactionsRes, accountsRes, categoriesRes, assetsRes] = await Promise.all([
        getTransactions(),
        getAccounts(),
        getCategories(),
        getAssets(),
      ]);
      setTransactions(transactionsRes.data);
      setAccounts(accountsRes.data);
      setCategories(categoriesRes.data);
      setAssets(assetsRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate spending by category
  const spendingByCategory = categories
    .filter(cat => cat.type === 'expense')
    .map(category => {
      const total = transactions
        .filter(t => t.category_id === category.id && Number(t.amount) < 0)
        .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
      return {
        name: category.name,
        value: total,
        color: category.color,
      };
    })
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value);

  // Calculate income by category
  const incomeByCategory = categories
    .filter(cat => cat.type === 'income')
    .map(category => {
      const total = transactions
        .filter(t => t.category_id === category.id && Number(t.amount) > 0)
        .reduce((sum, t) => sum + Number(t.amount), 0);
      return {
        name: category.name,
        value: total,
        color: category.color,
      };
    })
    .filter(item => item.value > 0);

  // Monthly income vs expenses
  const monthlyData = (() => {
    const months: Record<string, { income: number; expenses: number }> = {};
    
    transactions.forEach(t => {
      const month = t.transaction_date.substring(0, 7); // YYYY-MM
      if (!months[month]) months[month] = { income: 0, expenses: 0 };
      
      if (Number(t.amount) > 0) {
        months[month].income += Number(t.amount);
      } else {
        months[month].expenses += Math.abs(Number(t.amount));
      }
    });

    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6) // Last 6 months
      .map(([month, data]) => ({
        month: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        Income: data.income,
        Expenses: data.expenses,
      }));
  })();

  // Total calculations
  const totalIncome = transactions
    .filter(t => Number(t.amount) > 0)
    .reduce((sum, t) => sum + Number(t.amount), 0);
  
  const totalExpenses = transactions
    .filter(t => Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

  const accountsBalance = accounts.reduce((sum, acc) => sum + Number(acc.balance), 0);
  const assetsValue = assets.reduce((sum, asset) => sum + Number(asset.total_value), 0);
  const netWorth = accountsBalance + assetsValue;

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
          <h1 className="text-4xl font-bold text-primary mb-8">Analytics</h1>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Net Worth</p>
              <p className="text-3xl font-bold text-primary">${netWorth.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Total Income</p>
              <p className="text-3xl font-bold text-lime">${totalIncome.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Total Expenses</p>
              <p className="text-3xl font-bold text-accent">${totalExpenses.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-lg p-6 shadow">
              <p className="text-gray text-sm mb-2">Savings Rate</p>
              <p className="text-3xl font-bold text-navy">
                {totalIncome > 0 ? ((1 - totalExpenses / totalIncome) * 100).toFixed(1) : 0}%
              </p>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Spending by Category - Pie Chart */}
            <div className="bg-white rounded-lg p-6 shadow">
              <h2 className="text-xl font-bold text-navy mb-4">Spending by Category</h2>
              {spendingByCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                        data={spendingByCategory}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={(entry: any) => `${entry.name}: ${(entry.percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        >
                      {spendingByCategory.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray text-center py-12">No expense data yet</p>
              )}
            </div>

            {/* Income Sources - Pie Chart */}
            <div className="bg-white rounded-lg p-6 shadow">
              <h2 className="text-xl font-bold text-navy mb-4">Income Sources</h2>
              {incomeByCategory.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                        data={incomeByCategory}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={(entry: any) => `${entry.name}: ${(entry.percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        >
                      {incomeByCategory.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-gray text-center py-12">No income data yet</p>
              )}
            </div>
          </div>

          {/* Income vs Expenses - Bar Chart */}
          <div className="bg-white rounded-lg p-6 shadow mb-8">
            <h2 className="text-xl font-bold text-navy mb-4">Income vs Expenses (Last 6 Months)</h2>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                  <Legend />
                  <Bar dataKey="Income" fill="#BBD151" />
                  <Bar dataKey="Expenses" fill="#B12B24" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray text-center py-12">No monthly data yet</p>
            )}
          </div>

          {/* Top Spending Categories */}
          <div className="bg-white rounded-lg p-6 shadow">
            <h2 className="text-xl font-bold text-navy mb-4">Top Spending Categories</h2>
            {spendingByCategory.length > 0 ? (
              <div className="space-y-4">
                {spendingByCategory.slice(0, 5).map((category, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded" style={{ backgroundColor: category.color }} />
                      <span className="font-medium text-navy">{category.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-accent">${category.value.toFixed(2)}</p>
                      <p className="text-sm text-gray">
                        {((category.value / totalExpenses) * 100).toFixed(1)}% of total
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray text-center py-8">No spending data yet</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Analytics;