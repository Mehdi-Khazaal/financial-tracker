import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navigation: React.FC = () => {
  const location = useLocation();
  const { logout, user } = useAuth();

    const navItems = [
    { path: '/', label: 'Dashboard', icon: '📊' },
    { path: '/accounts', label: 'Accounts', icon: '💰' },
    { path: '/transactions', label: 'Transactions', icon: '💳' },
    { path: '/analytics', label: 'Analytics', icon: '📈' },
    { path: '/investments', label: 'Investments', icon: '📉' },
    { path: '/assets', label: 'Assets', icon: '🏠' },
    ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-primary">
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center h-16 px-4 bg-navy">
            <h1 className="text-xl font-bold text-white">Financial Tracker</h1>
          </div>

          <nav className="flex-1 px-2 py-4 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-4 py-3 rounded-lg transition ${
                  isActive(item.path)
                    ? 'bg-lime text-primary font-medium'
                    : 'text-white hover:bg-white hover:bg-opacity-10'
                }`}
              >
                <span className="text-2xl mr-3">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="p-4 border-t border-white border-opacity-20">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 rounded-full bg-lime flex items-center justify-center text-primary font-bold">
                {user?.username.charAt(0).toUpperCase()}
              </div>
              <div className="ml-3">
                <p className="text-white font-medium">{user?.username}</p>
                <p className="text-sm text-white text-opacity-70">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full px-4 py-2 bg-accent text-white rounded-lg hover:opacity-90 transition"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-primary shadow-lg z-30">
        <div className="flex justify-around items-center h-16">
          {navItems.slice(0, 4).map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center flex-1 h-full ${
                isActive(item.path) ? 'text-lime' : 'text-white'
              }`}
            >
              <span className="text-2xl mb-1">{item.icon}</span>
              <span className="text-xs">{item.label}</span>
            </Link>
          ))}
          <button
            onClick={logout}
            className="flex flex-col items-center justify-center flex-1 h-full text-white"
          >
            <span className="text-2xl mb-1">👋</span>
            <span className="text-xs">Logout</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default Navigation;