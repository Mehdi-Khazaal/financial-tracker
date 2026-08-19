import type { Category } from '../../types';
import { selectableCategories } from './categoryOptions';

/**
 * The picker rule that makes an investment category reachable at all.
 *
 * Both transaction modals derive their direction toggle from the amount sign,
 * so a strict `type === direction` filter hid investment categories from the
 * expense picker — the one place a gold purchase is actually filed — and left
 * a transaction that already held one showing a blank dropdown.
 */

const cat = (id: number, type: Category['type'], name = `Cat ${id}`): Category => ({
  id, user_id: 1, name, type, color: '#fff', is_system: false, created_at: '',
});

const categories = [
  cat(1, 'expense', 'Groceries'),
  cat(2, 'income', 'Salary'),
  cat(3, 'investment', 'Bullion'),
];

describe('selectableCategories', () => {
  it('offers investment categories when filing money out', () => {
    const names = selectableCategories(categories, 'expense').map(c => c.name);
    expect(names).toEqual(['Groceries', 'Bullion']);
  });

  it('offers them when filing money in, because selling is the same category', () => {
    const names = selectableCategories(categories, 'income').map(c => c.name);
    expect(names).toEqual(['Salary', 'Bullion']);
  });

  it('never mixes income and expense categories with each other', () => {
    expect(selectableCategories(categories, 'expense').some(c => c.type === 'income')).toBe(false);
    expect(selectableCategories(categories, 'income').some(c => c.type === 'expense')).toBe(false);
  });

  it('returns nothing when there is nothing to offer', () => {
    expect(selectableCategories([], 'expense')).toEqual([]);
  });
});
