import React from 'react';

export const DashboardSkeleton: React.FC = () => (
  <div className="md:ml-60 min-h-screen pb-44 md:pb-10" style={{ backgroundColor: 'var(--bg)' }}>
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

export const AccountTypeIcon: React.FC<{ type: string }> = ({ type }) => {
  const colorMap: Record<string, string> = {
    checking: 'var(--accent)',
    savings: 'var(--pos)',
    credit_card: 'var(--neg)',
    investment: '#a855f7',
    cash: '#f59e0b',
  };
  const color = colorMap[type] ?? 'var(--accent)';
  return (
    <div
      className="w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center shrink-0"
      style={{ backgroundColor: `${color}18`, border: `1px solid ${color}35` }}
    >
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}90` }} />
    </div>
  );
};
