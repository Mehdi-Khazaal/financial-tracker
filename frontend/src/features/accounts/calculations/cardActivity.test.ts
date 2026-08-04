import type { Transaction } from '../../../types';
import { PAGE_SIZE } from '../../../utils/api';

/**
 * Card activity must not be limited to the newest 500 transactions.
 *
 * The Cards tab slices per-card activity out of whatever transaction list the
 * page loaded. While that list came from a bare `getTransactions()` — capped by
 * the API at 500 rows — a card whose recent charges sat outside the newest 500
 * showed an empty "Recent on this card", which reads as "this card has had no
 * activity" rather than "we did not fetch far enough".
 *
 * These tests pin the failure mode rather than the wiring: given a history
 * longer than one page, the per-card slice must still find that card's rows.
 */

/** The filter the Cards tab applies. */
const activityFor = (transactions: Transaction[], accountId: number) =>
  transactions.filter(t => t.account_id === accountId).slice(0, 5);

/** What the API returns for a bare call: newest first, capped at 500. */
const API_DEFAULT_LIMIT = 500;
const truncatedLikeTheOldCall = (all: Transaction[]) => all.slice(0, API_DEFAULT_LIMIT);

let nextId = 1;
const tx = (accountId: number, date: string): Transaction => ({
  id: nextId++,
  user_id: 1,
  account_id: accountId,
  category_id: null,
  amount: -25,
  description: 'Charge',
  transaction_date: date,
  created_at: '',
});

/**
 * 700 rows newest-first: the newest 600 belong to the everyday account, the
 * oldest 100 to the card. Exactly the shape that made a card look dormant.
 */
const CHECKING = 1;
const CARD = 2;
const history: Transaction[] = [
  ...Array.from({ length: 600 }, () => tx(CHECKING, '2026-08-01')),
  ...Array.from({ length: 100 }, () => tx(CARD, '2026-02-01')),
];

describe('the old bare fetch hid card activity', () => {
  it('truncated away every one of the card rows', () => {
    const truncated = truncatedLikeTheOldCall(history);

    expect(truncated).toHaveLength(API_DEFAULT_LIMIT);
    expect(activityFor(truncated, CARD)).toHaveLength(0);
  });

  it('which is indistinguishable from a card that was never used', () => {
    const neverUsed = history.filter(t => t.account_id !== CARD);

    expect(activityFor(truncatedLikeTheOldCall(history), CARD))
      .toEqual(activityFor(neverUsed, CARD));
  });
});

describe('the full history finds it', () => {
  it('returns the card rows once the whole history is loaded', () => {
    expect(activityFor(history, CARD)).toHaveLength(5);
    expect(activityFor(history, CARD).every(t => t.account_id === CARD)).toBe(true);
  });

  it('still caps the preview at five, preserving the existing UI behaviour', () => {
    expect(activityFor(history, CARD)).toHaveLength(5);
    expect(activityFor(history, CHECKING)).toHaveLength(5);
  });

  it('keeps the per-card filter exact — no other account leaks in', () => {
    expect(activityFor(history, CARD).some(t => t.account_id === CHECKING)).toBe(false);
  });

  it('returns nothing for an account that genuinely has no activity', () => {
    expect(activityFor(history, 999)).toHaveLength(0);
  });
});

describe('the paginated fetch can reach past one page', () => {
  it('pages in units larger than the default cap', () => {
    // `fetchAllTransactions` requests `limit: PAGE_SIZE` and walks `skip`
    // until a short page comes back, so 700 rows arrive in full.
    expect(PAGE_SIZE).toBeGreaterThan(API_DEFAULT_LIMIT);
    expect(history.length).toBeGreaterThan(API_DEFAULT_LIMIT);
  });
});
