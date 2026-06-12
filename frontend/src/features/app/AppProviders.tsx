import React from 'react';
import CommandPalette from '../../components/CommandPalette';
import { AuthProvider } from '../../context/AuthContext';
import { TabProvider } from '../../context/TabContext';
import { ToastProvider } from '../../context/ToastContext';
import { UIProvider } from '../../context/UIContext';

type AppProvidersProps = {
  children: React.ReactNode;
};

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <AuthProvider>
      <ToastProvider>
        <TabProvider>
          <UIProvider>
            <CommandPalette />
            {children}
          </UIProvider>
        </TabProvider>
      </ToastProvider>
    </AuthProvider>
  );
};
