import React from 'react';
import { Skeleton } from '../../../components/Skeleton';

const Panel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`ledger-panel p-4 md:p-5 ${className}`} aria-hidden="true">{children}</div>
);

/**
 * Shaped to the real layout, not a generic grey block — the metric grid, the
 * summary, the two-column middle band and the charts all reserve the space
 * they will occupy, so the page doesn't jump when data lands.
 */
const AnalyticsSkeleton: React.FC = () => (
  <div className="space-y-5 md:space-y-6" role="status" aria-label="Loading analytics">
    <span className="sr-only">Loading your analytics</span>

    {/* Period controls */}
    <div className="flex flex-wrap gap-2">
      {[92, 116, 116, 84, 88].map((w, i) => (
        <Skeleton key={i} h={44} w={w} rounded="rounded-full" />
      ))}
    </div>

    {/* Metric grid */}
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 md:gap-3">
      {[0, 1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="rounded-xl p-3.5 md:p-4 space-y-2.5"
          style={{ backgroundColor: 'var(--elev-1)', border: '1px solid var(--line)' }}
          aria-hidden="true"
        >
          <Skeleton h={9} w="60%" />
          <Skeleton h={16} w="80%" />
          <Skeleton h={14} w={64} rounded="rounded-full" />
        </div>
      ))}
    </div>

    {/* Summary */}
    <Panel>
      <Skeleton h={9} w={140} className="mb-3" />
      <Skeleton h={22} w="55%" className="mb-4" />
      <div className="space-y-2">
        <Skeleton h={12} w="92%" />
        <Skeleton h={12} w="86%" />
        <Skeleton h={12} w="70%" />
      </div>
    </Panel>

    {/* Insights + savings */}
    <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5 md:gap-6 items-start">
      <Panel>
        <Skeleton h={9} w={110} className="mb-3" />
        <Skeleton h={16} w="45%" className="mb-4" />
        <div className="space-y-2.5">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="ledger-cell p-4 flex items-start gap-3"
              aria-hidden="true"
            >
              <Skeleton w={28} h={28} rounded="rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton h={9} w={70} />
                <Skeleton h={13} w="70%" />
                <Skeleton h={11} w="90%" />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <Skeleton h={9} w={80} className="mb-3" />
        <Skeleton h={16} w="60%" className="mb-4" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[0, 1].map(i => (
            <div key={i} className="ledger-cell p-3.5 space-y-2" aria-hidden="true">
              <Skeleton h={9} w="55%" />
              <Skeleton h={20} w="75%" />
            </div>
          ))}
        </div>
        <div className="ledger-cell p-4 space-y-3" aria-hidden="true">
          <Skeleton h={9} w={80} />
          <Skeleton h={14} w="55%" />
          <Skeleton h={5} w="100%" rounded="rounded-full" />
          <div className="flex justify-between">
            <Skeleton h={12} w={70} />
            <Skeleton h={12} w={80} />
          </div>
        </div>
      </Panel>
    </div>

    {/* Charts */}
    <Panel>
      <Skeleton h={9} w={90} className="mb-3" />
      <Skeleton h={16} w="40%" className="mb-4" />
      <Skeleton h={240} w="100%" rounded="rounded-lg" />
    </Panel>

    <div className="grid lg:grid-cols-2 gap-5 md:gap-6 items-start">
      <Panel>
        <Skeleton h={9} w={80} className="mb-3" />
        <Skeleton h={16} w="50%" className="mb-4" />
        <div className="grid gap-5 lg:grid-cols-[190px_1fr] items-center">
          <Skeleton w={190} h={190} rounded="rounded-full" className="mx-auto" />
          <div className="space-y-3 w-full">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="space-y-1.5" aria-hidden="true">
                <Skeleton h={11} w="80%" />
                <Skeleton h={4} w="100%" rounded="rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <Skeleton h={9} w={80} className="mb-3" />
        <Skeleton h={16} w="55%" className="mb-4" />
        <Skeleton h={220} w="100%" rounded="rounded-lg" />
      </Panel>
    </div>
  </div>
);

export default AnalyticsSkeleton;
