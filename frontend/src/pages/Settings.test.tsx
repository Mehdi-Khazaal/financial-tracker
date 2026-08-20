import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * Settings behaviour, across the 6.0 → 6A boundary.
 *
 * Every assertion written in Phase 6.0 survives here unchanged. What changed is
 * that reaching a control now requires opening its section, because that is the
 * whole point of 6A — so the *navigation* is new, the expectations are not. If
 * a 6.0 expectation had to be weakened to make the refactor pass, the refactor
 * would be wrong; none were.
 *
 * The suite drives both layouts explicitly via `setViewport`, since only one is
 * rendered at a time (see `useIsDesktop`) and jsdom has no `matchMedia` of its
 * own to decide with.
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

let mockSearchParams = new URLSearchParams();
const mockSetSearchParams = jest.fn();

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings' }),
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

jest.mock('../components/Navigation', () => () => null);

// Plaid Link pulls a CDN script; the page lazy-mounts it for that reason, and
// it has no place in a unit test.
const mockUsePlaidLink = jest.fn(() => ({ open: jest.fn(), ready: true }));
jest.mock('react-plaid-link', () => ({
  usePlaidLink: (...args: unknown[]) => mockUsePlaidLink(...(args as [])),
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

/* eslint-disable import/first */
import Settings from './Settings';
import { RESET_CONFIRMATION } from '../features/settings/hooks/usePlaidConnections';
/* eslint-enable import/first */

// --- Harness -----------------------------------------------------------------

type Viewport = 'mobile' | 'desktop';

const setViewport = (mode: Viewport) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: mode === 'desktop' && query.includes('min-width: 1024px'),
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
};

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
const OTHER_USER = {
  id: 2, username: 'someone', email: 'someone@example.com',
  is_admin: false, is_verified: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { ...mockUser };
  mockSearchParams = new URLSearchParams();
  mockConfirm.mockResolvedValue(true);
  mockUsePlaidLink.mockReturnValue({ open: jest.fn(), ready: true });
  mockApi.getCategories.mockResolvedValue({
    data: [SYSTEM_CATEGORY, CUSTOM_EXPENSE, CUSTOM_CATEGORY, SALARY],
  });
  mockApi.plaidGetItems.mockResolvedValue({ data: [BANK] });
  mockApi.adminGetUsers.mockResolvedValue({ data: [OTHER_USER] });
  mockApi.plaidSyncAll.mockResolvedValue({ data: {} });
  mockApi.plaidReset.mockResolvedValue({ data: { message: 'cleared' } });
  mockApi.plaidCreateLinkToken.mockResolvedValue({ data: { link_token: 'tok' } });
  mockApi.deleteCategory.mockResolvedValue({});
  mockApi.adminResetPassword.mockResolvedValue({});
  mockPush.isPushSupported.mockReturnValue(true);
  mockPush.hasPushSubscription.mockResolvedValue(false);
  mockPush.subscribeToPush.mockResolvedValue(true);
  mockPush.unsubscribeFromPush.mockResolvedValue(undefined);
  setViewport('desktop');
});

/** Render, then open a section by name. Desktop unless told otherwise. */
const openSettings = async (section?: string, viewport: Viewport = 'desktop') => {
  setViewport(viewport);
  const view = render(<Settings />);
  await waitFor(() => expect(mockApi.getCategories).toHaveBeenCalled());
  if (section) {
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('button', { name: section }));
  }
  return view;
};

// --- Shell and navigation (6A) -----------------------------------------------

describe('Settings shell', () => {
  it('shows section navigation on desktop', async () => {
    await openSettings();
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    ['Account', 'Preferences', 'Categories', 'Connections']
      .forEach(label => expect(within(nav).getByRole('button', { name: label })).toBeInTheDocument());
  });

  it('opens on Account by default', async () => {
    await openSettings();
    expect(await screen.findByText('khaza@example.com')).toBeInTheDocument();
  });

  it('marks the open section for assistive technology, not by colour alone', async () => {
    await openSettings();
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: 'Account' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(within(nav).getByRole('button', { name: 'Categories' }));
    expect(within(nav).getByRole('button', { name: 'Categories' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Account' })).not.toHaveAttribute('aria-current');
  });

  it('renders one section at a time, not everything at once', async () => {
    await openSettings();
    // Account is open, so Connections content must not also be mounted.
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument();
  });

  it('renders a single page heading, never one per layout', async () => {
    await openSettings();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Settings mobile shell', () => {
  it('is a section list, not the whole page', async () => {
    await openSettings(undefined, 'mobile');
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('button', { name: /Categories/ })).toBeInTheDocument();
    // The long category list must not be on the landing screen.
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });

  it('summarises what each section holds', async () => {
    await openSettings(undefined, 'mobile');
    expect(await screen.findByText('4 categories')).toBeInTheDocument();
    expect(await screen.findByText('1 connected bank')).toBeInTheDocument();
  });

  it('opens a section when its row is tapped, and can come back', async () => {
    await openSettings(undefined, 'mobile');
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('button', { name: /Categories/ }));

    expect(await screen.findByText('Groceries')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(screen.queryByText('Groceries')).not.toBeInTheDocument());
  });
});

// --- Deep links (6A) ---------------------------------------------------------

describe('Settings deep links', () => {
  it('opens the categories section from ?tab=categories', async () => {
    mockSearchParams = new URLSearchParams('tab=categories');
    await openSettings();
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
  });

  it('opens the connections section from ?tab=connections', async () => {
    mockSearchParams = new URLSearchParams('tab=connections');
    await openSettings();
    expect(await screen.findByRole('button', { name: /sync now/i })).toBeInTheDocument();
  });

  it('opens the admin section for an admin', async () => {
    mockCurrentUser = { ...mockUser, is_admin: true };
    mockSearchParams = new URLSearchParams('tab=admin');
    await openSettings();
    expect(await screen.findByText('someone@example.com')).toBeInTheDocument();
  });

  it('refuses ?tab=admin for a non-admin and falls back to the default', async () => {
    mockSearchParams = new URLSearchParams('tab=admin');
    await openSettings();
    expect(await screen.findByText('khaza@example.com')).toBeInTheDocument();
    expect(screen.queryByText('someone@example.com')).not.toBeInTheDocument();
    expect(mockApi.adminGetUsers).not.toHaveBeenCalled();
  });

  it('falls back safely on an unknown section', async () => {
    mockSearchParams = new URLSearchParams('tab=not-a-section');
    await openSettings();
    expect(await screen.findByText('khaza@example.com')).toBeInTheDocument();
  });

  it('strips the parameter once applied, per the app convention', async () => {
    mockSearchParams = new URLSearchParams('tab=categories');
    await openSettings();
    await waitFor(() => expect(mockSetSearchParams).toHaveBeenCalledWith({}, { replace: true }));
  });
});

// --- Account (6.0 assertions preserved) --------------------------------------

describe('Settings profile', () => {
  it('renders the signed-in identity', async () => {
    await openSettings();
    expect(screen.getByText('khaza')).toBeInTheDocument();
    expect(screen.getByText('khaza@example.com')).toBeInTheDocument();
  });

  it('signs out through the auth context', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mockLogout).toHaveBeenCalled();
  });
});

describe('Settings password section', () => {
  it('is collapsed until opened, and is a real disclosure', async () => {
    await openSettings();
    const toggle = screen.getByRole('button', { expanded: false });
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('is named Password rather than Security', async () => {
    await openSettings();
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });

  it('changes the password', async () => {
    mockApi.changePassword.mockResolvedValue({});
    await openSettings();
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass1234' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => expect(mockApi.changePassword).toHaveBeenCalledWith('OldPass123', 'NewPass1234'));
  });

  it('refuses a mismatched confirmation without calling the API', async () => {
    await openSettings();
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass123' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass1234' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Different123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('New passwords do not match'));
    expect(mockApi.changePassword).not.toHaveBeenCalled();
  });
});

// --- Preferences (6.0 assertions preserved) ----------------------------------

describe('Settings push toggle', () => {
  const openPreferences = () => openSettings('Preferences');

  it('is OFF when permission was granted but no subscription exists', async () => {
    mockPush.hasPushSubscription.mockResolvedValue(false);
    await openPreferences();

    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it('is ON when a subscription exists', async () => {
    mockPush.hasPushSubscription.mockResolvedValue(true);
    await openPreferences();

    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('does not claim a state while it is still checking', async () => {
    let resolve: (value: boolean) => void = () => {};
    mockPush.hasPushSubscription.mockReturnValue(new Promise<boolean>(r => { resolve = r; }));
    await openPreferences();

    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Checking this device…')).toBeInTheDocument();

    resolve(true);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('subscribes when switched on', async () => {
    await openPreferences();
    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).not.toBeDisabled());

    fireEvent.click(toggle);
    await waitFor(() => expect(mockPush.subscribeToPush).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('unsubscribes when switched off', async () => {
    mockPush.hasPushSubscription.mockResolvedValue(true);
    await openPreferences();
    const toggle = await screen.findByRole('switch', { name: 'Push notifications' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));

    fireEvent.click(toggle);
    await waitFor(() => expect(mockPush.unsubscribeFromPush).toHaveBeenCalled());
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
  });

  it('says so when the subscription cannot be read', async () => {
    mockPush.hasPushSubscription.mockRejectedValue(new Error('no service worker'));
    await openPreferences();
    expect(await screen.findByText('Could not check this device')).toBeInTheDocument();
  });
});

// --- Categories (6.0 assertions preserved) -----------------------------------

describe('Settings categories', () => {
  const openCategories = () => openSettings('Categories');

  it('counts each type', async () => {
    await openCategories();
    expect(
      await screen.findByText((_content, element) =>
        element?.textContent === '2 expense · 1 income · 1 investment'),
    ).toBeTruthy();
  });

  it('shows only the selected tab', async () => {
    await openCategories();
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByText('Bullion')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'investment' }));
    expect(screen.getByText('Bullion')).toBeInTheDocument();
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });

  it('offers no edit or delete on a default category', async () => {
    // The backend refuses both — `user_id IS NULL` can never match the owner
    // filter — so rendering the controls guaranteed a failing request.
    await openCategories();
    expect(await screen.findByText('default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Groceries' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Groceries' })).not.toBeInTheDocument();
  });

  it('offers both on a category the user owns', async () => {
    await openCategories();
    expect(await screen.findByRole('button', { name: 'Edit Coffee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Coffee' })).toBeInTheDocument();
  });

  it('confirms before deleting, and names what is lost', async () => {
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Coffee' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockConfirm.mock.calls[0][0]).toMatch(/lose their category/i);
    await waitFor(() => expect(mockApi.deleteCategory).toHaveBeenCalledWith(CUSTOM_EXPENSE.id));
  });

  it('does not delete when the confirm is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Coffee' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi.deleteCategory).not.toHaveBeenCalled();
  });

  it('creates a category on the open tab', async () => {
    mockApi.createCategory.mockResolvedValue({});
    await openCategories();

    fireEvent.change(await screen.findByLabelText('Category name'), { target: { value: 'Coffee Beans' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));

    await waitFor(() => expect(mockApi.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Coffee Beans', type: 'expense' }),
    ));
  });

  it('surfaces a category load failure without pretending the list is empty', async () => {
    mockApi.getCategories.mockRejectedValue(new Error('boom'));
    await openSettings('Categories');
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });

  it('retries the load when asked', async () => {
    mockApi.getCategories.mockRejectedValueOnce(new Error('boom'));
    await openSettings('Categories');
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
  });
});

// --- Connections (6.0 assertions preserved) ----------------------------------

describe('Settings connected banks', () => {
  const openConnections = () => openSettings('Connections');

  it('lists connected institutions', async () => {
    await openConnections();
    expect(await screen.findByText('Capital One')).toBeInTheDocument();
  });

  it('offers Sync Now and calls it', async () => {
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(mockApi.plaidSyncAll).toHaveBeenCalled());
  });

  it('confirms before disconnecting', async () => {
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /disconnect/i }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.plaidDeleteItem).toHaveBeenCalledWith(BANK.id));
  });

  it('does not render a failed load as "no banks connected"', async () => {
    mockApi.plaidGetItems.mockRejectedValue(new Error('boom'));
    await openConnections();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be loaded/i);
    expect(alert).toHaveTextContent(/does not mean they are disconnected/i);
    expect(screen.queryByText('No banks connected yet')).not.toBeInTheDocument();
  });

  it('distinguishes a genuinely empty list from a failure', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [] });
    await openConnections();
    expect(await screen.findByText('No banks connected yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides Sync Now when there is nothing to sync', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [] });
    await openConnections();
    await screen.findByText('No banks connected yet');
    expect(screen.queryByRole('button', { name: /sync now/i })).not.toBeInTheDocument();
  });
});

// --- Reset (6.0 assertions preserved) ----------------------------------------

describe('Settings reset', () => {
  const openConnections = () => openSettings('Connections');

  it('uses the app confirm, not a blocking browser dialog', async () => {
    const nativeConfirm = jest.spyOn(window, 'confirm');
    await openConnections();

    fireEvent.click(await screen.findByRole('button', { name: /reset & start fresh/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it('states the full cost before calling the endpoint', async () => {
    await openConnections();
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
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reset & start fresh/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi.plaidReset).not.toHaveBeenCalled();
  });
});

// --- Plaid Link lazy mount ---------------------------------------------------

describe('Plaid Link launcher', () => {
  it('is not mounted until the user starts connecting', async () => {
    // Mounting `usePlaidLink` eagerly pulls Plaid's CDN script and a persistent
    // preload iframe, which breaks PWA rendering on iOS/Android. The cost is in
    // the hook, so gating `open()` is not a substitute for gating the mount.
    await openSettings('Connections');
    await screen.findByText('Capital One');
    expect(mockUsePlaidLink).not.toHaveBeenCalled();
    expect(mockApi.plaidCreateLinkToken).not.toHaveBeenCalled();
  });

  it('mounts only once Connect Bank is pressed', async () => {
    await openSettings('Connections');
    fireEvent.click(await screen.findByRole('button', { name: /connect bank/i }));
    await waitFor(() => expect(mockUsePlaidLink).toHaveBeenCalled());
  });
});

// --- Admin (6.0 assertions preserved) ----------------------------------------

describe('Settings admin section', () => {
  it('is absent for a normal user, and does not request the user list', async () => {
    await openSettings();
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(mockApi.adminGetUsers).not.toHaveBeenCalled();
  });

  it('is present for an admin', async () => {
    mockCurrentUser = { ...mockUser, is_admin: true };
    await openSettings('Admin');
    expect(await screen.findByText('someone@example.com')).toBeInTheDocument();
  });

  it('confirms, then requests a reset email for the chosen user', async () => {
    mockCurrentUser = { ...mockUser, is_admin: true };
    await openSettings('Admin');

    fireEvent.click(await screen.findByRole('button', { name: /reset pw/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    // The copy must keep saying "email" — an admin never sets a password here.
    expect(mockConfirm.mock.calls[0][0]).toMatch(/reset email/i);
    await waitFor(() => expect(mockApi.adminResetPassword).toHaveBeenCalledWith(OTHER_USER.id));
  });

  it('does not render a failed user load as "no users"', async () => {
    mockCurrentUser = { ...mockUser, is_admin: true };
    mockApi.adminGetUsers.mockRejectedValue(new Error('boom'));
    await openSettings('Admin');

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByText('No users found')).not.toBeInTheDocument();
  });
});

// --- Accessibility -----------------------------------------------------------

describe('Settings accessibility', () => {
  it('announces the category loading state', async () => {
    mockApi.getCategories.mockReturnValue(new Promise(() => {}));
    setViewport('desktop');
    render(<Settings />);
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Categories' }));

    const status = await screen.findByRole('status');
    expect(within(status).getByText('Loading categories')).toBeInTheDocument();
  });

  it('announces the connections loading state', async () => {
    mockApi.plaidGetItems.mockReturnValue(new Promise(() => {}));
    await openSettings('Connections');
    const status = await screen.findByRole('status');
    expect(within(status).getByText('Loading connected banks')).toBeInTheDocument();
  });

  it('gives every section nav entry a real button', async () => {
    await openSettings();
    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    within(nav).getAllByRole('button').forEach(button => {
      expect(button.tagName).toBe('BUTTON');
    });
  });
});
