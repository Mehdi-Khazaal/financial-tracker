/**
 * Financial health score.
 *
 * Every point is traceable. Each factor is a named ratio, normalised against a
 * stated band, weighted, and shown to the user with the measured value and the
 * band that produced it — there is no hidden term. Weights renormalise when a
 * factor doesn't apply (no credit cards, no recurring bills), so the score
 * always sums to 100 rather than silently capping lower.
 *
 * Two deliberate design choices:
 *   • High spending alone can't sink the score. It is measured as a ratio to
 *     income, so a large month funded by a large income is scored fairly.
 *   • Stability uses median absolute deviation, not standard deviation, so one
 *     unusual month — a car, a deposit, a medical bill — doesn't dominate.
 *
 * This is a summary of the user's own numbers, not financial advice, and the
 * UI says so.
 */

import type { Confidence, FinancialHealth, HealthFactor, PeriodMetrics } from '../types';
import { dollars, percent, plural } from '../format';
import { clamp, median } from './transactions';

/** Months of completed history before a score is meaningful. */
export const REQUIRED_MONTHS = 3;
/** Trailing window the score is computed over. */
const WINDOW = 6;

export interface HealthInputs {
  /** Completed months only, ascending. */
  monthly: { month: string; metrics: PeriodMetrics }[];
  /** Checking + savings + cash balances. */
  liquidBalance: number;
  /** Positive dollar amount of credit-card debt. */
  creditCardDebt: number;
  /** Sum of credit limits, or 0 when unknown. */
  creditLimit: number;
  /** Monthly-normalised total of declared recurring expenses. */
  monthlyRecurringExpense: number;
  /** True when the user has at least one credit-card account. */
  hasCreditCards: boolean;
}

/** Map a value onto 0..100 given the band where it scores full and zero marks. */
function band(value: number, zeroAt: number, fullAt: number): number {
  if (fullAt === zeroAt) return 0;
  return clamp(((value - zeroAt) / (fullAt - zeroAt)) * 100, 0, 100);
}

/** Robust spread: median absolute deviation relative to the median. */
function relativeMad(values: number[]): number | null {
  if (values.length < 3) return null;
  const mid = median(values);
  if (mid <= 0) return null;
  const deviations = values.map(v => Math.abs(v - mid));
  return median(deviations) / mid;
}

function scoreWindow(inputs: HealthInputs, months: { month: string; metrics: PeriodMetrics }[]): HealthFactor[] {
  const factors: HealthFactor[] = [];
  const totalIncome = months.reduce((s, m) => s + m.metrics.income, 0);
  const totalExpenses = months.reduce((s, m) => s + m.metrics.expenses, 0);
  const avgIncome = totalIncome / months.length;
  const avgExpenses = totalExpenses / months.length;

  // 1. Savings rate — the single strongest signal of headroom.
  const savingsRate = totalIncome > 0 ? (totalIncome - totalExpenses) / totalIncome : 0;
  factors.push({
    key: 'savings-rate',
    label: 'Savings rate',
    score: band(savingsRate, 0, 0.3),
    weight: 0.28,
    detail: totalIncome > 0
      ? `${percent(savingsRate)} of income kept over ${plural(months.length, 'month')}`
      : 'No income recorded in this window',
    explanation: 'Scores zero at 0% and full at 30% of income kept.',
  });

  // 2. Expense-to-income — measured as a ratio so a big month funded by a big
  //    income is not penalised.
  const ratio = avgIncome > 0 ? avgExpenses / avgIncome : 2;
  factors.push({
    key: 'expense-ratio',
    label: 'Spending vs income',
    score: band(ratio, 1.1, 0.5),
    weight: 0.18,
    detail: avgIncome > 0
      ? `Spending averages ${percent(ratio, 0)} of income`
      : 'No income to compare spending against',
    explanation: 'Full marks at 50% of income or below, zero at 110% — spending more than you earn.',
  });

  // 3. Emergency fund, expressed in months of cover.
  const monthsCover = avgExpenses > 0 ? inputs.liquidBalance / avgExpenses : 0;
  factors.push({
    key: 'emergency-fund',
    label: 'Emergency fund',
    score: band(monthsCover, 0, 6),
    weight: 0.2,
    detail: avgExpenses > 0
      ? `${dollars(inputs.liquidBalance)} in cash covers ${monthsCover.toFixed(1)} months of spending`
      : `${dollars(inputs.liquidBalance)} in cash and savings`,
    explanation: 'Full marks at six months of typical spending held in checking, savings, or cash.',
  });

  // 4. Spending stability, robust to a single unusual month.
  const spread = relativeMad(months.map(m => m.metrics.expenses));
  if (spread != null) {
    factors.push({
      key: 'stability',
      label: 'Spending stability',
      score: band(spread, 0.6, 0.15),
      weight: 0.14,
      detail: `Month-to-month spending varies by about ${percent(spread, 0)}`,
      explanation: 'Measured with median absolute deviation, so one unusual month does not dominate. Full marks below 15% variation.',
    });
  }

  // 5. Recurring burden — how much of income is committed before you decide.
  if (inputs.monthlyRecurringExpense > 0 && avgIncome > 0) {
    const burden = inputs.monthlyRecurringExpense / avgIncome;
    factors.push({
      key: 'recurring-burden',
      label: 'Committed spending',
      score: band(burden, 0.5, 0.15),
      weight: 0.1,
      detail: `${dollars(inputs.monthlyRecurringExpense)} a month in bills is ${percent(burden, 0)} of income`,
      explanation: 'Bills and subscriptions as a share of income. Full marks at 15% or below, zero at 50%.',
    });
  }

  // 6. Debt burden, only when there are credit cards to measure.
  if (inputs.hasCreditCards) {
    const utilisation = inputs.creditLimit > 0
      ? inputs.creditCardDebt / inputs.creditLimit
      : avgIncome > 0 ? inputs.creditCardDebt / (avgIncome * 3) : 1;
    factors.push({
      key: 'debt',
      label: 'Card balances',
      score: band(utilisation, 0.7, 0.1),
      weight: 0.1,
      detail: inputs.creditLimit > 0
        ? `${dollars(inputs.creditCardDebt)} owed is ${percent(utilisation, 0)} of your total limit`
        : `${dollars(inputs.creditCardDebt)} owed across your cards`,
      explanation: inputs.creditLimit > 0
        ? 'Card balances against total credit limit. Full marks at 10% or below.'
        : 'No credit limits recorded, so balances are compared against three months of income.',
    });
  }

  return factors;
}

const labelFor = (score: number): FinancialHealth['label'] =>
  score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs attention';

function weightedScore(factors: HealthFactor[]): number {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0) return 0;
  return factors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight;
}

export function calculateFinancialHealth(inputs: HealthInputs): FinancialHealth {
  const completed = inputs.monthly;

  if (completed.length < REQUIRED_MONTHS) {
    return {
      available: false,
      score: null,
      previousScore: null,
      label: null,
      factors: [],
      strengths: [],
      weaknesses: [],
      monthsOfHistory: completed.length,
      requiredMonths: REQUIRED_MONTHS,
    };
  }

  const window = completed.slice(Math.max(0, completed.length - WINDOW));
  const factors = scoreWindow(inputs, window);
  const score = weightedScore(factors);

  // Same calculation one month back, for the change indicator.
  let previousScore: number | null = null;
  if (completed.length > REQUIRED_MONTHS) {
    const shifted = completed.slice(0, completed.length - 1);
    const prevWindow = shifted.slice(Math.max(0, shifted.length - WINDOW));
    if (prevWindow.length >= REQUIRED_MONTHS) {
      previousScore = weightedScore(scoreWindow(inputs, prevWindow));
    }
  }

  const ranked = [...factors].sort((a, b) => b.score - a.score);

  return {
    available: true,
    score: Math.round(score),
    previousScore: previousScore == null ? null : Math.round(previousScore),
    label: labelFor(score),
    factors,
    strengths: ranked.filter(f => f.score >= 60).slice(0, 3),
    weaknesses: ranked.filter(f => f.score < 60).reverse().slice(0, 3),
    monthsOfHistory: completed.length,
    requiredMonths: REQUIRED_MONTHS,
  };
}

export function healthConfidence(monthsOfHistory: number): Confidence {
  if (monthsOfHistory >= 6) return 'high';
  if (monthsOfHistory >= 4) return 'medium';
  if (monthsOfHistory >= REQUIRED_MONTHS) return 'low';
  return 'none';
}
