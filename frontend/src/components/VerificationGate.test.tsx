import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  user: { id: 1, email: 'me@example.com', username: 'me', is_verified: false, is_admin: false } as any,
  logout: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));

const mockApi = vi.hoisted(() => ({ resendVerification: vi.fn() }));
vi.mock('../utils/api', () => ({
  VERIFICATION_REQUIRED_EVENT: 'fintrack:verification-required',
  resendVerification: (...a: unknown[]) => mockApi.resendVerification(...a),
}));

import VerificationGate from './VerificationGate';

describe('VerificationGate', () => {
  beforeEach(() => {
    mockAuth.user = { id: 1, email: 'me@example.com', username: 'me', is_verified: false, is_admin: false };
    mockApi.resendVerification.mockResolvedValue({ data: { message: 'Verification email sent.' } });
  });

  it('stays hidden until the API reports an unverified refusal', () => {
    render(<VerificationGate />);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => { window.dispatchEvent(new CustomEvent('fintrack:verification-required')); });

    expect(screen.getByRole('dialog', { name: /verify your email/i })).toBeInTheDocument();
    expect(screen.getByText(/me@example.com/)).toBeInTheDocument();
  });

  it('resends the email and can sign out', async () => {
    render(<VerificationGate />);
    act(() => { window.dispatchEvent(new CustomEvent('fintrack:verification-required')); });

    fireEvent.click(screen.getByRole('button', { name: /resend the email/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Verification email sent.'));

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(mockAuth.logout).toHaveBeenCalled();
  });

  it('never shows for a verified user', () => {
    mockAuth.user = { ...mockAuth.user, is_verified: true };
    render(<VerificationGate />);
    act(() => { window.dispatchEvent(new CustomEvent('fintrack:verification-required')); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
