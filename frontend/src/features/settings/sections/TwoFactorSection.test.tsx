import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockApi = vi.hoisted(() => ({
  getTwoFactorStatus: vi.fn(),
  startTwoFactorSetup: vi.fn(),
  enableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));
vi.mock('../../../utils/api', () => mockApi);
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => mockToast }));
const mockAuth = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => mockAuth }));

import TwoFactorSection from './TwoFactorSection';

const CODES = Array.from({ length: 10 }, (_, i) => `aaaa${i}-bbbbb`);

beforeEach(() => {
  mockApi.getTwoFactorStatus.mockResolvedValue({ data: { enabled: false, recovery_codes_remaining: 0 } });
  mockApi.startTwoFactorSetup.mockResolvedValue({ data: { secret: 'ABCD EFGH', otpauth_uri: 'otpauth://x', qr_svg: 'data:image/svg+xml;base64,AAA' } });
  mockApi.enableTwoFactor.mockResolvedValue({ data: { recovery_codes: CODES } });
  mockApi.disableTwoFactor.mockResolvedValue({ data: { enabled: false } });
  mockApi.regenerateRecoveryCodes.mockResolvedValue({ data: { recovery_codes: CODES } });
});

describe('TwoFactorSection', () => {
  it('walks through set-up: password, scan, first code, recovery codes shown once', async () => {
    render(<TwoFactorSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up two-factor' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByAltText('QR code for your authenticator app')).toHaveAttribute('src', 'data:image/svg+xml;base64,AAA');
    expect(screen.getByTestId('totp-secret')).toHaveTextContent('ABCD EFGH');
    expect(mockApi.startTwoFactorSetup).toHaveBeenCalledWith('Password123');

    const turnOn = screen.getByRole('button', { name: 'Turn on' });
    expect(turnOn).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code from the app'), { target: { value: '123456' } });
    fireEvent.click(turnOn);
    await waitFor(() => expect(mockApi.enableTwoFactor).toHaveBeenCalledWith('123456'));
    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(list.querySelectorAll('li')).toHaveLength(10);
    expect(mockAuth.refresh).toHaveBeenCalled();

    mockApi.getTwoFactorStatus.mockResolvedValue({ data: { enabled: true, recovery_codes_remaining: 10 } });
    fireEvent.click(screen.getByRole('button', { name: "I've saved them" }));
    expect(await screen.findByText(/recovery codes left/)).toBeInTheDocument();
  });

  it('shows the server reason for a wrong password or code', async () => {
    mockApi.startTwoFactorSetup.mockRejectedValue({ response: { data: { detail: 'Password is incorrect.' } } });
    render(<TwoFactorSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up two-factor' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect.');
  });

  it('turns off only with the password and a code, and warns when codes run low', async () => {
    mockApi.getTwoFactorStatus.mockResolvedValue({ data: { enabled: true, recovery_codes_remaining: 2 } });
    render(<TwoFactorSection />);
    expect(await screen.findByText('Running low — make a new set.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const submit = screen.getByRole('button', { name: 'Turn off two-factor' });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '654321' } });
    fireEvent.click(submit);
    await waitFor(() => expect(mockApi.disableTwoFactor).toHaveBeenCalledWith('Password123', '654321'));
    expect(await screen.findByRole('button', { name: 'Set up two-factor' })).toBeInTheDocument();
  });

  it('replaces recovery codes after confirming the password', async () => {
    mockApi.getTwoFactorStatus.mockResolvedValue({ data: { enabled: true, recovery_codes_remaining: 7 } });
    render(<TwoFactorSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'New recovery codes' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(mockApi.regenerateRecoveryCodes).toHaveBeenCalledWith('Password123'));
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toBeInTheDocument();
  });
});
