import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Transactions from './pages/Transactions';
import Investments from './pages/Investments';
import Assets from './pages/Assets';
import Analytics from './pages/Analytics';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <div className="flex items-center justify-center h-screen">
      <div className="text-xl text-primary">Loading...</div>
    </div>;
  }
  
  return user ? <>{children}</> : <Navigate to="/login" />;
};


function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/" element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } />
          <Route path="/accounts" element={
            <PrivateRoute>
              <Accounts />
            </PrivateRoute>
          } />
          <Route path="/transactions" element={
            <PrivateRoute>
              <Transactions />
            </PrivateRoute>
          } />
          <Route path="/investments" element={
            <PrivateRoute>
              <Investments />
            </PrivateRoute>
          } />
          <Route path="/assets" element={
            <PrivateRoute>
              <Assets />
            </PrivateRoute>
          } />
          <Route path="/analytics" element={
            <PrivateRoute>
              <Analytics />
            </PrivateRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;