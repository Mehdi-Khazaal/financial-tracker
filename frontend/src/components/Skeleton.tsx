import React from 'react';

/**
 * Content-shaped skeleton primitives.
 *
 * The base `<Skeleton>` is a shimmering block; the higher-level components
 * (`<AccountRowSkeleton>`, `<TransactionRowSkeleton>`, `<HeroCardSkeleton>`,
 * etc.) compose those blocks into shapes that mirror the real rendered
 * content — width, padding, hierarchy — so the layout doesn't jump on first
 * paint and the app feels instantly responsive.
 *
 * Respects `prefers-reduced-motion`: the shimmer keyframes stop but the
 * shapes remain, so users still see structure while things load.
 */

interface SkeletonProps {
  /** Explicit width — supports any CSS length. */
  w?: string | number;
  /** Explicit height. */
  h?: string | number;
  /** Tailwind rounded utility to apply (default `rounded-md`). Pass `''` to skip. */
  rounded?: string;
  /** Extra className. */
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({ w, h, rounded = 'rounded-md', className = '', style }) => {
  const merged: React.CSSProperties = {
    width: typeof w === 'number' ? `${w}px` : w,
    height: typeof h === 'number' ? `${h}px` : h,
    ...style,
  };
  return <div className={`skeleton ${rounded} ${className}`} style={merged} aria-hidden="true" />;
};

/** Single transaction row placeholder — matches TransactionCard geometry. */
export const TransactionRowSkeleton: React.FC = () => (
  <div
    className="flex items-center gap-3 px-3 py-3 rounded-xl"
    style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
    aria-hidden="true"
  >
    <Skeleton w={40} h={40} rounded="rounded-xl" />
    <div className="flex-1 min-w-0 space-y-2">
      <Skeleton h={13} w="55%" />
      <Skeleton h={10} w="30%" />
    </div>
    <Skeleton h={16} w={72} />
  </div>
);

/** Account card placeholder — matches AccountsPage card grid. */
export const AccountCardSkeleton: React.FC = () => (
  <div
    className="p-4 rounded-xl space-y-3"
    style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
    aria-hidden="true"
  >
    <div className="flex items-center gap-2.5">
      <Skeleton w={36} h={36} rounded="rounded-xl" />
      <div className="flex-1 space-y-1.5">
        <Skeleton h={12} w="60%" />
        <Skeleton h={9} w="35%" />
      </div>
    </div>
    <Skeleton h={22} w="70%" />
    <div className="flex items-center gap-1.5 pt-1">
      {[0, 1, 2, 3, 4, 5, 6].map(i => (
        <Skeleton key={i} h={4} w={`${8 + i * 2}px`} rounded="rounded-sm" />
      ))}
    </div>
  </div>
);

/** Hero net-worth card placeholder — matches Dashboard hero geometry. */
export const HeroCardSkeleton: React.FC = () => (
  <div
    className="rounded-xl p-6 md:p-8"
    style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)', boxShadow: 'var(--edge-light), var(--shadow-card)' }}
    aria-hidden="true"
  >
    <div className="flex flex-col md:flex-row md:items-start md:gap-12">
      <div className="flex-1 min-w-0 space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton h={10} w={72} />
          <Skeleton h={18} w={110} rounded="rounded-full" />
        </div>
        <Skeleton h={56} w="65%" rounded="rounded-lg" />
        <Skeleton h={52} w="100%" rounded="rounded-md" />
        <div className="flex gap-10 pt-5" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="space-y-2">
            <Skeleton h={9} w={60} />
            <Skeleton h={14} w={90} />
          </div>
          <div className="space-y-2">
            <Skeleton h={9} w={80} />
            <Skeleton h={14} w={110} />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 mt-5 md:mt-0 md:min-w-[280px]">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="p-3 rounded-lg space-y-2" style={{ backgroundColor: 'var(--elev-sub)' }}>
            <Skeleton h={9} w="45%" />
            <Skeleton h={16} w="70%" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/** Full dashboard placeholder — mirrors overview tab layout. */
export const DashboardOverviewSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5">
    <HeroCardSkeleton />
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="p-3 rounded-lg space-y-2" style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }} aria-hidden="true">
          <Skeleton h={9} w="55%" />
          <Skeleton h={14} w="75%" />
        </div>
      ))}
    </div>
    <div className="grid md:grid-cols-[3fr_2fr] gap-6">
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map(i => <AccountCardSkeleton key={i} />)}
        </div>
        <div
          className="p-5 rounded-xl space-y-3"
          style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
          aria-hidden="true"
        >
          <div className="flex items-center justify-between">
            <Skeleton h={12} w={140} />
            <Skeleton h={10} w={60} />
          </div>
          {[0, 1, 2, 3].map(i => <TransactionRowSkeleton key={i} />)}
        </div>
      </div>
      <div className="space-y-4">
        <div
          className="p-5 rounded-xl space-y-3"
          style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
          aria-hidden="true"
        >
          <Skeleton h={12} w={100} />
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-2">
              <div className="flex justify-between">
                <Skeleton h={11} w="40%" />
                <Skeleton h={11} w="20%" />
              </div>
              <Skeleton h={6} w="100%" rounded="rounded-full" />
            </div>
          ))}
        </div>
        <div
          className="p-5 rounded-xl space-y-2.5"
          style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
          aria-hidden="true"
        >
          <Skeleton h={12} w={90} />
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2.5">
                <Skeleton w={8} h={8} rounded="rounded-full" />
                <Skeleton h={11} w={90} />
              </div>
              <Skeleton h={11} w={60} />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

/** Wallet/accounts page placeholder — mirrors AccountsPage hero + card grid. */
export const AccountsPageSkeleton: React.FC = () => (
  <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-5">
    <div
      className="rounded-xl p-5 space-y-3"
      style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
      aria-hidden="true"
    >
      <Skeleton h={9} w={110} />
      <Skeleton h={32} w="55%" />
      <div className="flex gap-6 pt-1">
        <div className="space-y-1.5">
          <Skeleton h={8} w={70} />
          <Skeleton h={12} w={80} />
        </div>
        <div className="space-y-1.5">
          <Skeleton h={8} w={40} />
          <Skeleton h={12} w={30} />
        </div>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {[0, 1, 2, 3, 4, 5].map(i => <AccountCardSkeleton key={i} />)}
    </div>
  </div>
);

/** Transaction list placeholder — for the Transactions page. */
export const TransactionListSkeleton: React.FC<{ count?: number }> = ({ count = 8 }) => (
  <div className="max-w-7xl mx-auto px-4 md:px-8 pt-6 md:pt-8 space-y-4">
    <div className="flex items-center justify-between">
      <Skeleton h={18} w={140} />
      <Skeleton h={32} w={100} rounded="rounded-lg" />
    </div>
    <Skeleton h={44} w="100%" rounded="rounded-xl" />
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => <TransactionRowSkeleton key={i} />)}
    </div>
  </div>
);
