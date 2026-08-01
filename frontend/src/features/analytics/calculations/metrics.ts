/** Period totals: income, expenses, what was saved, and how much is unfiled. */

import type { Transaction } from '../../../types';
import type { ClassificationContext, PeriodMetrics, PeriodRange } from '../types';
import { classifyTransaction } from './transactions';

export const EMPTY_METRICS: PeriodMetrics = {
  income: 0,
  expenses: 0,
  grossExpenses: 0,
  refunds: 0,
  cardPayments: 0,
  net: 0,
  savingsRate: null,
  transactionCount: 0,
  uncategorizedCount: 0,
  uncategorizedSpend: 0,
  largestExpense: null,
  largestIncome: null,
};

/** Transactions falling inside `range`, using inclusive local date strings. */
export function transactionsInRange(transactions: Transaction[], range: PeriodRange): Transaction[] {
  return transactions.filter(t => {
    const day = t.transaction_date.slice(0, 10);
    return day >= range.start && day <= range.end;
  });
}

export function calculatePeriodMetrics(
  transactions: Transaction[],
  ctx: ClassificationContext,
): PeriodMetrics {
  let income = 0;
  let grossExpenses = 0;
  let refunds = 0;
  let cardPayments = 0;
  let uncategorizedCount = 0;
  let uncategorizedSpend = 0;
  let largestExpense: Transaction | null = null;
  let largestIncome: Transaction | null = null;

  transactions.forEach(tx => {
    const amount = Number(tx.amount);
    const kind = classifyTransaction(tx, ctx);

    if (kind === 'income') {
      income += amount;
      if (!largestIncome || amount > Number(largestIncome.amount)) largestIncome = tx;
    } else if (kind === 'expense') {
      const abs = Math.abs(amount);
      grossExpenses += abs;
      if (tx.category_id == null) {
        uncategorizedCount += 1;
        uncategorizedSpend += abs;
      }
      if (!largestExpense || abs > Math.abs(Number(largestExpense.amount))) largestExpense = tx;
    } else if (kind === 'refund') {
      refunds += Math.abs(amount);
    } else if (kind === 'card-payment') {
      cardPayments += amount;
    }
  });

  // Refunds reduce spending. Floor at zero: a period that is net-refunded has
  // no meaningful "negative spend", and letting it go below zero would produce
  // savings rates above 100%.
  const expenses = Math.max(0, grossExpenses - refunds);
  const net = income - expenses;

  return {
    income,
    expenses,
    grossExpenses,
    refunds,
    cardPayments,
    net,
    savingsRate: income > 0 ? net / income : null,
    transactionCount: transactions.length,
    uncategorizedCount,
    uncategorizedSpend,
    largestExpense,
    largestIncome,
  };
}

/** Per-month metrics for every month in `months`, ascending. */
export function monthlyMetrics(
  transactions: Transaction[],
  months: string[],
  ctx: ClassificationContext,
): { month: string; metrics: PeriodMetrics }[] {
  const buckets = new Map<string, Transaction[]>();
  months.forEach(m => buckets.set(m, []));
  transactions.forEach(tx => {
    const bucket = buckets.get(tx.transaction_date.slice(0, 7));
    if (bucket) bucket.push(tx);
  });
  return months.map(month => ({
    month,
    metrics: calculatePeriodMetrics(buckets.get(month) ?? [], ctx),
  }));
}
