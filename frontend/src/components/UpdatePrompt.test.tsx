import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UpdatePrompt from './UpdatePrompt';
import { UPDATE_EVENT } from '../lib/serviceWorker';

describe('UpdatePrompt', () => {
  it('stays hidden until the service worker reports an update', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByText(/new version/i)).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
    });

    expect(screen.getByText(/new version/i)).toBeInTheDocument();
  });

  it('reloads on accept and hides on dismiss', () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { ...original, reload }, writable: true, configurable: true });

    render(<UpdatePrompt />);
    act(() => {
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
    });
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(/new version/i)).toBeNull();

    Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
  });
});
