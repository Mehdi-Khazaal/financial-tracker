import React from 'react';
import CommandPalette from '../../components/CommandPalette';
import { AuthProvider } from '../../context/AuthContext';
import { TabProvider } from '../../context/TabContext';
import { ToastProvider } from '../../context/ToastContext';
import { UIProvider } from '../../context/UIContext';
import { flush as flushMutations } from '../../utils/mutationQueue';

type AppProvidersProps = {
  children: React.ReactNode;
};

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  React.useEffect(() => {
    // Drain any mutations left over from the previous session (offline queue
    // that never got a chance to submit before the tab closed). Safe because
    // the backend caches every response by Idempotency-Key for 24h.
    void flushMutations();
  }, []);

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
