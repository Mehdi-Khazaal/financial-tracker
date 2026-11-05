import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../types';
import { firstRows } from './timeline';

const tx = (id: number): Transaction => ({
  id, user_id: 1, account_id: 1, category_id: null, amount: -1, description: `t${id}`,
  transaction_date: '2026-11-01', created_at: '',
});
const days = [
  { date: '2026-11-03', transactions: [tx(1), tx(2), tx(3)] },
  { date: '2026-11-02', transactions: [tx(4), tx(5)] },
  { date: '2026-11-01', transactions: [tx(6)] },
];

describe('firstRows', () => {
  it('keeps whole days until the count runs out, then cuts the last one', () => {
    const shown = firstRows(days, 4);
    expect(shown.map(s => [s.day.date, s.rows.map(r => r.id)])).toEqual([
      ['2026-11-03', [1, 2, 3]],
      ['2026-11-02', [4]],
    ]);
    expect(shown[1].day.transactions).toHaveLength(2);
  });

  it('shows everything when the count is large, and nothing when it is zero', () => {
    expect(firstRows(days, 100).flatMap(s => s.rows)).toHaveLength(6);
    expect(firstRows(days, 0)).toEqual([]);
  });
});
