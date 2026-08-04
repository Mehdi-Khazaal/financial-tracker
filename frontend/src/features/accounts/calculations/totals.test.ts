import type { Account } from '../../../types';
import {
  calculateAccountTotals,
  netWorthFromAccounts,
  sumByTypes,
} from './totals';

/**
 * Account population regressions.
 *
 * The Accounts page used to sum `type !== 'credit_card'`, which dropped card
 * debt and picked up investment accounts. Overview, Analytics and the backend
 * all used `type !== 'investment'`. Both old rules are reproduced here so each
 * assertion states which behaviour changed and why.
 */

let nextId = 1;
const account = (type: Account['type'], balance: number, overrides: Partial<Account> = {}): Account => ({
  id: nextId++,
  user_id: 1,
  name: `${type} account`,
  type,
  balance,
  credit_limit: null,
  currency: 'USD',
  created_at: '',
  updated_at: '',
  ...overrides,
});

/** The Accounts page's old "Total Accounts". */
const oldTotalAccounts = (accounts: Account[]) =>
  accounts.filter(a => a.type !== 'credit_card').reduce((s, a) => s + Number(a.balance), 0);

const portfolio: Account[] = [
  account('checking', 5000),
  account('savings', 12000),
  account('cash', 200),
  account('credit_card', -1500, { credit_limit: 6000 }),
  account('investment', 30000),
];

describe('credit-card debt is included in the account total', () => {
  it('subtracts what is owed instead of ignoring it', () => {
    // 5,000 + 12,000 + 200 − 1,500 = 15,700.
    expect(netWorthFromAccounts(portfolio)).toBeCloseTo(15700, 2);
  });

  it('differs from the old total, which pretended the debt was not there', () => {
    // The old rule summed 5,000 + 12,000 + 200 + 30,000 = 47,200.
    expect(oldTotalAccounts(portfolio)).toBeCloseTo(47200, 2);
    expect(netWorthFromAccounts(portfolio)).toBeLessThan(oldTotalAccounts(portfolio));
  });

  it('falls as debt rises', () => {
    const deeper = portfolio.map(a => (a.type === 'credit_card' ? { ...a, balance: -3000 } : a));

    expect(netWorthFromAccounts(deeper)).toBeCloseTo(14200, 2);
  });

  it('counts a card in credit as a positive balance', () => {
    const overpaid = portfolio.map(a => (a.type === 'credit_card' ? { ...a, balance: 250 } : a));

    expect(netWorthFromAccounts(overpaid)).toBeCloseTo(17450, 2);
  });
});

describe('investment accounts stay out of the account total', () => {
  it('excludes them from net worth, because holdings are counted in Portfolio', () => {
    const withoutInvestment = portfolio.filter(a => a.type !== 'investment');

    expect(netWorthFromAccounts(portfolio))
      .toBeCloseTo(netWorthFromAccounts(withoutInvestment), 6);
  });

  it('reports them separately rather than discarding them', () => {
    expect(calculateAccountTotals(portfolio).investmentAccounts).toBeCloseTo(30000, 2);
  });

  it('keeps them out of the liquid and spendable figures', () => {
    const totals = calculateAccountTotals(portfolio);

    expect(totals.availableToSpend).toBeCloseTo(5200, 2);
    expect(totals.liquid).toBeCloseTo(17200, 2);
  });

  it('is what the old total got wrong in the other direction', () => {
    // The old rule swept brokerage balances into the same figure as cash.
    expect(oldTotalAccounts(portfolio)).toBeGreaterThan(
      netWorthFromAccounts(portfolio) + calculateAccountTotals(portfolio).investmentAccounts,
    );
  });
});

describe('the four populations are distinct and named', () => {
  it('separates net worth from what a goal can be earmarked against', () => {
    const totals = calculateAccountTotals(portfolio);

    // Net worth subtracts the card and drops brokerage: 15,700.
    // Allocatable keeps brokerage and drops the card: 47,200.
    expect(totals.netWorth).toBeCloseTo(15700, 2);
    expect(totals.allocatable).toBeCloseTo(47200, 2);
    expect(totals.allocatable).not.toBeCloseTo(totals.netWorth, 2);
  });

  it('allocatable excludes credit cards, because debt cannot be earmarked', () => {
    const totals = calculateAccountTotals(portfolio);
    const withoutCard = calculateAccountTotals(portfolio.filter(a => a.type !== 'credit_card'));

    expect(totals.allocatable).toBeCloseTo(withoutCard.allocatable, 6);
  });

  it('allocatable includes brokerage, because a goal can point at it', () => {
    expect(calculateAccountTotals(portfolio).allocatable)
      .toBeGreaterThan(calculateAccountTotals(portfolio).liquid);
  });

  it('keeps spendable the tightest of the four', () => {
    const t = calculateAccountTotals(portfolio);

    expect(t.availableToSpend).toBeLessThan(t.liquid);
    expect(t.liquid).toBeLessThan(t.allocatable);
  });
});

describe('the definition matches the rest of the app', () => {
  it('is the same rule Overview and the net-worth endpoint use', () => {
    // `type !== 'investment'` — asserted explicitly so a future edit that
    // narrows or widens the population breaks a test rather than a screen.
    const byRule = portfolio
      .filter(a => a.type !== 'investment')
      .reduce((s, a) => s + Number(a.balance), 0);

    expect(netWorthFromAccounts(portfolio)).toBeCloseTo(byRule, 6);
  });

  it('spendable is checking plus cash', () => {
    expect(sumByTypes(portfolio, ['checking', 'cash'])).toBeCloseTo(5200, 2);
  });

  it('liquid adds savings to that', () => {
    expect(sumByTypes(portfolio, ['checking', 'savings', 'cash'])).toBeCloseTo(17200, 2);
  });
});

describe('card figures', () => {
  it('reports debt as a positive amount owed', () => {
    expect(calculateAccountTotals(portfolio).cardDebt).toBeCloseTo(1500, 2);
  });

  it('computes utilisation against the recorded limit', () => {
    expect(calculateAccountTotals(portfolio).utilization).toBeCloseTo(25, 4);
  });

  it('returns null utilisation when no limit is recorded, never a guess', () => {
    const noLimit = [account('credit_card', -400)];

    expect(calculateAccountTotals(noLimit).utilization).toBeNull();
    expect(calculateAccountTotals(noLimit).creditLimit).toBe(0);
  });

  it('treats a paid-off card as zero owed', () => {
    const paid = [account('credit_card', 0, { credit_limit: 1000 })];

    expect(calculateAccountTotals(paid).cardDebt).toBe(0);
    expect(calculateAccountTotals(paid).utilization).toBe(0);
  });
});

describe('edge cases', () => {
  it('handles no accounts at all', () => {
    const totals = calculateAccountTotals([]);

    expect(totals.netWorth).toBe(0);
    expect(totals.availableToSpend).toBe(0);
    expect(totals.utilization).toBeNull();
    expect(totals.count).toBe(0);
  });

  it('survives a malformed balance without producing NaN', () => {
    const broken = [account('checking', Number.NaN), account('cash', 100)];

    expect(calculateAccountTotals(broken).availableToSpend).toBe(100);
    expect(Number.isFinite(calculateAccountTotals(broken).netWorth)).toBe(true);
  });

  it('counts every account regardless of type', () => {
    expect(calculateAccountTotals(portfolio).count).toBe(5);
  });
});
