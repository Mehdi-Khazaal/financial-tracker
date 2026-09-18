import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApi = vi.hoisted(() => ({
  exportAccountJson: vi.fn(),
  exportTransactionsCsv: vi.fn(),
  deleteMyAccount: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock('../../../utils/api', () => mockApi);

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => mockToast }));

const mockAuth = vi.hoisted(() => ({ logout: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => mockAuth }));

import AccountSection from './AccountSection';

const renderSection = () =>
  render(
    <MemoryRouter>
      <AccountSection username="khaza" email="k@example.com" onSignOut={() => {}} />
    </MemoryRouter>,
  );

describe('AccountSection: your data', () => {
  beforeEach(() => {
    (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:x');
    (globalThis as any).URL.revokeObjectURL = vi.fn();
    mockAuth.logout.mockResolvedValue(undefined);
  });

  it('downloads the JSON export with the server filename', async () => {
    mockApi.exportAccountJson.mockResolvedValue({
      data: new Blob(['{}']),
      headers: { 'content-disposition': 'attachment; filename="fintrack-export-2026-09-17.json"' },
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /export json/i }));

    await waitFor(() => expect(mockApi.exportAccountJson).toHaveBeenCalled());
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(mockToast.success).toHaveBeenCalledWith('Export ready');
    click.mockRestore();
  });

  it('requires the DELETE confirmation before calling the API', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'Password123' } });
    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /delete everything/i }));

    expect(mockToast.error).toHaveBeenCalledWith('Type DELETE to confirm');
    expect(mockApi.deleteMyAccount).not.toHaveBeenCalled();
  });

  it('deletes, signs out and reports an unremoved bank honestly', async () => {
    mockApi.deleteMyAccount.mockResolvedValue({ data: { deleted: true, bank_connections_removed: 0, bank_connections_unremoved: 1 } });

    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /delete my account/i }));
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: 'Password123' } });
    fireEvent.change(screen.getByLabelText(/type delete/i), { target: { value: 'delete' } });
    fireEvent.click(screen.getByRole('button', { name: /delete everything/i }));

    await waitFor(() => expect(mockApi.deleteMyAccount).toHaveBeenCalledWith('Password123', 'delete'));
    await waitFor(() => expect(mockAuth.logout).toHaveBeenCalled());
    expect(mockToast.info).toHaveBeenCalledWith(expect.stringMatching(/could not be removed at Plaid/));
  });

  it('links the legal pages', () => {
    renderSection();
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });
});
