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
    { label: 'Banking', value: 'wallet' },
    { label: 'Cards', value: 'cards' },
    { label: 'Loans', value: 'loans' },
  ],
  '/transactions': [
    { label: 'Timeline', value: 'list' },
    { label: 'Review', value: 'transactions' },
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

