import React from 'react';

interface Props {
  pulling: boolean;
  refreshing: boolean;
  pullDistance: number;
}

const PullToRefresh: React.FC<Props> = ({ pulling, refreshing, pullDistance }) => {
  if (!pulling && !refreshing) return null;
  const progress = Math.min(pullDistance / 65, 1);

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none transition-all duration-150 md:hidden"
      style={{ paddingTop: `${Math.max(pullDistance, refreshing ? 48 : 0)}px` }}>
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shadow-lg"
        style={{
          backgroundColor: '#0d1018',
          border: '1px solid #1a1f2e',
          opacity: refreshing ? 1 : progress,
          transform: `scale(${0.6 + progress * 0.4})`,
        }}>
        <svg
          viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2.5}
          strokeLinecap="round" className="w-4 h-4"
          style={{
            animation: refreshing ? 'spin-slow .8s linear infinite' : 'none',
            transform: refreshing ? 'none' : `rotate(${progress * 260}deg)`,
          }}>
          <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </div>
    </div>
  );
};

export default PullToRefresh;
