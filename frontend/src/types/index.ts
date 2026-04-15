export interface Account {
  id: number;
  user_id: number;
  name: string;
  type: 'checking' | 'savings' | 'credit_card' | 'cash' | 'investment';
  balance: number;
  credit_limit: number | null;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  user_id: number | null;
  name: string;
  type: 'income' | 'expense';
  color: string;
  is_system: boolean;
  created_at: string;
}

export interface Transaction {
  id: number;
  user_id: number;
  account_id: number;
  category_id: number | null;
  amount: number;
  description: string | null;
  transaction_date: string;
  created_at: string;
}

export interface Transfer {
  id: number;
  user_id: number;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  note: string | null;
  transfer_date: string;
  created_at: string;
}

export interface Asset {
  id: number;
  user_id: number;
  name: string;
  type: string;
  asset_class: 'investment' | 'physical';
  quantity: number | null;
  value_per_unit: number | null;
  total_value: number;
  currency: string;
  purchase_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavingsGoal {
  id: number;
  user_id: number;
  account_id: number | null;
  name: string;
  target_amount: number;
  deadline: string | null;
  created_at: string;
}

export type RecurringPeriod = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTransaction {
  id: number;
  user_id: number;
  account_id: number;
  category_id: number | null;
  amount: number;
  description: string | null;
  period: RecurringPeriod;
  next_date: string;
  is_active: boolean;
  is_variable: boolean;
  created_at: string;
}

export interface MonthSnapshot {
  month: string;
  net_worth?: number;
  accounts?: number;
  balance?: number;
}

export interface Loan {
  id: number;
  user_id: number;
  borrower_name: string;
  amount: number;
  amount_repaid: number;
  note: string | null;
  loan_date: string;
  due_date: string | null;
  status: 'active' | 'repaid' | 'written_off';
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  email: string;
  username: string;
  created_at: string;
}
