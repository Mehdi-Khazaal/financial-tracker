import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const { mockLogin, mockComplete, mockNavigate } = vi.hoisted(() => ({
  mockLogin: vi.fn(), mockComplete: vi.fn(), mockNavigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, completeTwoFactor: mockComplete }),
}));

import Login from './Login';

const signIn = () => {
  fireEvent.change(screen.getByLabelText('Email or Username'), { target: { value: 'k@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
};

describe('Login', () => {
  it('labels its fields so they can be found by name', () => {
    render(<Login />);
    expect(screen.getByLabelText('Email or Username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('goes straight in when the account has no second factor', async () => {
    mockLogin.mockResolvedValue({});
    render(<Login />);
    signIn();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
    expect(mockLogin).toHaveBeenCalledWith('k@example.com', 'Password123');
  });

  it('asks for a code after a correct password on a 2FA account', async () => {
    mockLogin.mockResolvedValue({ twoFactorChallenge: 'chal' });
    mockComplete.mockResolvedValue({ recoveryCodesRemaining: null });
    render(<Login />);
    signIn();
    const code = await screen.findByLabelText('Code from your authenticator app');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByText('Two-step verification')).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.change(code, { target: { value: '123 456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith('chal', '123 456'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('says so when the code is wrong, and switches to recovery codes', async () => {
    mockLogin.mockResolvedValue({ twoFactorChallenge: 'chal' });
    mockComplete.mockRejectedValue({ response: { status: 401, data: { detail: "That code didn't work." } } });
    render(<Login />);
    signIn();
    fireEvent.change(await screen.findByLabelText('Code from your authenticator app'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText("That code didn't work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    expect(screen.getByLabelText('Recovery code')).toHaveValue('');
  });

  it('sends someone low on recovery codes to where new ones are made', async () => {
    mockLogin.mockResolvedValue({ twoFactorChallenge: 'chal' });
    mockComplete.mockResolvedValue({ recoveryCodesRemaining: 2 });
    render(<Login />);
    signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'abcde-fghjk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/settings?tab=account'));
  });

  it('starts over when the challenge has expired', async () => {
    mockLogin.mockResolvedValue({ twoFactorChallenge: 'chal' });
    mockComplete.mockRejectedValue({ response: { status: 401, data: { detail: 'That sign-in expired. Start again with your password.' } } });
    render(<Login />);
    signIn();
    fireEvent.change(await screen.findByLabelText('Code from your authenticator app'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('That sign-in expired. Start again with your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});
