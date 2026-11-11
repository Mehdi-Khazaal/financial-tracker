import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MetalSummaryCard from './MetalSummaryCard';
import { getMetalHistory } from '../../../utils/api';
import type { MetalSummary } from '../calculations/metal';

vi.mock('../../../utils/api', () => ({ getMetalHistory: vi.fn() }));

const gold: MetalSummary = {
  metal: 'gold', holdings: 6, fineOunces: 4.8998, paid: 19429.99, value: 19838.48, gain: 408.49,
  gainPct: 408.49 / 19429.99, averageCostPerOunce: 3965.45, spotPrice: 4048.8,
};
const history = [
  { month: '2025-12', price: '4341.1' }, { month: '2026-02', price: '5248' }, { month: '2026-11', price: '4048.8' },
];

describe('MetalSummaryCard', () => {
  it('states the pure gold, value, cost and gain', async () => {
    (getMetalHistory as Mock).mockResolvedValue({ data: history });
    render(<MetalSummaryCard summary={gold} />);

    expect(screen.getByRole('heading', { name: 'Gold' })).toBeInTheDocument();
    expect(screen.getByText('4.90 oz')).toBeInTheDocument();
    expect(screen.getByText(/of pure gold \(152\.4 g\) across 6 holdings/)).toBeInTheDocument();
    expect(screen.getByText('Worth today').nextSibling).toHaveTextContent('$19,838.48');
    expect(screen.getByText('Change').nextSibling).toHaveTextContent('+$408.49 (+2.1%)');
    expect(screen.getByText('Paid per ounce').nextSibling).toHaveTextContent('$3,965$4,049 today');
    await waitFor(() => expect(getMetalHistory).toHaveBeenCalledWith('gold', 12));
  });

  it('draws the year of prices against what was paid per ounce', async () => {
    (getMetalHistory as Mock).mockResolvedValue({ data: history });
    const { container } = render(<MetalSummaryCard summary={gold} />);

    expect(await screen.findByText(/Gold per ounce: \$4,341 in December 2025, \$4,049 in November 2026, highest \$5,248 in February 2026\./))
      .toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(container.querySelector('line[stroke-dasharray]')).not.toBeNull();
  });

  it('leaves the chart out when the prices cannot be had', async () => {
    (getMetalHistory as Mock).mockRejectedValue(new Error('offline'));
    const { container } = render(<MetalSummaryCard summary={gold} />);

    await waitFor(() => expect(getMetalHistory).toHaveBeenCalled());
    expect(container.querySelector('polyline')).toBeNull();
    expect(screen.getByText('Worth today')).toBeInTheDocument();
  });
});
