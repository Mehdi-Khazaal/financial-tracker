import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Account, Category, Transaction } from '../../../types';
import type {
  CategoryComparison, CategoryDetail, Insight, PeriodMetrics, SavingsMetrics,
} from '../types';
import { resolvePeriod } from '../period';
import { buildClassificationContext } from '../calculations/transactions';
import CategoryDetailDrawer from './CategoryDetailDrawer';
import RecommendedInsights from './RecommendedInsights';
import SavingsOverviewCard from './SavingsOverviewCard';
import AnalyticsMetricGrid from './AnalyticsMetricGrid';
import PeriodComparisonTable from './PeriodComparisonTable';

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
    render(<RecommendedInsights insights={insights} onOpenCategory={jest.fn()} onNavigate={jest.fn()} />);
    expect(screen.getByText('Groceries is 40% above your usual')).toBeInTheDocument();
    expect(screen.getByText('Explanation here.')).toBeInTheDocument();
  });

  it('labels tone in text as well as colour', () => {
    render(<RecommendedInsights insights={insights} onOpenCategory={jest.fn()} onNavigate={jest.fn()} />);
    expect(screen.getByText('Keep an eye on')).toBeInTheDocument();
    expect(screen.getByText('To review')).toBeInTheDocument();
  });

  it('opens a category drawer rather than navigating for category actions', () => {
    const onOpenCategory = jest.fn();
    const onNavigate = jest.fn();
    render(<RecommendedInsights insights={insights} onOpenCategory={onOpenCategory} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /view groceries/i }));
    expect(onOpenCategory).toHaveBeenCalledWith(10);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('navigates with the target tab for page actions', () => {
    const onNavigate = jest.fn();
    render(<RecommendedInsights insights={insights} onOpenCategory={jest.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /review subscriptions/i }));
    expect(onNavigate).toHaveBeenCalledWith('/transactions', 'recurring');
  });

  it('shows a calm empty state rather than inventing advice', () => {
    render(<RecommendedInsights insights={[]} onOpenCategory={jest.fn()} onNavigate={jest.fn()} />);
    expect(screen.getByText('Nothing needs your attention')).toBeInTheDocument();
  });
});

describe('SavingsOverviewCard', () => {
  it('prompts to create a goal when none exists, without hiding what was left over', () => {
    render(<SavingsOverviewCard savings={savings()} period={PERIOD} onNavigate={jest.fn()} />);
    expect(screen.getByText(/You had \$2,800\.00 left after expenses this month\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create a goal/i })).toBeInTheDocument();
  });

  it('reports a savings-rate change in percentage points, not percent', () => {
    render(
      <SavingsOverviewCard
        period={PERIOD}
        onNavigate={jest.fn()}
        savings={savings({ savingsRate: 0.791, previousRate: 0.272, rateDelta: 0.519 })}
      />,
    );
    // 27.2% → 79.1% is a 51.9-point rise. Calling it "+191%" would overstate it.
    expect(screen.getByText(/\+51\.9 pp/)).toBeInTheDocument();
    expect(screen.queryByText(/191/)).not.toBeInTheDocument();
  });

  it('explains how the featured goal relates to the total set aside', () => {
    render(
      <SavingsOverviewCard
        period={PERIOD}
        onNavigate={jest.fn()}
        savings={savings({
          goalCount: 3,
          allocatedTotal: 16000,
          primaryGoal: {
            id: 1, name: 'House', target: 20000, current: 0,
            progress: 0, remaining: 20000, deadline: '2027-01-01',
            projectedCompletion: null, monthsToCompletion: null, basis: 'deadline',
          },
        })}
      />,
    );
    // The old card showed "$0 of $20,000" beside "$16,000 across 3 goals" with
    // nothing tying them together.
    expect(screen.getByText(/\$0 of your \$16,000 total set aside is on this goal/)).toBeInTheDocument();
    expect(screen.getByText(/\$16,000 sits on your 2 other goals/)).toBeInTheDocument();
  });

  it('shows one goal with its remaining amount and projected completion', () => {
    render(
      <SavingsOverviewCard
        period={PERIOD}
        onNavigate={jest.fn()}
        savings={savings({
          goalCount: 2,
          primaryGoal: {
            id: 1, name: 'Emergency Fund', target: 12000, current: 8400,
            progress: 70, remaining: 3600, deadline: null,
            projectedCompletion: 'October 2026', monthsToCompletion: 3, basis: 'progress',
          },
        })}
      />,
    );

    expect(screen.getByText('Emergency Fund')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('$3,600.00')).toBeInTheDocument();
    expect(screen.getByText('October 2026')).toBeInTheDocument();
  });

  it('says so plainly when a completion date cannot be estimated', () => {
    render(
      <SavingsOverviewCard
        period={PERIOD}
        onNavigate={jest.fn()}
        savings={savings({
          averageMonthlySaved: null, averageMonths: 0, goalCount: 1,
          primaryGoal: {
            id: 1, name: 'New Laptop', target: 2000, current: 500,
            progress: 25, remaining: 1500, deadline: null,
            projectedCompletion: null, monthsToCompletion: null, basis: 'progress',
          },
        })}
      />,
    );
    expect(screen.getByText('Not enough history')).toBeInTheDocument();
  });

  it('links out to the full savings page instead of duplicating it', () => {
    const onNavigate = jest.fn();
    render(<SavingsOverviewCard savings={savings()} period={PERIOD} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /view savings/i }));
    expect(onNavigate).toHaveBeenCalledWith('/portfolio', 'savings');
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
    fireEvent.click(screen.getByRole('button', { name: 'How Left over is calculated' }));
    // Uses the real minus sign (U+2212), not a hyphen.
    expect(screen.getByRole('tooltip')).toHaveTextContent('Left over = income − expenses');
    // And says plainly that this is not money that moved into a savings account.
    expect(screen.getByRole('tooltip')).toHaveTextContent(/does not mean money moved into a savings account/);
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
        onClose={jest.fn()}
        onNavigate={jest.fn()}
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

describe('PeriodComparisonTable', () => {
  const row = (over: Partial<CategoryComparison>): CategoryComparison => ({
    id: 1, name: 'Groceries', color: '#e11', current: 250, previous: 100, average: 100,
    baselineMonths: 4, confidence: 'medium', deltaVsPrevious: 150, deltaVsAverage: 150,
    pctVsPrevious: 1.5, pctVsAverage: 1.5, share: 0.5, transactionCount: 6,
    largestTransaction: null, drivenByOneTransaction: false, ...over,
  });

  const rows = [
    row({ id: 1, name: 'Groceries', deltaVsAverage: 150 }),
    row({ id: 2, name: 'Fuel', current: 40, average: 120, deltaVsAverage: -80, pctVsAverage: -0.67 }),
  ];

  it('leads with a plain-language headline instead of a bare number', () => {
    render(
      <PeriodComparisonTable
        categories={rows}
        period={PERIOD}
        baselineLabel="Average of the previous 4 completed months"
        baselineCount={4}
        onOpenCategory={jest.fn()}
      />,
    );
    expect(screen.getByText(/Spending was \$70\.00 above your recent average\./)).toBeInTheDocument();
    expect(screen.getByText(/1 category decreased and 1 increased\./)).toBeInTheDocument();
  });

  it('spells out how the average was built', () => {
    render(
      <PeriodComparisonTable
        categories={rows}
        period={PERIOD}
        baselineLabel="Average of the previous 4 completed months"
        baselineCount={4}
        onOpenCategory={jest.fn()}
      />,
    );
    expect(
      screen.getByText(/Average of the previous 4 completed months\./),
    ).toBeInTheDocument();
  });

  it('marks categories whose average rests on very little history', () => {
    render(
      <PeriodComparisonTable
        categories={[row({ baselineMonths: 1, confidence: 'low' })]}
        period={PERIOD}
        baselineLabel="Based on 1 earlier month — treat as a rough guide"
        baselineCount={1}
        onOpenCategory={jest.fn()}
      />,
    );
    expect(screen.getAllByText('1mo avg').length).toBeGreaterThan(0);
  });

  it('opens the drawer when a category is chosen', () => {
    const onOpenCategory = jest.fn();
    render(
      <PeriodComparisonTable
        categories={rows}
        period={PERIOD}
        baselineLabel="Average of the previous 4 completed months"
        baselineCount={4}
        onOpenCategory={onOpenCategory}
      />,
    );
    const table = screen.getByRole('table');
    fireEvent.click(within(table).getByRole('button', { name: /open details for groceries/i }));
    expect(onOpenCategory).toHaveBeenCalledWith(1);
  });

  it('says there is nothing to compare when history is absent', () => {
    render(
      <PeriodComparisonTable
        categories={[]}
        period={PERIOD}
        baselineLabel="No completed months to average yet"
        baselineCount={0}
        onOpenCategory={jest.fn()}
      />,
    );
    expect(screen.getByText('Nothing to compare yet')).toBeInTheDocument();
  });
});
