import type { Account, Category, Transaction } from '../../../types';
import { buildClassificationContext, classifyTransaction, KIND_LABELS } from './transactions';
import { calculatePeriodMetrics } from './metrics';
import { selectableCategories } from '../../../components/modals/categoryOptions';

/**
 * Transfers between your own accounts are neither income nor spending.
 *
 * On the live account every card payment from checking had been deleted after
 * import: filed as anything else it counted as spending, and there was no
 * category that kept it out. Deleting the rows broke every account's history.
 * A \`transfer\` category keeps the row and leaves it out of every total.
 */

const CHECKING = 1;
const CARD = 2;
const FOOD = 10;
const SALARY = 11;
const TRANSFER = 12;

const accounts: Account[] = [
  { id: CHECKING, user_id: 1, name: 'Spend', type: 'checking', balance: 693.28, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: CARD, user_id: 1, name: 'VentureOne', type: 'credit_card', balance: -384.92, credit_limit: 2750, currency: 'USD', created_at: '', updated_at: '' },
];
const categories: Category[] = [
  { id: FOOD, user_id: 1, name: 'Food', type: 'expense', color: '#e11', is_system: false, created_at: '' },
  { id: SALARY, user_id: 1, name: 'Salary', type: 'income', color: '#1e1', is_system: false, created_at: '' },
  { id: TRANSFER, user_id: 1, name: 'Transfer', type: 'transfer', color: '#888', is_system: true, created_at: '' },
];
const ctx = buildClassificationContext(accounts, categories);

let nextId = 1;
const tx = (amount: number, category_id: number | null, account_id = CHECKING): Transaction => ({
  id: nextId++, user_id: 1, account_id, category_id, amount,
  description: 'Entry', transaction_date: '2026-11-03', created_at: '',
});

describe('a transfer category', () => {
  it('is a transfer in both directions, on any account', () => {
    expect(classifyTransaction(tx(-384.92, TRANSFER), ctx)).toBe('transfer');
    expect(classifyTransaction(tx(384.92, TRANSFER, CARD), ctx)).toBe('transfer');
    expect(classifyTransaction(tx(1500, TRANSFER), ctx)).toBe('transfer');
  });

  it('says what it is wherever a kind is labelled', () => {
    expect(KIND_LABELS.transfer).toBe('Transfer');
  });

  it('leaves income, spending and the savings rate exactly as they were', () => {
    const base = [tx(3000, SALARY), tx(-200, FOOD, CARD)];
    const withPayment = [...base, tx(-384.92, TRANSFER), tx(384.92, TRANSFER, CARD)];

    const before = calculatePeriodMetrics(base, ctx);
    const after = calculatePeriodMetrics(withPayment, ctx);

    expect(after.income).toBe(before.income);
    expect(after.expenses).toBe(before.expenses);
    expect(after.savingsRate).toBe(before.savingsRate);
    expect(after.uncategorizedCount).toBe(0);
  });

  it('is what an uncategorized bank-side payment would otherwise have been: spending', () => {
    const metrics = calculatePeriodMetrics([tx(-384.92, null)], ctx);
    expect(metrics.expenses).toBeCloseTo(384.92, 2);
  });

  it('is offered in the picker for money out and money in', () => {
    expect(selectableCategories(categories, 'expense').map(c => c.name)).toEqual(['Food', 'Transfer']);
    expect(selectableCategories(categories, 'income').map(c => c.name)).toEqual(['Salary', 'Transfer']);
  });
});
