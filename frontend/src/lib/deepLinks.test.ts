import {
  linkToAccount,
  linkToAccountTransactions,
  linkToBanking,
  linkToCards,
  linkToCategoryAnalytics,
  linkToCategoryTransactions,
  linkToGoal,
  linkToRecurring,
  linkToReview,
  linkToSavings,
  linkToImport,
  linkToNewRule,
  linkToSettingsSection,
  linkToTransactionSearch,
  parseIdParam,
} from './deepLinks';
import { CONTEXT_TABS } from '../components/layout/routeLayout';

/**
 * Deep links are only worth having if the destination honours them, so these
 * tests check two things: that every link carries its context, and that the tab
 * it names is one the destination route actually has. A typo in a tab value
 * would otherwise land the user on a page that silently ignored the parameter —
 * the "dumped on a generic page" failure these links exist to avoid.
 */

const paramsOf = (link: string): URLSearchParams =>
  new URLSearchParams(link.slice(link.indexOf('?') + 1));

const pathOf = (link: string): string => link.split('?')[0];

describe('deep links carry their context', () => {
  it('filters the timeline to an account', () => {
    const link = linkToAccountTransactions(3);

    expect(pathOf(link)).toBe('/transactions');
    expect(paramsOf(link).get('tab')).toBe('list');
    expect(paramsOf(link).get('account')).toBe('3');
  });

  it('filters the timeline to a category', () => {
    const link = linkToCategoryTransactions(10);

    expect(paramsOf(link).get('tab')).toBe('list');
    expect(paramsOf(link).get('category')).toBe('10');
  });

  it('opens Analytics on a specific category', () => {
    const link = linkToCategoryAnalytics(10);

    expect(pathOf(link)).toBe('/');
    expect(paramsOf(link).get('tab')).toBe('analytics');
    expect(paramsOf(link).get('category')).toBe('10');
  });

  it('scrolls Accounts to a specific account, on the right tab for its type', () => {
    expect(paramsOf(linkToAccount(4)).get('tab')).toBe('wallet');
    expect(paramsOf(linkToAccount(4, true)).get('tab')).toBe('cards');
    expect(paramsOf(linkToAccount(4)).get('focusAccount')).toBe('4');
  });

  it('scrolls Portfolio to a specific goal', () => {
    const link = linkToGoal(7);

    expect(pathOf(link)).toBe('/portfolio');
    expect(paramsOf(link).get('tab')).toBe('savings');
    expect(paramsOf(link).get('focusGoal')).toBe('7');
  });
});

describe('recurring', () => {
  it('goes straight to the Recurring page rather than a Transactions tab', () => {
    expect(linkToRecurring()).toBe('/recurring');
  });
});

describe('every link names a tab its destination actually has', () => {
  const cases: [string, string][] = [
    [linkToAccountTransactions(1), '/transactions'],
    [linkToCategoryTransactions(1), '/transactions'],
    [linkToReview(), '/transactions'],
    [linkToCategoryAnalytics(1), '/'],
    [linkToAccount(1), '/accounts'],
    [linkToAccount(1, true), '/accounts'],
    [linkToBanking(), '/accounts'],
    [linkToCards(), '/accounts'],
    [linkToGoal(1), '/portfolio'],
    [linkToSavings(), '/portfolio'],
  ];

  it.each(cases)('%s targets a real tab on %s', (link, route) => {
    const tab = paramsOf(link).get('tab');
    const available = CONTEXT_TABS[route].map(t => t.value);

    expect(pathOf(link)).toBe(route);
    expect(available).toContain(tab);
  });
});

describe('links added in Phase 4', () => {
  it('searches the timeline, encoding whatever was typed', () => {
    expect(linkToTransactionSearch('coffee & bagels')).toBe('/transactions?tab=list&q=coffee%20%26%20bagels');
  });

  it('opens the CSV import sheet on the timeline', () => {
    expect(linkToImport()).toBe('/transactions?tab=list&import=1');
  });

  it('starts a rule prefilled from a transaction, with its category when it has one', () => {
    expect(linkToNewRule('NETFLIX.COM', 7)).toBe('/settings?tab=rules&pattern=NETFLIX.COM&category=7');
    expect(linkToNewRule('Café #1', null)).toBe('/settings?tab=rules&pattern=Caf%C3%A9+%231');
  });

  it('addresses the Rules section directly', () => {
    expect(linkToSettingsSection('rules')).toBe('/settings?tab=rules');
  });

  it('links a card to the Cards tab and a checking account to Banking', () => {
    expect(linkToAccount(3, true)).toBe('/accounts?tab=cards&focusAccount=3');
    expect(linkToAccount(4)).toBe('/accounts?tab=wallet&focusAccount=4');
  });
});

describe('parseIdParam', () => {
  it('accepts a positive integer', () => {
    expect(parseIdParam('12')).toBe(12);
  });

  it('rejects anything that is not a usable id', () => {
    // A hand-edited or truncated URL must not become a filter on id 0 or NaN.
    expect(parseIdParam(null)).toBeNull();
    expect(parseIdParam('')).toBeNull();
    expect(parseIdParam('0')).toBeNull();
    expect(parseIdParam('-3')).toBeNull();
    expect(parseIdParam('1.5')).toBeNull();
    expect(parseIdParam('abc')).toBeNull();
    expect(parseIdParam('3; DROP TABLE')).toBeNull();
  });
});
