import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MorningBrief, { SensitiveSentence } from './MorningBrief';
import type { BriefItem } from '../calculations/brief';

jest.mock('react-router-dom', () => {
  const react = jest.requireActual('react');
  return {
    Link: ({ to, children, ...rest }: { to: string; children: unknown }) =>
      react.createElement('a', { href: to, ...rest }, children),
  };
});

/**
 * Privacy mode in the brief.
 *
 * The blur hook is the `tabular-nums` class — `index.css` blurs it under
 * `body.privacy-on`. The brief writes sentences rather than figures in cells,
 * so the test that matters is that the class lands on the amount and *only* the
 * amount: blurring the whole line would hide the meaning along with the money.
 */

const item = (overrides: Partial<BriefItem> = {}): BriefItem => ({
  id: 'income-landed',
  priority: 7,
  tone: 'positive',
  icon: 'inflow',
  text: '$5,200.00 arrived on Friday',
  detail: 'Acme Payroll',
  action: null,
  ...overrides,
});

const renderBrief = (items: BriefItem[]) =>
  render(<MorningBrief items={items} dateLabel="Sunday, August 2" />);

describe('SensitiveSentence', () => {
  it('wraps a currency amount in the class privacy mode blurs', () => {
    render(<p><SensitiveSentence>{'$5,200.00 arrived on Friday'}</SensitiveSentence></p>);

    const amount = screen.getByText('$5,200.00');
    expect(amount).toHaveClass('tabular-nums');
  });

  it('leaves the surrounding words unblurred so the sentence still reads', () => {
    render(<p><SensitiveSentence>{'$5,200.00 arrived on Friday'}</SensitiveSentence></p>);

    const words = screen.getByText(/arrived on Friday/);
    expect(words).not.toHaveClass('tabular-nums');
  });

  it('handles an amount mid-sentence', () => {
    render(<p><SensitiveSentence>{'Largest purchase this week: $412.50'}</SensitiveSentence></p>);

    expect(screen.getByText('$412.50')).toHaveClass('tabular-nums');
    expect(screen.getByText(/Largest purchase this week/)).not.toHaveClass('tabular-nums');
  });

  it('handles more than one amount in the same sentence', () => {
    render(
      <p>
        <SensitiveSentence>
          {'About $1,840.00 at this rate, against a typical $2,000.00.'}
        </SensitiveSentence>
      </p>,
    );

    expect(screen.getByText('$1,840.00')).toHaveClass('tabular-nums');
    expect(screen.getByText('$2,000.00')).toHaveClass('tabular-nums');
  });

  it('leaves a sentence with no money entirely alone', () => {
    const { container } = render(
      <p><SensitiveSentence>{'Some information could not be loaded'}</SensitiveSentence></p>,
    );

    expect(container.querySelectorAll('.tabular-nums')).toHaveLength(0);
    expect(screen.getByText('Some information could not be loaded')).toBeInTheDocument();
  });

  it('does not blur counts or percentages, which are not balances', () => {
    const { container } = render(
      <p>
        <SensitiveSentence>
          {'3 imported transactions still need a category'}
        </SensitiveSentence>
      </p>,
    );
    expect(container.querySelectorAll('.tabular-nums')).toHaveLength(0);

    const pct = render(
      <p><SensitiveSentence>{'Spending is tracking 8% below usual this month'}</SensitiveSentence></p>,
    );
    expect(pct.container.querySelectorAll('.tabular-nums')).toHaveLength(0);
  });
});

describe('MorningBrief renders sensitive values through the splitter', () => {
  it('blurs the amount in a headline', () => {
    renderBrief([item()]);

    expect(screen.getByText('$5,200.00')).toHaveClass('tabular-nums');
    expect(screen.getByText(/arrived on Friday/)).toBeInTheDocument();
  });

  it('blurs the amount in a supporting detail too', () => {
    renderBrief([item({
      text: 'NETFLIX.COM is due in 3 days',
      detail: '$15.99 from Venture Card.',
    })]);

    expect(screen.getByText('$15.99')).toHaveClass('tabular-nums');
    expect(screen.getByText('NETFLIX.COM is due in 3 days')).toBeInTheDocument();
  });

  it('keeps the action link legible', () => {
    renderBrief([item({ action: { label: 'Review', to: '/transactions?tab=transactions' } })]);

    const link = screen.getByText('Review');
    expect(link).toHaveAttribute('href', '/transactions?tab=transactions');
    expect(link).not.toHaveClass('tabular-nums');
  });

  it('says nothing was found rather than padding the list', () => {
    renderBrief([]);

    expect(screen.getByText('Nothing needs your attention this morning.')).toBeInTheDocument();
  });
});
