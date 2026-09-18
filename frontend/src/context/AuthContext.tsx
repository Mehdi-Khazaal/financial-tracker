import React, { createContext, useState, useContext, useEffect } from 'react';
import { login as apiLogin, signup as apiSignup, logout as apiLogout, getMe } from '../utils/api';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  signup: (email: string, username: string, password: string, inviteCode?: string) => Promise<void>;
  /** Re-read the session after something server-side changed (e.g. verification). */
  refresh: () => Promise<void>;
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
    await apiLogin(identifier, password);
    const me = await getMe();
    setUser(me.data);
  };

  const signup = async (email: string, username: string, password: string, inviteCode?: string) => {
    await apiSignup(email, username, password, inviteCode);
    const me = await getMe();
    setUser(me.data);
  };

  const refresh = async () => {
    try {
      const me = await getMe();
      setUser(me.data);
    } catch {
      /* keep the current session; a transient failure is not a sign-out */
    }
  };

  const logout = async () => {
    await apiLogout().catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
