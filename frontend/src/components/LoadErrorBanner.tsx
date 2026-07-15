import React from 'react';

interface LoadErrorBannerProps {
  message?: string;
  onRetry: () => void;
}

const LoadErrorBanner: React.FC<LoadErrorBannerProps> = ({
  message = 'Your latest data could not be loaded. Check your connection and try again.',
  onRetry,
}) => (
  <div className="ledger-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-text">Could not refresh this page</p>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{message}</p>
    </div>
    <button type="button" className="header-action header-action--primary shrink-0" onClick={onRetry}>
      Try again
    </button>
  </div>
);

export default LoadErrorBanner;
