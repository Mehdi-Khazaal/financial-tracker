import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../auth/RequireAuth';
import { APP_ROUTES, LEGACY_REDIRECTS } from '../../lib/routes';

export const AppRouter: React.FC = () => {
  return (
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
  );
};
