import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '⊞' },
  { path: '/accounts', label: 'Accounts', icon: '🏦' },
  { path: '/transactions', label: 'Transactions', icon: '↕' },
  { path: '/investments', label: 'Investments', icon: '📈' },
  { path: '/assets', label: 'Assets', icon: '🏠' },
  { path: '/analytics', label: 'Analytics', icon: '◉' },
];

const Navigation: React.FC = () => {
  const location = useLocation();
  const { logout, user } = useAuth();
  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-navy">
        <div className="flex items-center h-16 px-6 border-b border-white border-opacity-10">
          <div className="w-8 h-8 bg-lime rounded-lg flex items-center justify-center mr-3">
            <span className="text-primary font-bold text-sm">FT</span>
          </div>
          <h1 className="text-lg font-bold text-white">Financial Tracker</h1>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center px-4 py-2.5 rounded-xl transition-all text-sm font-medium ${
                isActive(item.path)
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-white text-opacity-70 hover:bg-white hover:bg-opacity-10 hover:text-white'
              }`}
            >
              <span className="text-lg mr-3 w-6 text-center">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-white border-opacity-10">
          <div className="flex items-center mb-3 px-2">
            <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
              {user?.username.charAt(0).toUpperCase()}
            </div>
            <div className="ml-3 min-w-0">
              <p className="text-white font-medium text-sm truncate">{user?.username}</p>
              <p className="text-white text-opacity-50 text-xs truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full px-4 py-2 bg-white bg-opacity-10 text-white text-sm rounded-lg hover:bg-opacity-20 transition"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-navy border-t border-white border-opacity-10 z-30">
        <div className="flex justify-around items-center h-16 px-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 ${
                isActive(item.path) ? 'text-lime' : 'text-white text-opacity-60'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span className="text-[9px] font-medium leading-none">{item.label.split(' ')[0]}</span>
            </Link>
          ))}
          <button
            onClick={logout}
            className="flex flex-col items-center justify-center flex-1 h-full gap-0.5 text-white text-opacity-60"
          >
            <span className="text-base leading-none">⎋</span>
            <span className="text-[9px] font-medium leading-none">Logout</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default Navigation;
