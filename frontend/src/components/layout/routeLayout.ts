export interface ContextTabDefinition {
  label: string;
  value: string;
}

export const CONTEXT_TABS: Record<string, ReadonlyArray<ContextTabDefinition>> = {
  '/': [
    { label: 'Overview', value: 'overview' },
    { label: 'Analytics', value: 'analytics' },
  ],
  '/accounts': [
    { label: 'Wallet', value: 'wallet' },
    { label: 'Cards', value: 'cards' },
    { label: 'Loans', value: 'loans' },
  ],
  '/transactions': [
    { label: 'Board', value: 'transactions' },
    { label: 'List', value: 'list' },
    { label: 'Recurring', value: 'recurring' },
  ],
  '/portfolio': [
    { label: 'Investments', value: 'investments' },
    { label: 'Assets', value: 'assets' },
    { label: 'Savings', value: 'savings' },
  ],
};

export const hasContextTabs = (pathname: string): boolean =>
  (CONTEXT_TABS[pathname]?.length ?? 0) > 0;

