import React from 'react';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
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
// Typed to receive the config so tests can drive `onSuccess`/`onExit` exactly
// as react-plaid-link would, which is the only way to exercise the connect
// versus update success branch.
const mockUsePlaidLink = jest.fn((_config?: any) => ({ open: jest.fn(), ready: true }));
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
  plaidCreateUpdateLinkToken: jest.fn(),
  plaidExchangeToken: jest.fn(),
  plaidGetItems: jest.fn(),
  plaidDeleteItem: jest.fn(),
  plaidSyncAll: jest.fn(),
  plaidReset: jest.fn(),
  plaidSyncHealth: jest.fn(),
  plaidSyncStatus: jest.fn(),
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
const BANK_TWO = { id: 6, institution_name: 'PNC', created_at: '2026-05-31T00:00:00Z' };

/** A `/plaid/sync-status` row. Local columns only — no Plaid call behind it. */
const statusRow = (over: Record<string, unknown> = {}) => ({
  id: BANK.id,
  institution_name: 'Capital One',
  last_sync_at: '2026-08-20T18:00:00Z',
  last_sync_ok: true,
  last_sync_error: null,
  last_sync_source: 'webhook',
  last_added_count: 0,
  last_modified_count: 0,
  last_removed_count: 0,
  ...over,
});

/** A healthy row for BANK. Timestamps are relative so they never go stale. */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const healthRow = (over: Record<string, unknown> = {}) => ({
  id: BANK.id,
  institution_name: 'Capital One',
  connected_at: '2026-05-31T00:00:00Z',
  cursor_initialized: true,
  fintrack_last_webhook_at: minutesAgo(10),
  fintrack_last_webhook_code: 'SYNC_UPDATES_AVAILABLE',
  last_sync_at: minutesAgo(8),
  last_sync_source: 'webhook',
  last_sync_ok: true,
  last_sync_error: null,
  last_added_count: 3,
  last_modified_count: 0,
  last_removed_count: 0,
  reachable: true,
  item_error_code: null,
  item_error_type: null,
  login_repair_required: false,
  consent_expiration_time: null,
  plaid_last_successful_update: minutesAgo(11),
  plaid_last_failed_update: null,
  plaid_last_webhook_sent_at: minutesAgo(10),
  plaid_last_webhook_code: 'SYNC_UPDATES_AVAILABLE',
  ...over,
});
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
  mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [healthRow()] } });
  mockApi.plaidSyncStatus.mockResolvedValue({ data: { items: [statusRow()] } });
  mockApi.plaidCreateLinkToken.mockResolvedValue({ data: { link_token: 'tok-connect' } });
  mockApi.plaidCreateUpdateLinkToken.mockResolvedValue({ data: { link_token: 'tok-update' } });
  mockApi.plaidExchangeToken.mockResolvedValue({ data: {} });
  sessionStorage.clear();
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
    expect(screen.queryByRole('button', { name: /sync all now/i })).not.toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: /sync all now/i })).toBeInTheDocument();
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

// --- Category Manager (6B) ---------------------------------------------------
// Every Phase 6.0 assertion is still here; what changed is the shape of the UI
// they reach through. Creating and editing happen in a sheet, and a row's
// actions live behind an overflow menu instead of two permanent buttons.

describe('Settings categories', () => {
  const openCategories = () => openSettings('Categories');

  const openRowMenu = async (name: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `${name} actions` }));
    return screen.getByRole('menu', { name: `${name} actions` });
  };

  it('counts each type on its tab', async () => {
    await openCategories();
    expect(await screen.findByRole('tab', { name: /expense\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /income\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /investment\s*1/ })).toBeInTheDocument();
  });

  it('shows only the selected tab, and says which is selected', async () => {
    await openCategories();
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.queryByText('Bullion')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /expense/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: /investment/ }));
    expect(screen.getByText('Bullion')).toBeInTheDocument();
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /investment/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('offers no actions on a default category, and says why', async () => {
    // Read-only server-side: defaults are seeded per user with a real
    // `user_id`, and the API rejects writes to them with 403.
    await openCategories();
    expect(await screen.findByText('Default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Groceries actions' })).not.toBeInTheDocument();
  });

  it('offers Edit and Delete on a category the user owns', async () => {
    await openCategories();
    const menu = await openRowMenu('Coffee');
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  // --- Search ---------------------------------------------------------------

  it('filters the open type, case-insensitively', async () => {
    await openCategories();
    await screen.findByText('Groceries');

    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'cof' } });
    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.queryByText('Groceries')).not.toBeInTheDocument();
  });

  it('trims the query', async () => {
    await openCategories();
    await screen.findByText('Groceries');
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: '  COFFEE  ' } });
    expect(screen.getByText('Coffee')).toBeInTheDocument();
  });

  it('never searches across types', async () => {
    await openCategories();
    await screen.findByText('Groceries');
    // "Bullion" exists, but under investment.
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'bullion' } });
    expect(screen.queryByText('Bullion')).not.toBeInTheDocument();
  });

  it('names the type and the query when nothing matches', async () => {
    await openCategories();
    await screen.findByText('Groceries');
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'travel' } });
    expect(screen.getByText(/No expense categories match/)).toHaveTextContent('travel');
  });

  it('reports how many are shown without changing the totals', async () => {
    await openCategories();
    await screen.findByText('Groceries');
    fireEvent.change(screen.getByLabelText('Search categories'), { target: { value: 'cof' } });

    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
    // The tab badge still reports the real total.
    expect(screen.getByRole('tab', { name: /expense\s*2/ })).toBeInTheDocument();
  });

  it('does not hit the API while typing', async () => {
    await openCategories();
    await screen.findByText('Groceries');
    const before = mockApi.getCategories.mock.calls.length;

    const field = screen.getByLabelText('Search categories');
    ['c', 'co', 'cof'].forEach(value => fireEvent.change(field, { target: { value } }));

    expect(mockApi.getCategories.mock.calls.length).toBe(before);
  });

  // --- Create ---------------------------------------------------------------

  it('opens a sheet naming the type being created', async () => {
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));
    expect(await screen.findByText('New expense category')).toBeInTheDocument();
  });

  it('creates on the open tab', async () => {
    mockApi.createCategory.mockResolvedValue({});
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Coffee Beans' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(mockApi.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Coffee Beans', type: 'expense' }),
    ));
  });

  it('creates under the tab the user is on, not always expense', async () => {
    mockApi.createCategory.mockResolvedValue({});
    await openCategories();
    fireEvent.click(await screen.findByRole('tab', { name: /investment/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));

    expect(await screen.findByText('New investment category')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Silver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(mockApi.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Silver', type: 'investment' }),
    ));
  });

  it('trims the name before submitting', async () => {
    mockApi.createCategory.mockResolvedValue({});
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '  Coffee Beans  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(mockApi.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Coffee Beans' }),
    ));
  });

  it('sends the chosen colour', async () => {
    mockApi.createCategory.mockResolvedValue({});
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Coffee Beans' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use #10b981 for this category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(mockApi.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ color: '#10b981' }),
    ));
  });

  it('marks the selected colour, not by appearance alone', async () => {
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));
    const swatch = await screen.findByRole('button', { name: 'Use #10b981 for this category' });

    fireEvent.click(swatch);
    expect(swatch).toHaveAttribute('aria-pressed', 'true');
  });

  it('cannot submit an empty name', async () => {
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));
    expect(await screen.findByRole('button', { name: 'Create category' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Create category' })).toBeDisabled();
  });

  it('shows a duplicate-name error against the field, not as a toast', async () => {
    mockApi.createCategory.mockRejectedValue({
      response: { data: { detail: 'You already have a expense category called "Groceries".' } },
    });
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('You already have a expense category called "Groceries".');
    // The sheet stays open so the name can be corrected.
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('associates the error with the name field', async () => {
    mockApi.createCategory.mockRejectedValue({
      response: { data: { detail: 'You already have a expense category called "Groceries".' } },
    });
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    await screen.findByRole('alert');
    const field = screen.getByLabelText('Name');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('aria-describedby', 'category-form-error');
  });

  it('clears the error as soon as the name is edited', async () => {
    mockApi.createCategory.mockRejectedValue({
      response: { data: { detail: 'You already have a expense category called "Groceries".' } },
    });
    await openCategories();
    fireEvent.click(await screen.findByRole('button', { name: '+ New' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));
    await screen.findByRole('alert');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Groceries 2' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // --- Edit -----------------------------------------------------------------

  it('edits a category the user owns', async () => {
    mockApi.updateCategory.mockResolvedValue({});
    await openCategories();
    const menu = await openRowMenu('Coffee');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByText('Edit expense category')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Espresso' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockApi.updateCategory).toHaveBeenCalledWith(
      CUSTOM_EXPENSE.id, expect.objectContaining({ name: 'Espresso' }),
    ));
  });

  it('prefills the existing name and colour', async () => {
    await openCategories();
    const menu = await openRowMenu('Coffee');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('Coffee');
    // '#abc' is not a preset, so the sheet says it is keeping the current one
    // rather than silently showing an unselected palette.
    expect(screen.getByText('Keeping its current colour')).toBeInTheDocument();
  });

  it('shows a duplicate error when renaming onto another category', async () => {
    mockApi.updateCategory.mockRejectedValue({
      response: { data: { detail: 'You already have a expense category called "Groceries".' } },
    });
    await openCategories();
    const menu = await openRowMenu('Coffee');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You already have');
  });

  it('never offers to change the type', async () => {
    await openCategories();
    const menu = await openRowMenu('Coffee');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));

    await screen.findByLabelText('Name');
    // Exact match: the tablist behind the sheet is labelled "Category type",
    // which a loose /type/i would match and make this assertion meaningless.
    expect(screen.queryByLabelText('Type')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  // --- Delete ---------------------------------------------------------------

  it('confirms before deleting, and names the consequence exactly', async () => {
    await openCategories();
    const menu = await openRowMenu('Coffee');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    const [message, options] = mockConfirm.mock.calls[0];
    expect(message).toMatch(/become uncategorized/i);
    expect(message).toMatch(/not deleted/i);
    expect(message).toMatch(/not moved to another category/i);
    expect(message).toMatch(/cannot be undone/i);
    expect(options).toEqual(expect.objectContaining({ danger: true }));

    await waitFor(() => expect(mockApi.deleteCategory).toHaveBeenCalledWith(CUSTOM_EXPENSE.id));
  });

  it('does not delete when the confirm is declined', async () => {
    mockConfirm.mockResolvedValue(false);
    await openCategories();
    const menu = await openRowMenu('Coffee');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockApi.deleteCategory).not.toHaveBeenCalled();
  });

  it('reloads the list after a delete', async () => {
    await openCategories();
    const before = mockApi.getCategories.mock.calls.length;
    const menu = await openRowMenu('Coffee');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(mockApi.deleteCategory).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockApi.getCategories.mock.calls.length).toBeGreaterThan(before));
  });

  // --- Keyboard and load states --------------------------------------------

  it('closes the row menu on Escape and returns focus to its trigger', async () => {
    await openCategories();
    const trigger = await screen.findByRole('button', { name: 'Coffee actions' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Coffee actions' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('announces the row menu as a menu', async () => {
    await openCategories();
    const trigger = await screen.findByRole('button', { name: 'Coffee actions' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
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

  it('offers Sync all now and requests a sync', async () => {
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /sync all now/i }));
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
    expect(screen.queryByRole('button', { name: /sync all now/i })).not.toBeInTheDocument();
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


// --- Connection health (6C-2) ------------------------------------------------
// Read-only diagnostics layered over the bank list. The list itself comes from
// `/plaid/items`, a plain database read; health comes from `/plaid/sync-health`,
// which makes one live Plaid `/item/get` per Item and therefore must never run
// on a Settings page load.

describe('Settings connection health', () => {
  const openConnections = () => openSettings('Connections');

  it('does not request health when Settings opens', async () => {
    await openSettings();
    // Account is the default section; the diagnostics belong to Connections.
    await screen.findByText('khaza@example.com');
    expect(mockApi.plaidSyncHealth).not.toHaveBeenCalled();
  });

  it('requests health only once Connections is opened', async () => {
    await openConnections();
    await waitFor(() => expect(mockApi.plaidSyncHealth).toHaveBeenCalled());
  });

  it('does not request health again when another section is opened', async () => {
    await openSettings('Categories');
    await screen.findByText('Groceries');
    expect(mockApi.plaidSyncHealth).not.toHaveBeenCalled();
  });

  it('shows a healthy connection', async () => {
    await openConnections();
    expect(await screen.findByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText(/Last synced 8 minutes ago/)).toBeInTheDocument();
  });

  it('shows a connection that needs re-authentication, and says what to do', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [healthRow({ login_repair_required: true })] },
    });
    await openConnections();

    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in again/i);
  });

  it('shows a sync issue without dumping the raw error into the card', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [healthRow({ last_sync_ok: false, last_sync_error: 'RuntimeError: boom at 0xdeadbeef' })] },
    });
    await openConnections();

    expect(await screen.findByText('Sync issue')).toBeInTheDocument();
    expect(screen.queryByText(/0xdeadbeef/)).not.toBeInTheDocument();
  });

  it('shows an unreachable item as unavailable rather than broken', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [{ id: BANK.id, institution_name: 'Capital One', connected_at: null, cursor_initialized: true, fintrack_last_webhook_at: null, fintrack_last_webhook_code: null, last_sync_at: null, last_sync_source: null, last_sync_ok: null, last_sync_error: null, last_added_count: null, last_modified_count: null, last_removed_count: null, reachable: false, detail: 'RuntimeError: unreachable' }] },
    });
    await openConnections();

    expect(await screen.findByText('Status unavailable')).toBeInTheDocument();
  });

  it('renders null observability fields as not recorded, never as "never"', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [healthRow({ last_sync_at: null, last_sync_ok: null, fintrack_last_webhook_at: null })] },
    });
    await openConnections();

    expect(await screen.findByText('Last sync not recorded yet')).toBeInTheDocument();
    expect(screen.queryByText(/never synced/i)).not.toBeInTheDocument();
    // A legacy connection with an established cursor is still healthy.
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('joins health to banks by id, not by institution name', async () => {
    // Both banks are called "Bank" — the real fallback when Plaid's institution
    // lookup fails — so only the ids can tell them apart.
    mockApi.plaidGetItems.mockResolvedValue({
      data: [{ ...BANK, institution_name: 'Bank' }, { ...BANK_TWO, institution_name: 'Bank' }],
    });
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: {
        items: [
          healthRow({ id: BANK.id, institution_name: 'Bank', login_repair_required: true }),
          healthRow({ id: BANK_TWO.id, institution_name: 'Bank' }),
        ],
      },
    });
    await openConnections();

    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('still lists every bank when health fails entirely', async () => {
    mockApi.plaidSyncHealth.mockRejectedValue(new Error('boom'));
    await openConnections();

    expect(await screen.findByText('Capital One')).toBeInTheDocument();
    expect(screen.getByText(/status could not be checked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('retries health without reloading the bank list', async () => {
    mockApi.plaidSyncHealth.mockRejectedValueOnce(new Error('boom'));
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Healthy')).toBeInTheDocument();
  });

  it('does not let one missing health row hide the other bank', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [BANK, BANK_TWO] });
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [healthRow({ id: BANK.id })] } });
    await openConnections();

    expect(await screen.findByText('Capital One')).toBeInTheDocument();
    expect(screen.getByText('PNC')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Status unknown')).toBeInTheDocument();
  });

  it('mentions a delivery delay without calling the connection broken', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [healthRow({
        plaid_last_webhook_sent_at: minutesAgo(180),
        fintrack_last_webhook_at: null,
        last_sync_at: minutesAgo(400),
      })] },
    });
    await openConnections();

    expect(await screen.findByText(/updates may be delayed/i)).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });
});

describe('Settings connection details', () => {
  const openConnections = () => openSettings('Connections');

  it('is collapsed until opened, and is a real disclosure', async () => {
    await openConnections();
    const toggle = await screen.findByRole('button', { name: /details/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Last update from your bank')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Last update from your bank')).toBeInTheDocument();
  });

  it('translates the sync source rather than showing the raw value', async () => {
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /details/i }));
    expect(screen.getByText('Your bank')).toBeInTheDocument();
    expect(screen.queryByText('webhook')).not.toBeInTheDocument();
  });

  it('shows the sanitized error only when the sync actually failed', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [healthRow({ last_sync_ok: false, last_sync_error: 'HTTPException: Plaid returned an error' })] },
    });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /details/i }));

    expect(screen.getByText('HTTPException: Plaid returned an error')).toBeInTheDocument();
  });

  it('never renders deployment diagnostics or identifiers', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [healthRow({
        registered_webhook: 'https://api.example.com/plaid/webhook',
        webhook_status: 'mismatched',
      })] },
    });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /details/i }));

    const body = document.body.textContent ?? '';
    expect(body).not.toContain('https://api.example.com/plaid/webhook');
    expect(body).not.toContain('mismatched');
    expect(body).not.toMatch(/access[-_ ]?token/i);
    expect(body).not.toMatch(/cursor:/i);
  });
});

describe('Settings connections guidance', () => {
  it('explains that syncing is automatic and that pending purchases lag', async () => {
    await openSettings('Connections');
    const note = await screen.findByText(/checks for bank updates automatically/i);
    expect(note).toHaveTextContent(/finish pending at your bank/i);
  });

  it('keeps the existing actions working', async () => {
    await openSettings('Connections');

    fireEvent.click(await screen.findByRole('button', { name: /sync all now/i }));
    await waitFor(() => expect(mockApi.plaidSyncAll).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /connect bank/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reset & start fresh/i })).toBeInTheDocument();
  });
});


// --- Honest Sync Now (6C-3) --------------------------------------------------
// `POST /plaid/sync` queues background work and returns before Plaid is
// contacted, so its 200 means "requested". Completion is established by
// watching `/plaid/sync-status` — local columns, no Plaid call — until each
// connection's `last_sync_at` advances past a baseline taken beforehand.

describe('Settings sync now', () => {
  const BASE = '2026-08-20T18:00:00Z';
  const LATER = '2026-08-20T18:09:00Z';

  const openConnections = () => openSettings('Connections');

  /** Flush the microtasks an async chain needs, without advancing the clock. */
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const pressSync = async () => {
    const button = await screen.findByRole('button', { name: /sync all now/i });
    fireEvent.click(button);
    // `start()` reads the baseline and POSTs before scheduling the first poll;
    // ticking the clock before those settle would find no timer at all.
    await flush();
    return button;
  };

  /** Advance past one poll interval and let that poll's promises resolve. */
  const tick = async () => {
    await act(async () => {
      jest.advanceTimersByTime(4_000);
    });
    await flush();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    mockApi.plaidSyncStatus.mockResolvedValue({ data: { items: [statusRow({ last_sync_at: BASE })] } });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('starts idle', async () => {
    await openConnections();
    expect(await screen.findByRole('button', { name: 'Sync all now' })).toBeEnabled();
    expect(screen.queryByText(/sync complete/i)).not.toBeInTheDocument();
  });

  it('takes a baseline before requesting the sync', async () => {
    await openConnections();
    await pressSync();

    await waitFor(() => expect(mockApi.plaidSyncAll).toHaveBeenCalled());
    const statusCallOrder = mockApi.plaidSyncStatus.mock.invocationCallOrder[0];
    const syncCallOrder = mockApi.plaidSyncAll.mock.invocationCallOrder[0];
    expect(statusCallOrder).toBeLessThan(syncCallOrder);
  });

  it('does not claim completion just because the POST returned', async () => {
    await openConnections();
    await pressSync();

    await waitFor(() => expect(mockApi.plaidSyncAll).toHaveBeenCalled());
    // The timestamp has not moved, so nothing has finished.
    expect(screen.queryByText(/sync complete/i)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /checking for updates/i })).toBeDisabled();
  });

  it('never polls sync-health to detect completion', async () => {
    await openConnections();
    const healthCallsBefore = mockApi.plaidSyncHealth.mock.calls.length;
    await pressSync();
    await tick();
    await tick();

    // Health costs a live Plaid /item/get per Item; polling it would be the bug.
    expect(mockApi.plaidSyncHealth.mock.calls.length).toBe(healthCallsBefore);
    expect(mockApi.plaidSyncStatus.mock.calls.length).toBeGreaterThan(1);
  });

  it('completes once the timestamp advances, and reports what arrived', async () => {
    await openConnections();
    await pressSync();

    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: LATER, last_added_count: 3 })] },
    });
    await tick();

    expect(await screen.findByText('Sync complete · 3 new')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync all now' })).toBeEnabled();
  });

  it('says "no new posted transactions" rather than implying everything matches', async () => {
    await openConnections();
    await pressSync();
    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: LATER, last_added_count: 0 })] },
    });
    await tick();

    expect(await screen.findByText(/no new posted transactions/i)).toBeInTheDocument();
  });

  it('does not finish while one bank is still pending', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [BANK, BANK_TWO] });
    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: BASE }), statusRow({ id: BANK_TWO.id, institution_name: 'PNC', last_sync_at: BASE })] },
    });
    await openConnections();
    await pressSync();

    // Only Capital One reports.
    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: LATER }), statusRow({ id: BANK_TWO.id, institution_name: 'PNC', last_sync_at: BASE })] },
    });
    await tick();

    expect(screen.queryByText(/sync complete/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /checking for updates/i })).toBeDisabled();
  });

  it('aggregates across banks once both report', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [BANK, BANK_TWO] });
    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: BASE }), statusRow({ id: BANK_TWO.id, institution_name: 'PNC', last_sync_at: BASE })] },
    });
    await openConnections();
    await pressSync();

    mockApi.plaidSyncStatus.mockResolvedValue({
      data: {
        items: [
          statusRow({ last_sync_at: LATER, last_added_count: 2, last_modified_count: 1 }),
          statusRow({ id: BANK_TWO.id, institution_name: 'PNC', last_sync_at: LATER, last_added_count: 1 }),
        ],
      },
    });
    await tick();

    expect(await screen.findByText('Sync complete · 3 new · 1 updated')).toBeInTheDocument();
    expect(screen.getByText(/Capital One · 2 new · 1 updated/)).toBeInTheDocument();
    expect(screen.getByText(/PNC · 1 new/)).toBeInTheDocument();
  });

  it('reports a partial failure by name without hiding the success', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [BANK, BANK_TWO] });
    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: BASE }), statusRow({ id: BANK_TWO.id, institution_name: 'PNC', last_sync_at: BASE })] },
    });
    await openConnections();
    await pressSync();

    mockApi.plaidSyncStatus.mockResolvedValue({
      data: {
        items: [
          statusRow({ last_sync_at: LATER, last_added_count: 4 }),
          statusRow({ id: BANK_TWO.id, institution_name: 'PNC', last_sync_at: LATER, last_sync_ok: false }),
        ],
      },
    });
    await tick();

    expect(await screen.findByText('Sync finished with an issue on PNC.')).toBeInTheDocument();
    expect(screen.getByText(/Capital One · 4 new/)).toBeInTheDocument();
  });

  it('times out without calling it a failure', async () => {
    await openConnections();
    await pressSync();

    // Nothing ever advances. `record_sync_health` swallows its own write
    // errors, so a real sync can finish without the timestamp moving.
    for (let i = 0; i < 12; i += 1) await tick();

    const message = await screen.findByText(/taking longer than expected/i);
    expect(message).toBeInTheDocument();
    expect(message).toHaveTextContent(/still be updating in the background/i);
    expect(screen.queryByText(/sync failed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument();
  });

  it('stops polling once it times out', async () => {
    await openConnections();
    await pressSync();
    for (let i = 0; i < 12; i += 1) await tick();
    await screen.findByText(/taking longer than expected/i);

    const callsAtTimeout = mockApi.plaidSyncStatus.mock.calls.length;
    await tick();
    await tick();
    expect(mockApi.plaidSyncStatus.mock.calls.length).toBe(callsAtTimeout);
  });

  it('stops polling once it completes', async () => {
    await openConnections();
    await pressSync();
    mockApi.plaidSyncStatus.mockResolvedValue({ data: { items: [statusRow({ last_sync_at: LATER })] } });
    await tick();
    await screen.findByText(/sync complete/i);

    const callsAtCompletion = mockApi.plaidSyncStatus.mock.calls.length;
    await tick();
    await tick();
    expect(mockApi.plaidSyncStatus.mock.calls.length).toBe(callsAtCompletion);
  });

  it('refreshes health exactly once after completion', async () => {
    await openConnections();
    await waitFor(() => expect(mockApi.plaidSyncHealth).toHaveBeenCalledTimes(1));
    await pressSync();

    mockApi.plaidSyncStatus.mockResolvedValue({ data: { items: [statusRow({ last_sync_at: LATER })] } });
    await tick();
    await screen.findByText(/sync complete/i);

    await waitFor(() => expect(mockApi.plaidSyncHealth).toHaveBeenCalledTimes(2));
    await tick();
    expect(mockApi.plaidSyncHealth).toHaveBeenCalledTimes(2);
  });

  it('refuses a second sync while one is running', async () => {
    await openConnections();
    const button = await pressSync();
    await waitFor(() => expect(mockApi.plaidSyncAll).toHaveBeenCalledTimes(1));

    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockApi.plaidSyncAll).toHaveBeenCalledTimes(1);
  });

  it('reports a failed request as a request failure, not a sync failure', async () => {
    mockApi.plaidSyncAll.mockRejectedValue(new Error('offline'));
    await openConnections();
    await pressSync();

    expect(await screen.findByText(/could not request a sync/i)).toBeInTheDocument();
    // Never started, so nothing should be polled.
    const callsAfter = mockApi.plaidSyncStatus.mock.calls.length;
    await tick();
    expect(mockApi.plaidSyncStatus.mock.calls.length).toBe(callsAfter);
  });

  it('handles a connection that had never synced before', async () => {
    mockApi.plaidSyncStatus.mockResolvedValue({ data: { items: [statusRow({ last_sync_at: null })] } });
    await openConnections();
    await pressSync();

    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: LATER, last_added_count: 5 })] },
    });
    await tick();

    expect(await screen.findByText('Sync complete · 5 new')).toBeInTheDocument();
  });

  it('does not hang when a bank is disconnected mid-sync', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [BANK, BANK_TWO] });
    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: BASE }), statusRow({ id: BANK_TWO.id, institution_name: 'PNC', last_sync_at: BASE })] },
    });
    await openConnections();
    await pressSync();

    // PNC vanishes; it can never report, so waiting for it would be pointless.
    mockApi.plaidSyncStatus.mockResolvedValue({
      data: { items: [statusRow({ last_sync_at: LATER, last_added_count: 1 })] },
    });
    await tick();

    expect(await screen.findByText('Sync complete · 1 new')).toBeInTheDocument();
  });

  it('survives a failed poll and keeps waiting', async () => {
    await openConnections();
    await pressSync();

    mockApi.plaidSyncStatus.mockRejectedValueOnce(new Error('flaky'));
    await tick();
    expect(screen.queryByText(/could not request/i)).not.toBeInTheDocument();

    mockApi.plaidSyncStatus.mockResolvedValue({ data: { items: [statusRow({ last_sync_at: LATER })] } });
    await tick();
    expect(await screen.findByText(/sync complete/i)).toBeInTheDocument();
  });

  it('stops polling when the section is left', async () => {
    await openConnections();
    await pressSync();
    await tick();

    const nav = await screen.findByRole('navigation', { name: 'Settings sections' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Account' }));

    const callsAfterUnmount = mockApi.plaidSyncStatus.mock.calls.length;
    await tick();
    await tick();
    expect(mockApi.plaidSyncStatus.mock.calls.length).toBe(callsAfterUnmount);
  });

  it('keeps only one global sync control, not one per bank', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [BANK, BANK_TWO] });
    await openConnections();
    await screen.findByText('Capital One');

    expect(screen.getAllByRole('button', { name: /sync all now/i })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^sync$/i })).not.toBeInTheDocument();
  });

  it('exposes busy state on the button rather than animation alone', async () => {
    await openConnections();
    const button = await pressSync();
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
  });

  it('announces the outcome politely', async () => {
    await openConnections();
    await pressSync();
    mockApi.plaidSyncStatus.mockResolvedValue({ data: { items: [statusRow({ last_sync_at: LATER })] } });
    await tick();

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps the pending-transaction explanation visible', async () => {
    await openConnections();
    expect(await screen.findByText(/finish pending at your bank/i)).toBeInTheDocument();
  });
});


// --- Reconnect / Link update mode (6C-4) -------------------------------------
// Repairing an Item is not connecting a new one. Plaid's update mode reuses the
// existing Item and leaves its access token unchanged, so the public token must
// NOT be exchanged — and `exchange_token` would reject it anyway, since it
// refuses a second Item for an already-connected institution. Getting that
// branch wrong breaks the one flow whose job is to rescue a broken connection.

describe('Settings reconnect', () => {
  const openConnections = () => openSettings('Connections');

  const needsRepair = (over: Record<string, unknown> = {}) => healthRow({
    login_repair_required: true,
    item_error_code: 'ITEM_LOGIN_REQUIRED',
    ...over,
  });

  /** Drive Link to a successful close, as react-plaid-link would. */
  const completeLink = async () => {
    const config = mockUsePlaidLink.mock.calls[mockUsePlaidLink.mock.calls.length - 1][0] as any;
    await act(async () => {
      config.onSuccess('public-token-xyz', { institution: { name: 'PNC' } });
    });
  };

  const cancelLink = async () => {
    const config = mockUsePlaidLink.mock.calls[mockUsePlaidLink.mock.calls.length - 1][0] as any;
    await act(async () => {
      config.onExit(null, {});
    });
  };

  // --- When it appears ------------------------------------------------------

  it('is absent on a healthy connection', async () => {
    await openConnections();
    await screen.findByText('Healthy');
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
  });

  it('appears when Plaid says a sign-in is required', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    expect(await screen.findByRole('button', { name: /reconnect capital one/i })).toBeInTheDocument();
  });

  it('appears from the error code alone, without the flag', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [healthRow({ login_repair_required: false, item_error_code: 'ITEM_LOGIN_REQUIRED' })] },
    });
    await openConnections();
    expect(await screen.findByRole('button', { name: /reconnect/i })).toBeInTheDocument();
  });

  it('is absent for problems a bank login cannot fix', async () => {
    // Unreachable, a failed sync and a generic institution error are all real
    // problems — none is an authentication problem, so update mode would send
    // the user through a login that changes nothing.
    for (const health of [
      { reachable: false },
      { last_sync_ok: false },
      { item_error_code: 'INSTITUTION_DOWN' },
    ]) {
      mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [healthRow(health)] } });
      const view = await openConnections();
      await screen.findByText('Capital One');
      expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('is absent when health could not be read at all', async () => {
    mockApi.plaidSyncHealth.mockRejectedValue(new Error('boom'));
    await openConnections();
    await screen.findByText('Capital One');
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument();
  });

  // --- The token it asks for ------------------------------------------------

  it('requests an update token for that specific connection', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));

    await waitFor(() => expect(mockApi.plaidCreateUpdateLinkToken).toHaveBeenCalledWith(BANK.id));
  });

  it('never requests a new-connection token when repairing', async () => {
    // Using the ordinary endpoint would mint a *second* Item for the same
    // institution, which is exactly what update mode exists to avoid.
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));

    await waitFor(() => expect(mockApi.plaidCreateUpdateLinkToken).toHaveBeenCalled());
    expect(mockApi.plaidCreateLinkToken).not.toHaveBeenCalled();
  });

  it('asks for the right bank when two need repair', async () => {
    mockApi.plaidGetItems.mockResolvedValue({ data: [BANK, BANK_TWO] });
    mockApi.plaidSyncHealth.mockResolvedValue({
      data: { items: [needsRepair(), needsRepair({ id: BANK_TWO.id, institution_name: 'PNC' })] },
    });
    await openConnections();

    fireEvent.click(await screen.findByRole('button', { name: /reconnect pnc/i }));
    await waitFor(() => expect(mockApi.plaidCreateUpdateLinkToken).toHaveBeenCalledWith(BANK_TWO.id));
    expect(mockApi.plaidCreateUpdateLinkToken).not.toHaveBeenCalledWith(BANK.id);
  });

  // --- THE critical branch --------------------------------------------------

  it('MUST NOT exchange the public token after a successful repair', async () => {
    // Plaid's update-mode contract reuses the existing Item and leaves its
    // access token unchanged, so there is nothing to exchange. Calling
    // `exchange_token` here would also be rejected as "already connected",
    // breaking the repair. If this test ever fails, the connect and update
    // success branches have been merged — do not "fix" it by relaxing it.
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(mockUsePlaidLink).toHaveBeenCalled());

    await completeLink();

    expect(mockApi.plaidExchangeToken).not.toHaveBeenCalled();
  });

  it('still exchanges the public token after a normal connect', async () => {
    // The other half of the fork, asserted so neither branch can drift.
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /connect bank/i }));
    await waitFor(() => expect(mockUsePlaidLink).toHaveBeenCalled());

    await completeLink();

    await waitFor(() => expect(mockApi.plaidExchangeToken).toHaveBeenCalledWith('public-token-xyz', 'PNC'));
    expect(mockApi.plaidCreateUpdateLinkToken).not.toHaveBeenCalled();
  });

  // --- After a repair -------------------------------------------------------

  it('re-reads the connection list and health after repairing', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    await waitFor(() => expect(mockApi.plaidSyncHealth).toHaveBeenCalledTimes(1));
    const itemCallsBefore = mockApi.plaidGetItems.mock.calls.length;

    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(mockUsePlaidLink).toHaveBeenCalled());
    await completeLink();

    await waitFor(() =>
      expect(mockApi.plaidGetItems.mock.calls.length).toBeGreaterThan(itemCallsBefore));
    await waitFor(() => expect(mockApi.plaidSyncHealth.mock.calls.length).toBeGreaterThan(1));
  });

  it('runs an ordinary sync after repairing, not a bespoke one', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(mockUsePlaidLink).toHaveBeenCalled());
    await completeLink();

    // The same endpoint Sync Now uses, through the same honest completion path.
    await waitFor(() => expect(mockApi.plaidSyncAll).toHaveBeenCalled());
  });

  // --- Cancel and failure ---------------------------------------------------

  it('changes nothing when the user closes Link', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(mockUsePlaidLink).toHaveBeenCalled());

    await cancelLink();

    expect(mockApi.plaidExchangeToken).not.toHaveBeenCalled();
    expect(mockApi.plaidSyncAll).not.toHaveBeenCalled();
    expect(mockApi.plaidDeleteItem).not.toHaveBeenCalled();
    // Still broken, still offering the same way out.
    expect(await screen.findByRole('button', { name: /reconnect/i })).toBeEnabled();
  });

  it('leaves everything alone when the token request fails', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    mockApi.plaidCreateUpdateLinkToken.mockRejectedValue(new Error('offline'));
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/could not start reconnection/i),
    ));
    expect(mockApi.plaidExchangeToken).not.toHaveBeenCalled();
    expect(mockApi.plaidDeleteItem).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: /reconnect/i })).toBeEnabled();
  });

  it('refuses a second reconnect while one is open', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    const button = await screen.findByRole('button', { name: /reconnect/i });

    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(mockApi.plaidCreateUpdateLinkToken).toHaveBeenCalledTimes(1));
  });

  // --- Lazy mount, both modes ----------------------------------------------

  it('does not mount Plaid Link until a repair is started', async () => {
    // The CDN script and its preload iframe break PWA rendering on
    // iOS/Android, which is why the mount is conditional in both modes.
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    await screen.findByRole('button', { name: /reconnect/i });

    expect(mockUsePlaidLink).not.toHaveBeenCalled();
    expect(mockApi.plaidCreateUpdateLinkToken).not.toHaveBeenCalled();
  });

  // --- Session storage separation -------------------------------------------

  it('parks the update token under a key scoped to its bank', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));

    await waitFor(() =>
      expect(sessionStorage.getItem(`plaid_link_token_update_${BANK.id}`)).toBe('tok-update'));
    // A stale token for one bank must never be reachable as another's.
    expect(sessionStorage.getItem('plaid_link_token_connect')).toBeNull();
    expect(sessionStorage.getItem(`plaid_link_token_update_${BANK_TWO.id}`)).toBeNull();
  });

  it('parks a connect token under its own key', async () => {
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /connect bank/i }));

    await waitFor(() =>
      expect(sessionStorage.getItem('plaid_link_token_connect')).toBe('tok-connect'));
    expect(sessionStorage.getItem(`plaid_link_token_update_${BANK.id}`)).toBeNull();
  });

  it('clears the update token when the repair is cancelled', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));
    await waitFor(() =>
      expect(sessionStorage.getItem(`plaid_link_token_update_${BANK.id}`)).toBe('tok-update'));

    await cancelLink();

    expect(sessionStorage.getItem(`plaid_link_token_update_${BANK.id}`)).toBeNull();
  });

  it('never puts anything but a Link token in browser storage', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    fireEvent.click(await screen.findByRole('button', { name: /reconnect/i }));
    await waitFor(() => expect(mockApi.plaidCreateUpdateLinkToken).toHaveBeenCalled());

    const stored = Object.keys(sessionStorage).map(key => `${key}=${sessionStorage.getItem(key)}`).join(' ');
    expect(stored).not.toMatch(/access[-_]?token/i);
    expect(stored).not.toContain('public-token');
  });

  // --- Accessibility --------------------------------------------------------

  it('exposes busy state while the token is being fetched', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();
    const button = await screen.findByRole('button', { name: /reconnect/i });

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
  });

  it('explains the problem in plain language, not a Plaid error code', async () => {
    mockApi.plaidSyncHealth.mockResolvedValue({ data: { items: [needsRepair()] } });
    await openConnections();

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in again/i);
    // The code may live in Details, but never in the primary message.
    expect(screen.getByRole('alert')).not.toHaveTextContent(/ITEM_LOGIN_REQUIRED/);
  });
});
