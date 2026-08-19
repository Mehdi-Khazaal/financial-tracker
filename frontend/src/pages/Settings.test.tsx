import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * Characterization of Settings, written before Phase 6A moves it.
 *
 * The page is one 649-line component with no coverage, and 6A is a large
 * structural refactor of exactly that code. These tests describe what it does
 * today so the refactor can be shown to be faithful rather than merely
 * compiling. They deliberately assert on user-visible behaviour — what is on
 * screen, and which request a click produces — not on internal structure, so
 * that moving the markup into sections does not break them.
 *
 * Three of them cover the Phase 6.0 fixes: system categories offer no controls
 * that would fail, the push switch reports the real subscription, and the
 * destructive reset uses the app's confirm rather than the browser's.
 */

// --- Mocks -------------------------------------------------------------------

const mockUser = { id: 1, username: 'khaza', email: 'khaza@example.com', is_admin: false };
let mockCurrentUser: typeof mockUser & { is_admin: boolean } = { ...mockUser };
const mockLogout = jest.fn();

jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockCurrentUser, logout: mockLogout }),
}));

const mockConfirm = jest.fn().mockResolvedValue(true);
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('../context/ToastContext', () => ({
  useToast: () => ({ success: mockToastSuccess, error: mockToastError, confirm: mockConfirm }),
}));

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings' }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

jest.mock('../components/Navigation', () => () => null);

// Plaid Link pulls a CDN script; the page already lazy-mounts it for that
// reason, and it has no place in a unit test.
jest.mock('react-plaid-link', () => ({
  usePlaidLink: () => ({ open: jest.fn(), ready: true }),
}));

const mockApi = {
  getCategories: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  changePassword: jest.fn(),
  adminGetUsers: jest.fn(),
  adminResetPassword: jest.fn(),
  plaidCreateLinkToken: jest.fn(),
  plaidExchangeToken: jest.fn(),
  plaidGetItems: jest.fn(),
  plaidDeleteItem: jest.fn(),
  plaidSyncAll: jest.fn(),
  plaidReset: jest.fn(),
};
jest.mock('../utils/api', () => new Proxy({}, {
  get: (_t, prop: string) => {
    if (prop === '__esModule') return true;
    if (prop === 'default') return { post: jest.fn(), get: jest.fn() };
    return (mockApi as Record<string, jest.Mock>)[prop];
  },
}));

const mockPush = {
  subscribeToPush: jest.fn(),
  unsubscribeFromPush: jest.fn(),
  isPushSupported: jest.fn(),
  hasPushSubscription: jest.fn(),
};
jest.mock('../utils/push', () => ({
  subscribeToPush: (...a: unknown[]) => mockPush.subscribeToPush(...a),
  unsubscribeFromPush: (...a: unknown[]) => mockPush.unsubscribeFromPush(...a),
  isPushSupported: () => mockPush.isPushSupported(),
  hasPushSubscription: () => mockPush.hasPushSubscription(),
}));

// eslint-disable-next-line import/first
import Settings, { RESET_CONFIRMATION } from './Settings';

// --- Fixtures ----------------------------------------------------------------

const SYSTEM_CATEGORY = {
  id: 10, user_id: null, name: 'Groceries', type: 'expense',
  color: '#e11', is_system: true, created_at: '',
};
const CUSTOM_CATEGORY = {
  id: 11, user_id: 1, name: 'Bullion', type: 'investment',
  color: '#f97', is_system: false, created_at: '',
};
const CUSTOM_EXPENSE = {
  id: 12, user_id: 1, name: 'Coffee', type: 'expense',
  color: '#abc', is_system: false, created_at: '',
};
const SALARY = {
  id: 13, user_id: 1, name: 'Salary', type: 'income',
  color: '#1e1', is_system: false, created_at: '',
};

const BANK = { id: 5, institution_name: 'Capital One', created_at: '2026-05-31T00:00:00Z' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { ...mockUser };
  mockConfirm.mockResolvedValue(true);
  mockApi.getCategories.mockResolvedValue({ data: [SYSTEM_CATEGORY, CUSTOM_EXPENSE, CUSTOM_CATEGORY, SALARY] });
  mockApi.plaidGetItems.mockResolvedValue({ data: [BANK] });
  mockApi.adminGetUsers.mockResolvedValue({ data: [] });
  mockApi.plaidSyncAll.mockResolvedValue({ data: {} });
  mockApi.plaidReset.mockResolvedValue({ data: { message: 'cleared' } });
  mockApi.deleteCategory.mockResolvedValue({});
  mockApi.adminResetPassword.mockResolvedValue({});
  mockPush.isPushSupported.mockReturnValue(true);
  mockPush.hasPushSubscription.mockResolvedValue(false);
  mockPush.subscribeToPush.mockResolvedValue(true);
  mockPush.unsubscribeFromPush.mockResolvedValue(undefined);
});

const renderSettings = async () => {
  const view = render(<Settings />);
  await waitFor(() => expect(mockApi.getCategories).toHaveBeenCalled());
  // The list must actually be on screen; awaiting the request alone lets a
  // query race the render.
  await screen.findByText('Groceries');
  return view;
};

// --- Profile and password ----------------------------------------------------

describe('Settings profile', () => {
  it('renders the signed-in identity', async () => {
    await renderSettings();
    expect(screen.getByText('khaza')).toBeInTheDocument();
    expect(screen.getByText('khaza@example.com')).toBeInTheDocument();
  });

  it('signs out through the auth context', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mockLogout).toHaveBeenCalled();
  });
});

describe('Settings password section', () => {
  it('is collapsed until opened, and is a real disclosure', async () => {
    await renderSettings();
    const toggle = screen.getByRole('button', { expanded: false });
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });
});

// --- Push toggle (Phase 6.0 fix) ---------------------------------------------

describe('Settings push toggle', () => {
  it('is OFF when permission was granted but no subscription exists', async () => {
    // The exact state the old `Notification.permission` check got wrong.
    mockPush.hasPushSubscription.mockResolvedValue(false);
    await renderSettings();

    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it('is ON when a subscription exists', async () => {
    mockPush.hasPushSubscription.mockResolvedValue(true);
    await renderSettings();

    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('does not claim a state while it is still checking', async () => {
    let resolve: (value: boolean) => void = () => {};
    mockPush.hasPushSubscription.mockReturnValue(new Promise<boolean>(r => { resolve = r; }));
    await renderSettings();

    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Checking this device…')).toBeInTheDocument();

    resolve(true);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('subscribes when switched on', async () => {
    await renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);
    await waitFor(() => expect(mockPush.subscribeToPush).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('unsubscribes when switched off', async () => {
    mockPush.hasPushSubscription.mockResolvedValue(true);
    await renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

    fireEvent.click(toggle);
    await waitFor(() => expect(mockPush.unsubscribeFromPush).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('says so when the subscription cannot be read', async () => {
    mockPush.hasPushSubscription.mockRejectedValue(new Error('no service worker'));
    await renderSettings();
    expect(await screen.findByText('Could not check this device')).toBeInTheDocument();
  });
});

// --- Categories --------------------------------------------------------------

describe('Settings categories', () => {
  it('counts each type', async () => {
    await renderSettings();
    expect(
      screen.getByText((_content, element) =>
        element?.textContent === '2 expense · 1 income · 1 investment'),
    ).toBeTruthy();
  });

  it('shows only the selected tab', async () => {
    await renderSettings();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByText('Bullion')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'investment' }));
    expect(screen.getByText('Bullion')).toBeInTheDocument();
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });

  it('offers no edit or delete on a default category', async () => {
    // The backend refuses both — `user_id IS NULL` can never match the owner
    // filter — so rendering the controls guaranteed a failing request.
    await renderSettings();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Groceries' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Groceries' })).not.toBeInTheDocument();
  });

  it('offers both on a category the user owns', async () => {
    await renderSettings();
    expect(screen.getByRole('button', { name: 'Edit Coffee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Coffee' })).toBeInTheDocument();
  });

  it('confirms before deleting, and names what is lost', async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Coffee' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm.mock.calls[0][0]).toMatch(/lose their category/i);
    await waitFor(() => expect(mockApi.deleteCategory).toHaveBeenCalledWith(CUSTOM_EXPENSE.id));
  });

  it('does not delete when the confirm is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    await renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Coffee' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi.deleteCategory).not.toHaveBeenCalled();
  });

  it('surfaces a category load failure with a retry', async () => {
    mockApi.getCategories.mockRejectedValue(new Error('boom'));
    render(<Settings />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});

// --- Connected banks ---------------------------------------------------------

describe('Settings connected banks', () => {
  it('lists connected institutions', async () => {
    await renderSettings();
    expect(await screen.findByText('Capital One')).toBeInTheDocument();
  });

  it('offers Sync Now and calls it', async () => {
    await renderSettings();
    const sync = await screen.findByRole('button', { name: /sync now/i });
    fireEvent.click(sync);
    await waitFor(() => expect(mockApi.plaidSyncAll).toHaveBeenCalled());
  });

  it('confirms before disconnecting', async () => {
    await renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /disconnect/i }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.plaidDeleteItem).toHaveBeenCalledWith(BANK.id));
  });
});

// --- Reset & Start Fresh (Phase 6.0 fix) -------------------------------------

describe('Settings reset', () => {
  it('uses the app confirm, not a blocking browser dialog', async () => {
    const nativeConfirm = jest.spyOn(window, 'confirm');
    await renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: /reset & start fresh/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it('states the full cost before calling the endpoint', async () => {
    await renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /reset & start fresh/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    const [message, options] = mockConfirm.mock.calls[0];
    expect(message).toBe(RESET_CONFIRMATION);
    expect(message).toMatch(/deletes every transaction imported/i);
    expect(message).toMatch(/disconnects all connected banks/i);
    expect(message).toMatch(/loses the categories/i);
    expect(message).toMatch(/cannot be undone/i);
    // And it must not imply manual entries are at risk.
    expect(message).toMatch(/added\s+yourself are not affected/i);
    expect(options).toEqual(expect.objectContaining({ danger: true }));

    await waitFor(() => expect(mockApi.plaidReset).toHaveBeenCalled());
  });

  it('does not reset when the confirm is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    await renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /reset & start fresh/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi.plaidReset).not.toHaveBeenCalled();
  });
});

// --- Admin -------------------------------------------------------------------

describe('Settings admin section', () => {
  it('is absent for a normal user, and does not request the user list', async () => {
    await renderSettings();
    expect(screen.queryByText(/admin — all users/i)).not.toBeInTheDocument();
    expect(mockApi.adminGetUsers).not.toHaveBeenCalled();
  });

  it('is present for an admin', async () => {
    mockCurrentUser = { ...mockUser, is_admin: true };
    mockApi.adminGetUsers.mockResolvedValue({
      data: [{ id: 2, username: 'someone', email: 'someone@example.com', is_admin: false, is_verified: true }],
    });
    await renderSettings();

    expect(await screen.findByText(/admin — all users/i)).toBeInTheDocument();
    expect(await screen.findByText('someone@example.com')).toBeInTheDocument();
  });

  it('confirms, then requests a reset email for the chosen user', async () => {
    mockCurrentUser = { ...mockUser, is_admin: true };
    mockApi.adminGetUsers.mockResolvedValue({
      data: [{ id: 2, username: 'someone', email: 'someone@example.com', is_admin: false, is_verified: true }],
    });
    await renderSettings();

    fireEvent.click(await screen.findByRole('button', { name: /reset pw/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    // The copy must keep saying "email" — an admin never sets a password here.
    expect(mockConfirm.mock.calls[0][0]).toMatch(/reset email/i);
    await waitFor(() => expect(mockApi.adminResetPassword).toHaveBeenCalledWith(2));
  });
});

// --- Accessibility -----------------------------------------------------------

describe('Settings accessibility', () => {
  it('announces the category loading state', async () => {
    mockApi.getCategories.mockReturnValue(new Promise(() => {}));
    render(<Settings />);
    const status = await screen.findByRole('status');
    expect(within(status).getByText('Loading categories')).toBeInTheDocument();
  });
});
