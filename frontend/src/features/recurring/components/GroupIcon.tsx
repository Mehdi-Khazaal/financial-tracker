import React from 'react';
import type { RecurringGroupKey } from '../../../types';

// 20×20 stroke icons, one per group, so a group reads at a glance in a list.
const PATHS: Record<RecurringGroupKey, string> = {
  housing: 'M3.5 9.5L10 4l6.5 5.5M5 8.5V16h10V8.5M8.5 16v-4h3v4',
  utilities: 'M11 3L5.5 11H10l-1 6 5.5-8H10l1-6z',
  phone_internet: 'M7 3h6a1 1 0 011 1v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM9 14.5h2',
  insurance: 'M10 3l6 2.5v4c0 3.6-2.5 6.3-6 7.5-3.5-1.2-6-3.9-6-7.5v-4L10 3z',
  subscriptions: 'M4 10a6 6 0 0110.5-4M16 10a6 6 0 01-10.5 4M14.5 3v3h-3M5.5 17v-3h3',
  loans_cards: 'M3 6h14v9H3zM3 9h14M6 12.5h3',
  transport: 'M4.5 13V9l1.8-4h7.4l1.8 4v4M4.5 13h11M4.5 13v2M15.5 13v2M7 11h.01M13 11h.01',
  healthcare: 'M10 16.5s-6-3.6-6-8.2A3.3 3.3 0 0110 6.4a3.3 3.3 0 016 1.9c0 4.6-6 8.2-6 8.2zM10 8.5v4M8 10.5h4',
  other: 'M5 10h.01M10 10h.01M15 10h.01',
  income: 'M10 15.5V4.5m0 0L5.5 9M10 4.5L14.5 9',
};

export const GroupIcon: React.FC<{ group: RecurringGroupKey; size?: number }> = ({ group, size = 18 }) => (
  <span
    className="inline-flex items-center justify-center rounded-lg shrink-0"
    style={{ width: size + 14, height: size + 14, backgroundColor: 'var(--elev-sub)', border: '1px solid var(--line)' }}
    aria-hidden="true"
  >
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[group] ?? PATHS.other} />
    </svg>
  </span>
);
