import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockApi = vi.hoisted(() => ({ getSignupPolicy: vi.fn() }));
vi.mock('../utils/api', () => ({ getSignupPolicy: (...a: unknown[]) => mockApi.getSignupPolicy(...a) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ signup: vi.fn() }) }));

import Signup from './Signup';

const renderPage = () => render(<MemoryRouter><Signup /></MemoryRouter>);

describe('Signup policy', () => {
  beforeEach(() => {
    mockApi.getSignupPolicy.mockResolvedValue({ data: { open: true, invite_required: false } });
  });

  it('shows no invite field when none is required', async () => {
    renderPage();
    await waitFor(() => expect(mockApi.getSignupPolicy).toHaveBeenCalled());
    expect(screen.queryByLabelText(/invite code/i)).toBeNull();
    expect(screen.getByRole('button', { name: /create|sign up|get started/i })).toBeEnabled();
  });

  it('asks for an invite code when the deployment requires one', async () => {
    mockApi.getSignupPolicy.mockResolvedValue({ data: { open: true, invite_required: true } });
    renderPage();
    expect(await screen.findByLabelText(/invite code/i)).toBeRequired();
  });

  it('explains closed sign-ups and disables the form', async () => {
    mockApi.getSignupPolicy.mockResolvedValue({ data: { open: false, invite_required: false } });
    renderPage();
    expect(await screen.findByRole('status')).toHaveTextContent(/closed/i);
    expect(screen.getByRole('button', { name: /create|sign up|get started/i })).toBeDisabled();
  });

  it('links the terms and privacy policy', async () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });
});
