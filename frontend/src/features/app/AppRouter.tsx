import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import { APP_ROUTES, LEGACY_REDIRECTS } from '../../lib/routes';

/**
 * Shown while a split-out page is being fetched.
 *
 * Deliberately quiet: a page arrives in a fraction of a second on a warm
 * connection, and a spinner that appears and vanishes that fast reads as a
 * flicker. What it must not be is empty and silent — `role="status"` means a
 * screen reader is told something is happening rather than landing on a blank
 * region.
 */
const RouteFallback: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="min-h-[60vh] flex items-center justify-center"
  >
    <span className="sr-only">Loading page</span>
    <span
      aria-hidden="true"
      className="w-6 h-6 rounded-full border-2 animate-spin"
      style={{ borderColor: 'var(--line)', borderTopColor: 'var(--accent)' }}
    />
  </div>
);

export const AppRouter: React.FC = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {APP_ROUTES.map(({ path, element, requiresAuth }) => (
        <Route
          key={path}
          path={path}
          element={requiresAuth ? <RequireAuth>{element}</RequireAuth> : element}
        />
      ))}

      {LEGACY_REDIRECTS.map(({ from, to }) => (
        <Route key={from} path={from} element={<Navigate to={to} replace />} />
      ))}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
};
