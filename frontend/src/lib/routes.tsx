import React from 'react';
import Dashboard from '../pages/Dashboard';
import Login from '../pages/Login';
import Signup from '../pages/Signup';
import { useAuth } from '../context/AuthContext';

/**
 * What loads immediately, and what waits until it is asked for.
 *
 * Everything used to arrive in one bundle, so opening the login screen
 * downloaded the assistant, the portfolio and the whole transaction ledger
 * first. Three pages stay eager because they are the places people actually
 * arrive: `/login`, `/signup`, and the dashboard at `/`. Making the dashboard
 * lazy would put a spinner in front of the most-visited screen in the app to
 * save bytes on a page most sessions load anyway.
 *
 * The rest split out. `AnalyticsTab` is split separately inside the dashboard
 * — it owns the charting library, which is the single largest dependency here
 * and is not needed until someone opens that tab.
 *
 * `React.lazy` needs a default export, which every page here has.
 */
const AccountsPage = React.lazy(() => import('../pages/AccountsPage'));
const Assistant = React.lazy(() => import('../pages/Assistant'));
const ForgotPassword = React.lazy(() => import('../pages/ForgotPassword'));
const OAuthCallback = React.lazy(() => import('../pages/OAuthCallback'));
const PortfolioPage = React.lazy(() => import('../pages/PortfolioPage'));
const RecurringPage = React.lazy(() => import('../pages/RecurringPage'));
const ResetPassword = React.lazy(() => import('../pages/ResetPassword'));
const Settings = React.lazy(() => import('../pages/Settings'));
const Transactions = React.lazy(() => import('../pages/Transactions'));
const VerifyEmail = React.lazy(() => import('../pages/VerifyEmail'));
const Landing = React.lazy(() => import('../pages/Landing'));
const Privacy = React.lazy(() => import('../pages/Privacy'));
const Terms = React.lazy(() => import('../pages/Terms'));

/**
 * `/` is two pages: the dashboard for someone signed in, the public landing
 * page for everyone else. Deciding here — rather than redirecting a visitor
 * to `/login` — is what makes the root URL shareable.
 */
const HomeRoute: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ backgroundColor: 'var(--bg)', minHeight: '100dvh' }} role="status" aria-live="polite">
        <span className="sr-only">Loading</span>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} aria-hidden="true" />
      </div>
    );
  }
  return user ? <Dashboard /> : <Landing />;
};

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
  { path: '/privacy', element: <Privacy /> },
  { path: '/terms', element: <Terms /> },
  { path: '/', element: <HomeRoute /> },
  { path: '/accounts', element: <AccountsPage />, requiresAuth: true },
  { path: '/transactions', element: <Transactions />, requiresAuth: true },
  { path: '/recurring', element: <RecurringPage />, requiresAuth: true },
  { path: '/portfolio', element: <PortfolioPage />, requiresAuth: true },
  { path: '/assistant', element: <Assistant />, requiresAuth: true },
  { path: '/settings', element: <Settings />, requiresAuth: true },
];

export const LEGACY_REDIRECTS: LegacyRedirectDefinition[] = [
  { from: '/wallet', to: '/accounts' },
  { from: '/cards', to: '/accounts' },
  { from: '/loans', to: '/accounts' },
  { from: '/investments', to: '/portfolio' },
  { from: '/assets', to: '/portfolio' },
  { from: '/savings', to: '/portfolio' },
  { from: '/analytics', to: '/' },
];
