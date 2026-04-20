import React, { createContext, useState, useContext, useEffect } from 'react';
import { login as apiLogin, signup as apiSignup, logout as apiLogout, getMe } from '../utils/api';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  signup: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMe()
      .then(res => setUser(res.data))
      .catch(err => {
        // Only clear the session on explicit 401 — network errors / Render cold-start
        // timeouts should not log the user out
        if (err?.response?.status === 401) setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (identifier: string, password: string) => {
    const res = await apiLogin(identifier, password);
    if (res.data?.access_token) localStorage.setItem('access_token', res.data.access_token);
    const me = await getMe();
    setUser(me.data);
  };

  const signup = async (email: string, username: string, password: string) => {
    await apiSignup(email, username, password);
    const me = await getMe();
    setUser(me.data);
  };

  const logout = async () => {
    await apiLogout().catch(() => {});
    localStorage.removeItem('access_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
