import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MonthActivityCard from './MonthActivityCard';
import type { MonthActivity } from '../types';

jest.mock('react-router-dom', () => {
  const react = jest.requireActual('react');
  return {
    Link: ({ to, children, ...rest }: { to: string; children: unknown }) =>
      react.createElement('a', { href: to, ...rest }, children),
  };
});

/**
 * The invested row.
 *
 * Money filed under an investment category is excluded from spending, which
 * means it would otherwise leave no trace on the dashboard at all — the point
 * of the row is that an excluded amount is still reported rather than silently
 * dropped. It is suppressed at zero so it costs nothing for anyone who does
 * not buy assets.
 */

const activity: MonthActivity = {
  month: '2026-08',
  monthName: 'August',
  state: 'active',
  postedCount: 12,
  lastPostedDate: '2026-08-18',
  lastPostedLabel: 'Aug 18',
  lastPostedIsEarlier: false,
  daysElapsed: 19,
  daysInMonth: 31,
  headline: null,
  detail: null,
};

const card = (invested: number) =>
  render(<MonthActivityCard activity={activity} nextCharge={null} invested={invested} />);

describe('MonthActivityCard invested row', () => {
  it('is absent when nothing was invested', () => {
    card(0);
    expect(screen.queryByText('Invested')).not.toBeInTheDocument();
  });

  it('reports money put into assets', () => {
    card(2000);
    expect(screen.getByText('Invested')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
  });

  it('names the other direction rather than showing a negative', () => {
    card(-800);
    expect(screen.getByText('Sold from assets')).toBeInTheDocument();
    expect(screen.getByText('$800.00')).toBeInTheDocument();
  });

  it('blurs the amount under privacy mode, like every other figure', () => {
    card(2000);
    expect(screen.getByText('$2,000.00')).toHaveClass('tabular-nums');
  });

  it('links through to Portfolio, where the holding is recorded', () => {
    card(2000);
    expect(screen.getByText('Invested').closest('a')).toHaveAttribute('href', '/portfolio');
  });
});
