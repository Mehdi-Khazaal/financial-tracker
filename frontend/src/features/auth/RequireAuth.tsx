import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

type RequireAuthProps = {
  children: React.ReactNode;
};

const FullScreenLoader: React.FC = () => {
  return (
    <div
      className="flex items-center justify-center"
      style={{ backgroundColor: 'var(--bg)', minHeight: '100dvh' }}
    >
      <div
        className="w-7 h-7 rounded-full border-2 border-t-transparent spin-slow"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
    </div>
  );
};

export const RequireAuth: React.FC<RequireAuthProps> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <FullScreenLoader />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};
