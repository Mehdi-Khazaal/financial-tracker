import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { TabProvider } from './context/TabContext';
import { UIProvider } from './context/UIContext';
import CommandPalette from './components/CommandPalette';
import Dashboard from './pages/Dashboard';
import AccountsPage from './pages/AccountsPage';
import PortfolioPage from './pages/PortfolioPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Transactions from './pages/Transactions';
import Settings from './pages/Settings';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import OAuthCallback from './pages/OAuthCallback';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ backgroundColor: 'var(--bg)', minHeight: '100dvh' }}>
        <div className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow"
          style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
        <TabProvider>
        <UIProvider>
        <CommandPalette />
        <Routes>
          <Route path="/login"           element={<Login />} />
          <Route path="/signup"          element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password"  element={<ResetPassword />} />
          <Route path="/verify-email"    element={<VerifyEmail />} />
          <Route path="/oauth-callback"  element={<OAuthCallback />} />

          {/* Main routes */}
          <Route path="/"             element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/accounts"     element={<PrivateRoute><AccountsPage /></PrivateRoute>} />
          <Route path="/transactions" element={<PrivateRoute><Transactions /></PrivateRoute>} />
          <Route path="/portfolio"    element={<PrivateRoute><PortfolioPage /></PrivateRoute>} />
          <Route path="/settings"     element={<PrivateRoute><Settings /></PrivateRoute>} />

          {/* Legacy redirects */}
          <Route path="/wallet"      element={<Navigate to="/accounts"     replace />} />
          <Route path="/cards"       element={<Navigate to="/accounts"     replace />} />
          <Route path="/loans"       element={<Navigate to="/accounts"     replace />} />
          <Route path="/recurring"   element={<Navigate to="/transactions" replace />} />
          <Route path="/investments" element={<Navigate to="/portfolio"    replace />} />
          <Route path="/assets"      element={<Navigate to="/portfolio"    replace />} />
          <Route path="/savings"     element={<Navigate to="/portfolio"    replace />} />
          <Route path="/analytics"   element={<Navigate to="/"            replace />} />
        </Routes>
        </UIProvider>
        </TabProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
