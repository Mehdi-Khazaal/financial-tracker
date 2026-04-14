export interface Account {
  id: number;
  name: string;
  type: string;
  balance: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  type: 'income' | 'expense';
  color: string;
  created_at: string;
}

export interface Transaction {
  id: number;
  account_id: number;
  category_id: number | null;
  amount: number;
  description: string | null;
  transaction_date: string;
  created_at: string;
}

export interface Asset {
  id: number;
  name: string;
  type: string;
  quantity: number | null;
  value_per_unit: number | null;
  total_value: number;
  currency: string;
  purchase_date: string | null;
  created_at: string;
  updated_at: string;
}