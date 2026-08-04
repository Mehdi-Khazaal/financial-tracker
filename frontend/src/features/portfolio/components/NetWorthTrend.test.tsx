import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MonthSnapshot } from '../../../types';
import NetWorthTrend from './NetWorthTrend';

/**
 * Portfolio's growth chart.
 *
 * Tested through what a user (or a screen reader) can perceive: which range
 * buttons exist, what the figures say, and whether the chart has a textual
 * equivalent. The windowing arithmetic is covered in `netWorthRange.test.ts`;
 * this file covers the rendering contract on top of it.
 */

const snap = (month: string, value: number): MonthSnapshot => ({ month, net_worth: value });

/** `count` months ending August 2026, rising by `step` from `from`. */
const series = (count: number, from = 1000, step = 100): MonthSnapshot[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(2026, 7 - (count - 1 - i), 1);
    return snap(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, from + i * step);
  });

describe('insufficient history', () => {
  it('explains an empty history rather than drawing an empty chart', () => {
    render(<NetWorthTrend snapshots={[]} />);

    expect(screen.getByText(/No month-end snapshots have been recorded yet/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says a single snapshot is a position, not a trend', () => {
    render(<NetWorthTrend snapshots={[snap('2026-08', 1500)]} />);

    expect(screen.getByText(/position rather than a trend/)).toBeInTheDocument();
  });

  it('offers no range controls when there is nothing to range over', () => {
    render(<NetWorthTrend snapshots={[snap('2026-08', 1500)]} />);

    expect(screen.queryByRole('group', { name: 'Trend range' })).not.toBeInTheDocument();
  });

  it('still shows the current value, which is knowable from one snapshot', () => {
    render(<NetWorthTrend snapshots={[snap('2026-08', 1500)]} />);

    expect(screen.getByText('$1,500.00')).toBeInTheDocument();
  });
});

describe('range controls', () => {
  it('offers only 6M when history cannot fill more', () => {
    render(<NetWorthTrend snapshots={series(4)} />);

    // A single option is not a choice, so no group is rendered.
    expect(screen.queryByRole('group', { name: 'Trend range' })).not.toBeInTheDocument();
  });

  it('offers 6M and 12M once there is more than six months', () => {
    render(<NetWorthTrend snapshots={series(9)} />);

    const group = screen.getByRole('group', { name: 'Trend range' });
    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual(['6M', '12M']);
  });

  it('offers all three once there is more than twelve months', () => {
    render(<NetWorthTrend snapshots={series(18)} />);

    const group = screen.getByRole('group', { name: 'Trend range' });
    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual(['6M', '12M', '24M']);
  });

  it('defaults to the widest range the data supports', () => {
    render(<NetWorthTrend snapshots={series(18)} />);

    expect(screen.getByRole('button', { name: '24M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('changes the window when another range is chosen', () => {
    // 18 months of history under a 24M default renders as "Since <first month>",
    // because the window is wider than the data.
    render(<NetWorthTrend snapshots={series(18)} />);

    expect(screen.getByText(/^Since /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '6M' }));

    // Six months of an eighteen-month history fills the window exactly.
    expect(screen.getByText('Last 6 months')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '24M' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('exposes range buttons as real buttons, reachable by keyboard', () => {
    render(<NetWorthTrend snapshots={series(18)} />);

    const six = screen.getByRole('button', { name: '6M' });
    six.focus();
    expect(six).toHaveFocus();

    // Enter and Space activate a native button without extra key handling.
    fireEvent.click(six);
    expect(six).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('figures', () => {
  const snapshots = [snap('2026-06', 1000), snap('2026-07', 2500), snap('2026-08', 2000)];

  it('renders start, now, high and low', () => {
    render(<NetWorthTrend snapshots={snapshots} />);

    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('$2,500.00')).toBeInTheDocument();
  });

  it('shows the change with its direction and percentage', () => {
    render(<NetWorthTrend snapshots={snapshots} />);

    expect(screen.getByText(/\$1,000\.00 · \+100%/)).toBeInTheDocument();
    expect(screen.getByText(/from \$1,000\.00/)).toBeInTheDocument();
  });

  it('handles a downward trend without breaking', () => {
    const { container } = render(<NetWorthTrend snapshots={[snap('2026-07', 2000), snap('2026-08', 1200)]} />);

    // The badge carries direction as a glyph and the summary carries it as a
    // word, so the fall is legible either way.
    expect(container.textContent).toContain('↓');
    expect(container.textContent).toContain('$800.00');
    expect(screen.getByRole('img')).toHaveAccessibleName(/minus \$800\.00/);
  });

  it('handles negative net worth', () => {
    const { container } = render(<NetWorthTrend snapshots={[snap('2026-07', -500), snap('2026-08', -200)]} />);

    // Still a rise: −500 to −200 is +300 of movement.
    expect(container.textContent).toContain('↑');
    expect(container.textContent).toContain('$300.00');
  });

  it('handles a flat history without claiming a movement', () => {
    render(<NetWorthTrend snapshots={[snap('2026-07', 1000), snap('2026-08', 1000)]} />);

    expect(screen.getByText(/↑ \$0\.00/)).toBeInTheDocument();
  });

  it('omits the percentage when the window started at zero', () => {
    render(<NetWorthTrend snapshots={[snap('2026-07', 0), snap('2026-08', 400)]} />);

    expect(screen.queryByText(/·\s*[+−-]?\d+%/)).not.toBeInTheDocument();
    expect(screen.getByText(/from \$0\.00/)).toBeInTheDocument();
  });

  it('handles sparse, irregular snapshot intervals by using what exists', () => {
    // A gap between March and August — three points, never interpolated into
    // months that were not recorded.
    const { container } = render(
      <NetWorthTrend snapshots={[snap('2026-01', 500), snap('2026-03', 800), snap('2026-08', 1400)]} />,
    );

    expect(screen.getByText('Since Jan 2026')).toBeInTheDocument();
    expect(container.querySelector('.value-display')).toHaveTextContent('$1,400.00');
    // Only the recorded months appear, so nothing implies daily precision.
    expect(screen.getByRole('img')).toHaveAccessibleName(/Jan 2026/);
  });
});

describe('accessibility', () => {
  const snapshots = [snap('2026-06', 1000), snap('2026-07', 1500), snap('2026-08', 2000)];

  it('gives the chart a textual equivalent', () => {
    render(<NetWorthTrend snapshots={snapshots} />);

    const chart = screen.getByRole('img');
    expect(chart).toHaveAccessibleName(/Net worth/);
    expect(chart).toHaveAccessibleName(/a change of \$1,000\.00/);
    expect(chart).toHaveAccessibleName(/High .* low/);
  });

  it('says "minus" rather than relying on a glyph a reader may skip', () => {
    render(<NetWorthTrend snapshots={[snap('2026-07', 2000), snap('2026-08', 1500)]} />);

    expect(screen.getByRole('img')).toHaveAccessibleName(/a change of minus \$500\.00/);
  });

  it('labels the section with a real heading', () => {
    render(<NetWorthTrend snapshots={snapshots} />);

    expect(screen.getByRole('heading', { name: 'Net worth over time' })).toBeInTheDocument();
  });

  it('explains what net worth means without requiring a hover', () => {
    render(<NetWorthTrend snapshots={snapshots} />);

    expect(screen.getByRole('button', { name: 'How net worth is calculated' })).toBeInTheDocument();
  });
});

describe('privacy mode', () => {
  const snapshots = [snap('2026-07', 1500), snap('2026-08', 2000)];

  it('puts the blur hook on the headline value', () => {
    const { container } = render(<NetWorthTrend snapshots={snapshots} />);

    // `.value-display` is one of the classes privacy mode blurs.
    expect(container.querySelector('.value-display')).toHaveTextContent('$2,000.00');
  });

  it('blurs the chart itself, which would otherwise leak the shape', () => {
    const { container } = render(<NetWorthTrend snapshots={snapshots} />);

    expect(container.querySelector('.blurrable')).toBeInTheDocument();
  });

  it('puts the hook on the supporting figures too', () => {
    render(<NetWorthTrend snapshots={snapshots} />);

    // The starting value appears in the badge and again under "Start"; both
    // carry the blur hook.
    screen.getAllByText('$1,500.00').forEach(node => {
      expect(node.className).toContain('tabular-nums');
    });
  });

  it('leaves labels readable so the blurred figures still have context', () => {
    render(<NetWorthTrend snapshots={snapshots} />);

    expect(screen.getByText('Start')).not.toHaveClass('tabular-nums');
    expect(screen.getByText('High')).not.toHaveClass('tabular-nums');
  });
});
