/**
 * Deep links between pages.
 *
 * Fintrack's five pages each answer one question, and the answer to one is
 * usually the question for another: an account balance leads to "what happened
 * in this account", a category total leads to "how does this compare". Until
 * now every page was a terminal node — an account name was plain text, and the
 * one existing cross-page jump (the Analytics category drawer) dropped the user
 * on an unfiltered transaction list, losing the very context they clicked from.
 *
 * Context travels as query parameters rather than router state, because state
 * is lost on reload and cannot be inspected. The receiving page applies the
 * parameters once on arrival and then clears them, so the URL never lingers
 * describing a filter the user has since changed.
 *
 * Every link here lands somewhere that can actually honour the context. A
 * destination that would ignore it does not get a link.
 */

/** Tab identifiers understood by each route, matching `CONTEXT_TABS`. */
export const ROUTE_TABS = {
  dashboard: { overview: 'overview', analytics: 'analytics' },
  transactions: { timeline: 'list', review: 'transactions', recurring: 'recurring' },
  accounts: { banking: 'wallet', cards: 'cards', loans: 'loans' },
  portfolio: { investments: 'investments', assets: 'assets', savings: 'savings' },
  // Settings is sectioned rather than tabbed — it has no mobile context-tab
  // bar (see `CONTEXT_TABS`, which deliberately omits `/settings`) — but the
  // addressing convention is the same one every other route uses, so a section
  // is reachable by link instead of only by tapping through the shell.
  settings: {
    account: 'account',
    preferences: 'preferences',
    categories: 'categories',
    connections: 'connections',
    admin: 'admin',
  },
} as const;

/** Query keys read by the destination pages. */
export const DEEP_LINK_KEYS = {
  /** Which context tab to open on arrival. */
  tab: 'tab',
  /** Filter the transaction timeline to one account. */
  account: 'account',
  /** Filter the transaction timeline to one category. */
  category: 'category',
  /** Scroll to and highlight one account. */
  focusAccount: 'focusAccount',
  /** Scroll to and highlight one savings goal. */
  focusGoal: 'focusGoal',
} as const;

/** The timeline, filtered to a single account. */
export const linkToAccountTransactions = (accountId: number): string =>
  `/transactions?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.transactions.timeline}&${DEEP_LINK_KEYS.account}=${accountId}`;

/** The timeline, filtered to a single category. */
export const linkToCategoryTransactions = (categoryId: number): string =>
  `/transactions?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.transactions.timeline}&${DEEP_LINK_KEYS.category}=${categoryId}`;

/** The import review queue. */
export const linkToReview = (): string =>
  `/transactions?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.transactions.review}`;

/** The recurring list. */
export const linkToRecurring = (): string =>
  `/transactions?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.transactions.recurring}`;

/** Analytics with one category's detail drawer already open. */
export const linkToCategoryAnalytics = (categoryId: number): string =>
  `/?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.dashboard.analytics}&${DEEP_LINK_KEYS.category}=${categoryId}`;

/** Accounts, on the right tab for the account's type, scrolled to it. */
export const linkToAccount = (accountId: number, isCreditCard = false): string => {
  const tab = isCreditCard ? ROUTE_TABS.accounts.cards : ROUTE_TABS.accounts.banking;
  return `/accounts?${DEEP_LINK_KEYS.tab}=${tab}&${DEEP_LINK_KEYS.focusAccount}=${accountId}`;
};

/** The savings tab, scrolled to one goal. */
export const linkToGoal = (goalId: number): string =>
  `/portfolio?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.portfolio.savings}&${DEEP_LINK_KEYS.focusGoal}=${goalId}`;

/** The savings tab. */
export const linkToSavings = (): string =>
  `/portfolio?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.portfolio.savings}`;

/** The banking tab. */
export const linkToBanking = (): string =>
  `/accounts?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.accounts.banking}`;

/** The cards tab. */
export const linkToCards = (): string =>
  `/accounts?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.accounts.cards}`;

/** One Settings section, addressable directly. */
export const linkToSettingsSection = (
  section: keyof typeof ROUTE_TABS.settings,
): string => `/settings?${DEEP_LINK_KEYS.tab}=${ROUTE_TABS.settings[section]}`;

/** Parse a positive integer id from a query value. Returns null when absent or malformed. */
export const parseIdParam = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
