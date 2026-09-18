import type { Transaction } from '../../../types';

/**
 * Split drafting, in integer cents.
 *
 * The server insists the lines add up to the transaction exactly, so the
 * editor must agree with it to the cent before it lets anyone press Save.
 * Floats cannot promise that (0.1 + 0.2), so every amount here is parsed
 * from its text straight into whole cents and only ever added as integers.
 */

export interface SplitDraftLine {
  key: string;
  categoryId: string;
  /** Positive amount as typed; the direction comes from the transaction. */
  amount: string;
  note: string;
}

const AMOUNT_TEXT = /^\d+(\.\d{1,2})?$/;

/** "12.5" → 1250. Null when the text is not a plain positive amount. */
export function toCents(text: string): number | null {
  const trimmed = text.trim();
  if (!AMOUNT_TEXT.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 1250 → "12.50", with no float in between. */
export function centsToText(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  return `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** The transaction's size in cents, whatever shape the amount arrived in. */
export function transactionCents(tx: Pick<Transaction, 'amount'>): number {
  return Math.round(Math.abs(Number(tx.amount)) * 100);
}

export interface SplitCheck {
  ok: boolean;
  /** Positive: still to assign. Negative: assigned too much. */
  remainingCents: number;
  problems: string[];
}

export const MIN_SPLIT_LINES = 2;
export const MAX_SPLIT_LINES = 20;

export function checkSplit(totalCents: number, lines: SplitDraftLine[]): SplitCheck {
  const problems: string[] = [];
  let assigned = 0;
  const seen = new Set<string>();
  lines.forEach(line => {
    const cents = toCents(line.amount);
    if (cents === null || cents === 0) problems.push('Every part needs an amount');
    else assigned += cents;
    if (!line.categoryId) problems.push('Every part needs a category');
    else if (seen.has(line.categoryId)) problems.push('Each category can appear once');
    seen.add(line.categoryId);
  });
  if (lines.length < MIN_SPLIT_LINES) problems.push(`A split needs at least ${MIN_SPLIT_LINES} parts`);
  if (lines.length > MAX_SPLIT_LINES) problems.push(`A split can have at most ${MAX_SPLIT_LINES} parts`);
  const remainingCents = totalCents - assigned;
  if (remainingCents !== 0) problems.push(remainingCents > 0 ? 'Some of the amount is not assigned yet' : 'The parts add up to more than the transaction');
  return { ok: problems.length === 0, remainingCents, problems: Array.from(new Set(problems)) };
}

/** Lines in the server's shape: signed decimal strings, direction from the parent. */
export function toSplitPayload(tx: Pick<Transaction, 'amount'>, lines: SplitDraftLine[]) {
  const negative = Number(tx.amount) < 0;
  return lines.map(line => ({
    category_id: Number(line.categoryId),
    amount: `${negative ? '-' : ''}${centsToText(toCents(line.amount) ?? 0)}`,
    note: line.note.trim() || null,
  }));
}

let keySeed = 0;
export const newLineKey = (): string => `line-${Date.now().toString(36)}-${(keySeed += 1)}`;

/** Starting lines: the existing split, or the current category holding everything plus an empty line. */
export function initialLines(tx: Transaction): SplitDraftLine[] {
  if (tx.splits && tx.splits.length > 0) {
    return tx.splits.map(split => ({
      key: newLineKey(),
      categoryId: split.category_id != null ? String(split.category_id) : '',
      amount: centsToText(Math.round(Math.abs(Number(split.amount)) * 100)),
      note: split.note ?? '',
    }));
  }
  return [
    { key: newLineKey(), categoryId: tx.category_id != null ? String(tx.category_id) : '', amount: centsToText(transactionCents(tx)), note: '' },
    { key: newLineKey(), categoryId: '', amount: '', note: '' },
  ];
}

/**
 * Keep the first line holding whatever the others leave, until the person
 * types in it themselves — adding "Household 40" to a $100 shop makes the
 * first line $60 without any arithmetic on their part.
 */
export function rebalanceFirst(totalCents: number, lines: SplitDraftLine[]): SplitDraftLine[] {
  if (lines.length === 0) return lines;
  const others = lines.slice(1).reduce((sum, line) => sum + (toCents(line.amount) ?? 0), 0);
  const first = Math.max(0, totalCents - others);
  return [{ ...lines[0], amount: centsToText(first) }, ...lines.slice(1)];
}
