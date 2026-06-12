import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const PRIVACY_KEY = 'ft_privacy';

type UIContextType = {
  privacy: boolean;
  togglePrivacy: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
};

const UIContext = createContext<UIContextType>({
  privacy: false,
  togglePrivacy: () => {},
  paletteOpen: false,
  setPaletteOpen: () => {},
});

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [privacy, setPrivacy] = useState(() => localStorage.getItem(PRIVACY_KEY) === '1');
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('privacy-on', privacy);
    localStorage.setItem(PRIVACY_KEY, privacy ? '1' : '0');
  }, [privacy]);

  const togglePrivacy = useCallback(() => setPrivacy(p => !p), []);

  return (
    <UIContext.Provider value={{ privacy, togglePrivacy, paletteOpen, setPaletteOpen }}>
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => useContext(UIContext);

/* Quick actions requested from the command palette are handed to the Dashboard
   through sessionStorage so they survive the navigation to "/" */
export const QUICK_ACTION_KEY = 'ft_pending_action';
export type QuickAction = 'expense' | 'income' | 'transfer';

export const requestQuickAction = (action: QuickAction) => {
  sessionStorage.setItem(QUICK_ACTION_KEY, action);
  window.dispatchEvent(new CustomEvent('ft:quick-action'));
};

export const consumeQuickAction = (): QuickAction | null => {
  const a = sessionStorage.getItem(QUICK_ACTION_KEY) as QuickAction | null;
  if (a) sessionStorage.removeItem(QUICK_ACTION_KEY);
  return a;
};
