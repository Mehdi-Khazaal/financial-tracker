import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../../types';
import { centsToText, checkSplit, initialLines, rebalanceFirst, toCents, toSplitPayload, transactionCents, type SplitDraftLine } from './splits';

const line = (categoryId: string, amount: string, note = ''): SplitDraftLine => ({ key: `${categoryId}-${amount}`, categoryId, amount, note });
const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 1, user_id: 1, account_id: 1, category_id: 10, amount: -100, description: 'COSTCO',
  transaction_date: '2026-07-08', created_at: '', ...over,
});

describe('cents', () => {
  it('parses typed amounts to whole cents without floats', () => {
    expect(toCents('12.5')).toBe(1250);
    expect(toCents('0.1')).toBe(10);
    expect(toCents('33.33')).toBe(3333);
    expect(toCents(' 7 ')).toBe(700);
    expect(toCents('1.234')).toBeNull();
    expect(toCents('-3')).toBeNull();
    expect(toCents('abc')).toBeNull();
  });

  it('formats cents back to text exactly', () => {
    expect(centsToText(1250)).toBe('12.50');
    expect(centsToText(5)).toBe('0.05');
    expect(centsToText(-3333)).toBe('33.33');
    expect(transactionCents({ amount: -100.1 })).toBe(10010);
  });

  it('agrees with the server where floats would not: 0.1 + 0.2 splits of 0.30', () => {
    expect(checkSplit(30, [line('1', '0.1'), line('2', '0.2')]).ok).toBe(true);
  });
});

describe('checkSplit', () => {
  it('reports what is left or over and every problem once', () => {
    expect(checkSplit(10000, [line('1', '60'), line('2', '40')])).toEqual({ ok: true, remainingCents: 0, problems: [] });
    expect(checkSplit(10000, [line('1', '60'), line('2', '30')]).remainingCents).toBe(1000);
    expect(checkSplit(10000, [line('1', '60'), line('2', '50')]).problems).toContain('The parts add up to more than the transaction');
    expect(checkSplit(10000, [line('1', '60'), line('1', '40')]).problems).toContain('Each category can appear once');
    expect(checkSplit(10000, [line('', '60'), line('2', '40')]).problems).toContain('Every part needs a category');
    expect(checkSplit(10000, [line('1', '100')]).problems).toContain('A split needs at least 2 parts');
  });
});

describe('drafting', () => {
  it('starts from the current category holding everything, or from the saved split', () => {
    expect(initialLines(tx()).map(l => [l.categoryId, l.amount])).toEqual([['10', '100.00'], ['', '']]);
    const saved = tx({ splits: [{ id: 1, category_id: 10, amount: '-60.00', note: 'food' }, { id: 2, category_id: 11, amount: '-40.00', note: null }] });
    expect(initialLines(saved).map(l => [l.categoryId, l.amount, l.note])).toEqual([['10', '60.00', 'food'], ['11', '40.00', '']]);
  });

  it('keeps the first line holding the remainder', () => {
    const lines = rebalanceFirst(10000, [line('1', '100.00'), line('2', '40')]);
    expect(lines[0].amount).toBe('60.00');
    expect(rebalanceFirst(10000, [line('1', '0'), line('2', '140')])[0].amount).toBe('0.00');
  });

  it('sends signed decimal strings in the direction of the transaction', () => {
    expect(toSplitPayload({ amount: -100 }, [line('1', '60'), line('2', '40', ' bin bags ')])).toEqual([
      { category_id: 1, amount: '-60.00', note: null },
      { category_id: 2, amount: '-40.00', note: 'bin bags' },
    ]);
    expect(toSplitPayload({ amount: 50 }, [line('3', '25.5'), line('4', '24.5')])[0].amount).toBe('25.50');
  });
});
