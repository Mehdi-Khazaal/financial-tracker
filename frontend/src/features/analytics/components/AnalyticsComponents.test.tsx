import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Category, Transaction } from '../../../types';
import type {
  CashFlowData, CategoryComparison, CategoryDetail, FinancialHealth, Insight, PeriodMetrics, SavingsMetrics, TrendMonth,
} from '../types';
import { resolvePeriod } from '../period';
import { buildClassificationContext } from '../calculations/transactions';
import CategoryDetailDrawer from './CategoryDetailDrawer';
import RecommendedInsights from './RecommendedInsights';
import AnalyticsMetricGrid from './AnalyticsMetricGrid';
import StatementCard from './StatementCard';
import CashFlowTrendCard from './CashFlowTrendCard';
import KeyRatiosCard from './KeyRatiosCard';
import { DeltaBadge, InfoHint } from './AnalyticsPrimitives';

const TODAY = new Date(2026, 6, 18);
const PERIOD = resolvePeriod('this-month', { today: TODAY, customMonth: '2026-07' });

const metrics = (over: Partial<PeriodMetrics> = {}): PeriodMetrics => ({
  income: 4000, expenses: 1200, grossExpenses: 1200, refunds: 0, cardPayments: 0,
  investments: 0, net: 2800, savingsRate: 0.7, transactionCount: 12, uncategorizedCount: 0,
  uncategorizedSpend: 0, largestExpense: null, largestIncome: null, ...over,
});

const savings = (over: Partial<SavingsMetrics> = {}): SavingsMetrics => ({
  saved: 2800, savingsRate: 0.7, previousSaved: 2000, previousRate: 0.5,
  savedDelta: 800, rateDelta: 0.2, averageMonthlySaved: 1500, averageMonths: 4,
  allocatedTotal: 0, goalCount: 0, primaryGoal: null, ...over,
});

const emptyNetWorth = {
  points: [], start: 0, end: 0, change: 0, pctChange: null,
  high: null, low: null, bestMonth: null, worstMonth: null, contributors: [],
};

describe('RecommendedInsights', () => {
  const insights: Insight[] = [
    {
      id: 'a', title: 'Groceries is 40% above your usual', body: 'Explanation here.',
      tone: 'warning', score: 90, action: { label: 'View Groceries', categoryId: 10 },
    },
    {
      id: 'b', title: 'Subscriptions went up', body: 'Another explanation.',
      tone: 'action', score: 80, action: { label: 'Review subscriptions', to: '/transactions', tab: 'recurring' },
    },
  ];

  it('renders each insight with its explanation', () => {
    render(<RecommendedInsights insights={insights} onOpenCategory={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText('Groceries is 40% above your usual')).toBeInTheDocument();
    expect(screen.getByText('Explanation here.')).toBeInTheDocument();
  });

  it('labels tone in text as well as colour', () => {
    render(<RecommendedInsights insights={insights} onOpenCategory={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText('Keep an eye on')).toBeInTheDocument();
    expect(screen.getByText('To review')).toBeInTheDocument();
  });

  it('opens a category drawer rather than navigating for category actions', () => {
    const onOpenCategory = vi.fn();
    const onNavigate = vi.fn();
    render(<RecommendedInsights insights={insights} onOpenCategory={onOpenCategory} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /view groceries/i }));
    expect(onOpenCategory).toHaveBeenCalledWith(10);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('navigates with the target tab for page actions', () => {
    const onNavigate = vi.fn();
    render(<RecommendedInsights insights={insights} onOpenCategory={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /review subscriptions/i }));
    expect(onNavigate).toHaveBeenCalledWith('/transactions', 'recurring');
  });

  it('shows a calm empty state rather than inventing advice', () => {
    render(<RecommendedInsights insights={[]} onOpenCategory={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByText('Nothing needs your attention')).toBeInTheDocument();
  });
});

describe('AnalyticsMetricGrid', () => {
  const grid = (props: Partial<React.ComponentProps<typeof AnalyticsMetricGrid>> = {}) => (
    <AnalyticsMetricGrid
      investedThisYear={0}
      year={2026}
      metrics={metrics()}
      previousMetrics={null}
      savings={savings()}
      netWorth={emptyNetWorth}
      currentNetWorth={5000}
      period={PERIOD}
      {...props}
    />
  );

  it('hides the Invested tile when nothing has ever been invested', () => {
    render(grid());
    expect(screen.queryByText('Invested')).not.toBeInTheDocument();
  });

  it('shows the Invested tile once a purchase is filed', () => {
    render(grid({ metrics: metrics({ investments: 2000 }), investedThisYear: 2000 }));
    expect(screen.getByText('Invested')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00 in 2026')).toBeInTheDocument();
  });

  // A quiet month still has a year behind it — hiding the tile would read as
  // though nothing had ever been invested.
  it('keeps the tile in a month with no purchases when the year has some', () => {
    render(grid({ metrics: metrics({ investments: 0 }), investedThisYear: 5000 }));
    expect(screen.getByText('Invested')).toBeInTheDocument();
    expect(screen.getByText('$5,000.00 in 2026')).toBeInTheDocument();
  });

  it('says so when money came back out of assets', () => {
    render(grid({ metrics: metrics({ investments: -800 }), investedThisYear: 1200 }));
    expect(screen.getByText('−$800.00')).toBeInTheDocument();
  });

  it('names how much of Left over stopped being cash', () => {
    render(grid({ metrics: metrics({ net: 2800, investments: 2000 }), investedThisYear: 2000 }));
    // The explanation is behind the hint button, so it has to be opened.
    fireEvent.click(screen.getByLabelText('How Left over is calculated'));
    expect(screen.getByText(/went into assets rather than staying as cash/))
      .toHaveTextContent('$2,000.00');
  });

  it('renders a dash and an explanation when there is no income', () => {
    render(
      <AnalyticsMetricGrid
        investedThisYear={0}
        year={2026}
        metrics={metrics({ income: 0, savingsRate: null, net: -300, expenses: 300 })}
        previousMetrics={null}
        savings={savings({ savingsRate: null, rateDelta: null, savedDelta: null })}
        netWorth={emptyNetWorth}
        currentNetWorth={5000}
        period={PERIOD}
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No income recorded')).toBeInTheDocument();
  });

  it('exposes a calculation explanation for every metric', () => {
    render(
      <AnalyticsMetricGrid
        investedThisYear={0}
        year={2026}
        metrics={metrics()}
        previousMetrics={metrics({ income: 3000, expenses: 1500, net: 1500 })}
        savings={savings()}
        netWorth={emptyNetWorth}
        currentNetWorth={5000}
        period={PERIOD}
      />,
    );
    ['Net worth', 'Income', 'Expenses', 'Left over', 'Savings rate'].forEach(label => {
      expect(screen.getByRole('button', { name: `How ${label} is calculated` })).toBeInTheDocument();
    });
  });

  it('shows a savings-rate change in points, with the two rates spelled out', () => {
    render(
      <AnalyticsMetricGrid
        investedThisYear={0}
        year={2026}
        metrics={metrics({ savingsRate: 0.791 })}
        previousMetrics={metrics({ savingsRate: 0.272 })}
        savings={savings({ savingsRate: 0.791, previousRate: 0.272, rateDelta: 0.519 })}
        netWorth={emptyNetWorth}
        currentNetWorth={5000}
        period={PERIOD}
      />,
    );
    expect(screen.getByText(/\+51\.9 pp/)).toBeInTheDocument();
    expect(screen.getByText('27.2% → 79.1%')).toBeInTheDocument();
  });

  it('opens the savings explanation on click', () => {
    render(
      <AnalyticsMetricGrid
        investedThisYear={0}
        year={2026}
        metrics={metrics()}
        previousMetrics={null}
        savings={savings()}
        netWorth={emptyNetWorth}
        currentNetWorth={5000}
        period={PERIOD}
      />,
    );
    const button = screen.getByRole('button', { name: 'How Left over is calculated' });
    // A real mouse hovers before it clicks. The click used to toggle the
    // hover-opened tooltip shut, so clicking "?" showed nothing.
    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    fireEvent.mouseLeave(button);
    // Uses the real minus sign (U+2212), not a hyphen.
    expect(screen.getByRole('tooltip')).toHaveTextContent('Left over = income − expenses');
    // And says plainly that this is not money that moved into a savings account.
    expect(screen.getByRole('tooltip')).toHaveTextContent(/does not mean money moved into a savings account/);
  });
});

describe('DeltaBadge', () => {
  it('shows an unchanged figure as a neutral 0%, not a red +0%', () => {
    render(<DeltaBadge value={0.001} format="percent" polarity="up-good" />);
    const badge = screen.getByText('0%');
    expect(badge).toHaveStyle({ color: 'var(--muted)' });
  });

  it('still colours a real fall in income as bad', () => {
    render(<DeltaBadge value={-0.12} format="percent" polarity="up-good" />);
    expect(screen.getByText('↓ −12%')).toHaveStyle({ color: 'var(--neg)' });
  });
});

describe('InfoHint', () => {
  it('stays open after a hover-then-click and closes on a second click', () => {
    render(<InfoHint label="What this means" text="An explanation." />);
    const button = screen.getByRole('button', { name: 'What this means' });

    fireEvent.mouseEnter(button);
    fireEvent.click(button);
    fireEvent.mouseLeave(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('An explanation.');
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('previews on hover and hides when the pointer leaves, if not clicked', () => {
    render(<InfoHint label="What this means" text="An explanation." />);
    const button = screen.getByRole('button', { name: 'What this means' });
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not follow a link it sits inside', () => {
    const onLinkClick = vi.fn();
    render(
      // The dashboard metric tiles are links with a hint in their label row.
      <a href="/elsewhere" onClick={onLinkClick}>
        Tile <InfoHint label="What this means" text="An explanation." />
      </a>,
    );
    const button = screen.getByRole('button', { name: 'What this means' });
    const notPrevented = fireEvent.click(button);
    expect(notPrevented).toBe(false);
    expect(onLinkClick).not.toHaveBeenCalled();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('closes on Escape and on a click outside', () => {
    render(<><InfoHint label="What this means" text="An explanation." /><p>Outside</p></>);
    const button = screen.getByRole('button', { name: 'What this means' });
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('CategoryDetailDrawer', () => {
  const accounts: Account[] = [
    { id: 1, user_id: 1, name: 'Everyday', type: 'checking', balance: 100, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  ];
  const categories: Category[] = [
    { id: 10, user_id: 1, name: 'Motorcycle', type: 'expense', color: '#F97316', is_system: false, created_at: '' },
  ];
  const ctx = buildClassificationContext(accounts, categories);

  const tx = (id: number, amount: number, date = '2026-07-04'): Transaction => ({
    id, user_id: 1, account_id: 1, category_id: 10, amount,
    description: `Purchase ${id}`, transaction_date: date, created_at: '',
  });

  const detail = (over: Partial<CategoryDetail> = {}): CategoryDetail => ({
    id: 10, name: 'Motorcycle', color: '#F97316',
    current: 1000, previous: 400, average: 300, baselineMonths: 4,
    confidence: 'medium', deltaVsPrevious: 600, deltaVsAverage: 700,
    pctVsPrevious: 1.5, pctVsAverage: 2.33, share: 0.5, transactionCount: 3,
    largestTransaction: tx(1, -800), drivenByOneTransaction: true,
    transactions: [tx(1, -800), tx(2, -150), tx(3, -50)],
    averageTransaction: 333.33,
    topMerchants: [{ key: 'dealer', name: 'City Dealer', total: 800, count: 1, average: 800, largest: 800 }],
    monthlyTrend: [
      { month: '2026-02', label: 'Feb 2026', value: 0 },
      { month: '2026-03', label: 'Mar 2026', value: 250 },
      { month: '2026-04', label: 'Apr 2026', value: 300 },
      { month: '2026-05', label: 'May 2026', value: 280 },
      { month: '2026-06', label: 'Jun 2026', value: 400 },
      { month: '2026-07', label: 'Jul 2026', value: 1000 },
    ],
    ...over,
  });

  const renderDrawer = (over: Partial<CategoryDetail> = {}, periodOver?: typeof PERIOD) =>
    render(
      <CategoryDetailDrawer
        detail={detail(over)}
        period={periodOver ?? PERIOD}
        accounts={accounts}
        ctx={ctx}
        onClose={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

  it('shows what share of the category the largest transaction represents', () => {
    renderDrawer();
    // $800 of $1,000 — the fastest way to see a total is one event, not a habit.
    expect(screen.getByText('80% of the total')).toBeInTheDocument();
  });

  it('explains rather than shrugging when there is no earlier period', () => {
    const noPrevious = { ...PERIOD, previous: null };
    renderDrawer({}, noPrevious);
    expect(screen.getByText(/earliest period with data/)).toBeInTheDocument();
    expect(screen.queryByText('No earlier period to compare')).not.toBeInTheDocument();
  });

  it('explains a missing typical figure instead of showing a bare dash', () => {
    renderDrawer({ baselineMonths: 0, average: 0 });
    expect(screen.getByText(/needs at least one completed month/)).toBeInTheDocument();
  });

  it('draws a trend when two or more months have spending', () => {
    renderDrawer();
    expect(screen.getByText(/low \$250 · high \$1,000/)).toBeInTheDocument();
    expect(screen.queryByText(/trend line appears once/)).not.toBeInTheDocument();
  });

  it('replaces the trend with an explanation when only one month has spending', () => {
    renderDrawer({
      monthlyTrend: [
        { month: '2026-06', label: 'Jun 2026', value: 0 },
        { month: '2026-07', label: 'Jul 2026', value: 1000 },
      ],
    });
    expect(screen.getByText(/Motorcycle has spending in one month so far/)).toBeInTheDocument();
  });

  it('labels how each transaction was counted', () => {
    renderDrawer();
    expect(screen.getAllByText('Expense').length).toBe(3);
  });

  it('names the category in its empty state rather than saying "this category"', () => {
    renderDrawer({ transactions: [], transactionCount: 0 });
    expect(screen.getByText(/Nothing recorded in Motorcycle for the selected period/)).toBeInTheDocument();
  });
});

describe('StatementCard', () => {
  const row = (over: Partial<CategoryComparison>): CategoryComparison => ({
    id: 1, name: 'Groceries', color: '#e11', current: 250, previous: 100, average: 100,
    baselineMonths: 4, confidence: 'medium', deltaVsPrevious: 150, deltaVsAverage: 150,
    pctVsPrevious: 1.5, pctVsAverage: 1.5, share: 0.5, transactionCount: 6,
    largestTransaction: null, drivenByOneTransaction: false, ...over,
  });

  const cashFlow = (over: Partial<CashFlowData> = {}): CashFlowData => ({
    mode: 'waterfall', steps: [], series: [], income: 4000, fixed: 1500, variable: 500,
    remaining: 2000, hasFixedBreakdown: true, ...over,
  });

  const statement = (props: Partial<React.ComponentProps<typeof StatementCard>> = {}) => (
    <StatementCard
      period={PERIOD}
      metrics={metrics()}
      previousMetrics={metrics({ income: 3800, expenses: 1400, net: 2400 })}
      typical={{ income: 4000, expenses: 1300, net: 2700, months: 4 }}
      categories={[
        row({ id: 2, name: 'Fuel', current: 40, average: 120, deltaVsAverage: -80, share: 0.1 }),
        row({ id: 1, name: 'Groceries' }),
      ]}
      cashFlow={cashFlow()}
      categoriesFailed={false}
      onOpenCategory={vi.fn()}
      {...props}
    />
  );

  it('lists spending largest first and opens a category from its row', () => {
    const onOpenCategory = vi.fn();
    render(statement({ onOpenCategory }));
    const buttons = screen.getAllByRole('button', { name: /open details/i });
    expect(buttons[0]).toHaveAccessibleName('Groceries: $250.00. Open details.');
    fireEvent.click(buttons[0]);
    expect(onOpenCategory).toHaveBeenCalledWith(1);
  });

  it('closes with what was kept and the savings rate, each against typical', () => {
    render(statement());
    const kept = screen.getByRole('row', { name: /^Kept/ });
    expect(within(kept).getByText('$2,800.00')).toBeInTheDocument();
    expect(within(kept).getByText(/\+\$100\.00/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /^Savings rate/ })).toHaveTextContent('70.0%');
  });

  it('shows where the income went, as shares of income', () => {
    render(statement());
    expect(screen.getByText('Bills')).toBeInTheDocument();
    expect(screen.getByText('Day-to-day')).toBeInTheDocument();
    expect(screen.getByText('Kept', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getAllByText(/38% of income/).length).toBe(1);
  });

  it('says plainly when spending ran past income', () => {
    render(statement({ cashFlow: cashFlow({ income: 1000, fixed: 900, variable: 400, remaining: -300 }) }));
    expect(screen.getByText('Spending ran $300.00 past what came in.')).toBeInTheDocument();
  });

  it('keeps uncategorized spending as its own line so the rows add up', () => {
    render(statement({ metrics: metrics({ uncategorizedSpend: 45 }) }));
    expect(screen.getByRole('row', { name: /^Uncategorized/ })).toHaveTextContent('$45.00');
  });

  it('shortens a long list and can show all of it', () => {
    const many = Array.from({ length: 11 }, (_, i) => row({ id: 100 + i, name: `Category ${i}`, current: 100 - i }));
    render(statement({ categories: many }));
    expect(screen.getAllByRole('button', { name: /open details/i })).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 11 categories' }));
    expect(screen.getAllByRole('button', { name: /open details/i })).toHaveLength(11);
  });

  it('keeps the totals when categories could not be loaded', () => {
    render(statement({ categoriesFailed: true }));
    expect(screen.getByText(/Categories unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /^Total spending/ })).toHaveTextContent('$1,200.00');
  });
});

describe('CashFlowTrendCard', () => {
  const month = (m: string, income: number, expenses: number, over: Partial<TrendMonth> = {}): TrendMonth => ({
    month: m, income, expenses, net: income - expenses, partial: false, inPeriod: false, ...over,
  });

  it('gives screen readers every month as a table row', () => {
    render(<CashFlowTrendCard periodLabel="July 2026" trend={[
      month('2026-05', 4000, 3000), month('2026-06', 4000, 4500),
      month('2026-07', 1000, 800, { partial: true, inPeriod: true }),
    ]} />);
    const table = screen.getByRole('table', { name: /by month/ });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByText('July 2026 (so far)')).toBeInTheDocument();
  });

  it('averages only finished months and counts the ones that ended ahead', () => {
    render(<CashFlowTrendCard periodLabel="July 2026" trend={[
      month('2026-05', 4000, 3000), month('2026-06', 4000, 4500),
      month('2026-07', 1000, 800, { partial: true, inPeriod: true }),
    ]} />);
    expect(screen.getByText('Average income').nextSibling).toHaveTextContent('$4,000');
    expect(screen.getByText('Months with money left').nextSibling).toHaveTextContent('1 of 2');
    expect(screen.getByText(/Jul is still running/)).toBeInTheDocument();
  });

  it('waits for two months before drawing a trend', () => {
    render(<CashFlowTrendCard periodLabel="July 2026" trend={[month('2026-07', 1000, 800, { partial: true })]} />);
    expect(screen.getByText('Not enough months yet')).toBeInTheDocument();
  });
});

describe('KeyRatiosCard', () => {
  const health = (over: Partial<FinancialHealth> = {}): FinancialHealth => ({
    available: true, score: 72, previousScore: 68, label: 'Good', monthsOfHistory: 4, requiredMonths: 3,
    factors: [
      { key: 'savings', label: 'Savings rate', score: 90, weight: 1, detail: '31% of income kept', explanation: 'Kept over earned.' },
      { key: 'emergency', label: 'Emergency fund', score: 30, weight: 1, detail: '1.2 months of spending in cash', explanation: 'Months of cover.' },
    ],
    strengths: [], weaknesses: [], ...over,
  });

  it('reads each ratio with its figure and one word', () => {
    render(<KeyRatiosCard health={health()} />);
    expect(screen.getByText('31% of income kept')).toBeInTheDocument();
    expect(screen.getByText('Strong')).toBeInTheDocument();
    expect(screen.getByText('Weak')).toBeInTheDocument();
    expect(screen.getByText(/72 of 100 \(good\), up 4 from last month/)).toBeInTheDocument();
  });

  it('says how much history it still needs', () => {
    render(<KeyRatiosCard health={health({ available: false, score: null, monthsOfHistory: 1, factors: [] })} />);
    expect(screen.getByText(/You have 1 completed month so far/)).toBeInTheDocument();
  });
});
