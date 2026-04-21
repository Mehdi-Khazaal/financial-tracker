import React, { createContext, useContext, useState } from 'react';

const DEFAULTS: Record<string, string> = {
  '/':             'overview',
  '/accounts':     'wallet',
  '/transactions': 'transactions',
  '/portfolio':    'investments',
};

type ContextType = {
  tabs: Record<string, string>;
  setRouteTab: (path: string, tab: string) => void;
};

export const TabContext = createContext<ContextType>({ tabs: DEFAULTS, setRouteTab: () => {} });

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tabs, setTabs] = useState(DEFAULTS);
  const setRouteTab = (path: string, tab: string) =>
    setTabs(prev => ({ ...prev, [path]: tab }));
  return <TabContext.Provider value={{ tabs, setRouteTab }}>{children}</TabContext.Provider>;
};

export const useRouteTab = (path: string): [string, (tab: string) => void] => {
  const { tabs, setRouteTab } = useContext(TabContext);
  return [tabs[path] ?? DEFAULTS[path] ?? '', (tab: string) => setRouteTab(path, tab)];
};
