import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import Landing from './Landing';

describe('Landing', () => {
  it('leads with the product question and offers both doors', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/where does your money stand/i);
    expect(screen.getByRole('link', { name: /create account/i })).toHaveAttribute('href', '/signup');
    expect(screen.getByRole('link', { name: /start tracking/i })).toHaveAttribute('href', '/signup');
    expect(screen.getAllByRole('link', { name: /sign in|i have an account/i }).length).toBeGreaterThan(0);
  });

  it('links the legal pages from the footer', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });

  it('labels the example numbers as an example', () => {
    render(<MemoryRouter><Landing /></MemoryRouter>);
    expect(screen.getByText(/net worth · example/i)).toBeInTheDocument();
  });
});
