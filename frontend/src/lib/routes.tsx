import React from 'react';
import AccountsPage from '../pages/AccountsPage';
import Assistant from '../pages/Assistant';
import Dashboard from '../pages/Dashboard';
import ForgotPassword from '../pages/ForgotPassword';
import Login from '../pages/Login';
import OAuthCallback from '../pages/OAuthCallback';
import PortfolioPage from '../pages/PortfolioPage';
import ResetPassword from '../pages/ResetPassword';
import Settings from '../pages/Settings';
import Signup from '../pages/Signup';
import Transactions from '../pages/Transactions';
import VerifyEmail from '../pages/VerifyEmail';

export type AppRouteDefinition = {
  path: string;
  element: React.ReactElement;
  requiresAuth?: boolean;
};

export type LegacyRedirectDefinition = {
  from: string;
  to: string;
};

export const APP_ROUTES: AppRouteDefinition[] = [
  { path: '/login', element: <Login /> },
  { path: '/signup', element: <Signup /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/verify-email', element: <VerifyEmail /> },
  { path: '/oauth-callback', element: <OAuthCallback /> },
  { path: '/', element: <Dashboard />, requiresAuth: true },
  { path: '/accounts', element: <AccountsPage />, requiresAuth: true },
  { path: '/transactions', element: <Transactions />, requiresAuth: true },
  { path: '/portfolio', element: <PortfolioPage />, requiresAuth: true },
  { path: '/assistant', element: <Assistant />, requiresAuth: true },
  { path: '/settings', element: <Settings />, requiresAuth: true },
];

export const LEGACY_REDIRECTS: LegacyRedirectDefinition[] = [
  { from: '/wallet', to: '/accounts' },
  { from: '/cards', to: '/accounts' },
  { from: '/loans', to: '/accounts' },
  { from: '/recurring', to: '/transactions' },
  { from: '/investments', to: '/portfolio' },
  { from: '/assets', to: '/portfolio' },
  { from: '/savings', to: '/portfolio' },
  { from: '/analytics', to: '/' },
];
