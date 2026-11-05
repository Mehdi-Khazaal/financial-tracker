import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import type { Collection } from '../../../types';
import CollectionsNowCard from './CollectionsNowCard';

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 4, name: 'Ohio trip', emoji: '🚗', color: null, note: null, start_date: '2026-11-03', end_date: '2026-11-09',
  budget: '1500', is_archived: false, created_at: null, active: true, suggestion_count: 0,
  totals: { spent: '1300', returned: '60', net: '1240', count: 18, first_date: null, last_date: null }, ...overrides,
});

describe('CollectionsNowCard', () => {
  it('is not rendered when no collection is running or spent this month', () => {
    const { container } = render(<MemoryRouter><CollectionsNowCard items={[]} todayKey="2026-11-05" /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a running collection so far and a past one by what it added this month', () => {
    render(
      <MemoryRouter>
        <CollectionsNowCard
          todayKey="2026-11-05"
          items={[
            { collection: collection(), monthSpent: 900 },
            { collection: collection({ id: 5, name: 'House move', emoji: null, active: false, budget: null }), monthSpent: 75 },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Day 3 of 7 · $260 left')).toBeInTheDocument();
    expect(screen.getByText('$1,240.00')).toBeInTheDocument();
    expect(screen.getByText('This month')).toBeInTheDocument();
    expect(screen.getByText('$75.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /House move/ })).toHaveAttribute('href', '/collections/5');
  });
});
