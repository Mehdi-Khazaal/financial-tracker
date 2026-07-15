import React from 'react';

export const DashboardSkeleton: React.FC = () => (
  <div>
    <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5">
      <div className="skeleton h-48 w-full rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-12" />)}</div>
      <div className="grid md:grid-cols-[3fr_2fr] gap-6">
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-28" />)}</div>
          <div className="skeleton h-64 w-full" />
        </div>
        <div className="space-y-4">
          <div className="skeleton h-32 w-full" />
          <div className="skeleton h-48 w-full" />
        </div>
      </div>
    </div>
  </div>
);

export const ACCOUNT_TYPE_META: Record<string, { iconPath: string; iconColor: string; label: string; group: string }> = {
  checking:    { iconPath: 'M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4zM18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z', iconColor: 'var(--accent)', label: 'Checking', group: 'Spending' },
  savings:     { iconPath: 'M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267zm4-4.849a3 3 0 11-6 0 3 3 0 016 0z M10 18a8 8 0 100-16 8 8 0 000 16z', iconColor: 'var(--pos)', label: 'Savings', group: 'Savings' },
  credit_card: { iconPath: 'M2 5a2 2 0 012-2h12a2 2 0 012 2v2H2V5zm0 4h16v7a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm3 3a1 1 0 000 2h.01a1 1 0 000-2H5zm2 0a1 1 0 000 2h3a1 1 0 000-2H7z', iconColor: 'var(--neg)', label: 'Credit Card', group: 'Credit' },
  cash:        { iconPath: 'M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z', iconColor: '#f59e0b', label: 'Cash', group: 'Spending' },
  investment:  { iconPath: 'M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z', iconColor: '#a855f7', label: 'Brokerage', group: 'Other' },
};

export const AccountTypeIcon: React.FC<{ type: string; className?: string; iconClassName?: string }> = ({
  type,
  className = 'w-8 h-8 md:w-9 md:h-9',
  iconClassName = 'w-4 h-4',
}) => {
  const meta = ACCOUNT_TYPE_META[type] ?? ACCOUNT_TYPE_META.checking;
  return (
    <div
      className={`${className} rounded-xl flex items-center justify-center shrink-0`}
      style={{ backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
    >
      <svg viewBox="0 0 20 20" fill={meta.iconColor} className={iconClassName}>
        <path d={meta.iconPath} />
      </svg>
    </div>
  );
};
