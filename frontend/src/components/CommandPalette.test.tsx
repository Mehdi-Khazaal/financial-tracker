import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import CommandPalette from './CommandPalette';

const { mockNavigate, mockSetRouteTab, mockSetPaletteOpen } = vi.hoisted(() => ({
  mockNavigate: vi.fn(), mockSetRouteTab: vi.fn(), mockSetPaletteOpen: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn(), user: { username: 'k', is_admin: false } }) }));
vi.mock('../context/TabContext', async () => {
  const ReactModule = await import('react');
  return { TabContext: ReactModule.createContext({ setRouteTab: mockSetRouteTab }) };
});
vi.mock('../context/UIContext', () => ({
  useUI: () => ({ paletteOpen: true, setPaletteOpen: mockSetPaletteOpen, privacy: false, togglePrivacy: vi.fn() }),
  requestQuickAction: vi.fn(),
}));

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

const type = (value: string) => fireEvent.change(screen.getByPlaceholderText('Type a command or search…'), { target: { value } });

describe('CommandPalette search', () => {
  it('offers a ledger search for whatever was typed, after any matching commands', () => {
    render(<CommandPalette />);
    type('trans');
    const items = screen.getAllByRole('button').map(b => b.textContent);
    expect(items.some(label => label === 'Transactions')).toBe(true);
    expect(items[items.length - 1]).toBe('Search transactions for “trans”');
  });

  it('leads with the search when nothing else matches, and Enter runs it', () => {
    render(<CommandPalette />);
    type('netflix');
    expect(screen.getByText('Search transactions for “netflix”')).toBeInTheDocument();
    expect(screen.queryByText(/No results/)).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText('Type a command or search…'), { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/transactions?tab=list&q=netflix');
    expect(mockSetRouteTab).toHaveBeenCalledWith('/transactions?tab=list&q=netflix', 'list');
    expect(mockSetPaletteOpen).toHaveBeenCalledWith(false);
  });

  it('shows no search entry for an empty query', () => {
    render(<CommandPalette />);
    expect(screen.queryByText(/Search transactions for/)).not.toBeInTheDocument();
  });
});
