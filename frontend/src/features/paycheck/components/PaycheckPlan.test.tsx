import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PaycheckPlanCard, { daysUntil } from './PaycheckPlanCard';
import PaycheckPlanSheet from './PaycheckPlanSheet';
import { savePaycheckPlan, tickPaycheckLine, untickPaycheckLine } from '../../../utils/api';
import type { Account, PaycheckPlan, SavingsGoal } from '../../../types';

vi.mock('../../../utils/api', () => ({
  __esModule: true,
  savePaycheckPlan: vi.fn(),
  tickPaycheckLine: vi.fn(),
  untickPaycheckLine: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../context/ToastContext', () => ({ useToast: () => toast }));

const TODAY = new Date(2026, 10, 10);

const accounts = [
  { id: 47, user_id: 1, name: 'Spend', type: 'checking', balance: 693.28, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 52, user_id: 1, name: 'Home', type: 'cash', balance: 4910, credit_limit: null, currency: 'USD', created_at: '', updated_at: '' },
  { id: 49, user_id: 1, name: 'VentureOne', type: 'credit_card', balance: -384.92, credit_limit: 2750, currency: 'USD', created_at: '', updated_at: '' },
] as Account[];

const goals = [
  { id: 2, user_id: 1, name: 'Summer 2027', target_amount: 20000, deadline: '2027-06-30', created_at: '', allocations: [], current_amount: 4910 },
  { id: 4, user_id: 1, name: 'Trip', target_amount: 2500, deadline: '2026-12-31', created_at: '', allocations: [], current_amount: 1000 },
] as SavingsGoal[];

const suggestions = [
  { merchant_key: 'philips', name: 'PHILIPS', count: 11, typical_amount: '1835.29', gap_days: 14 },
  { merchant_key: 'passavant', name: 'Passavant', count: 18, typical_amount: '1187.06', gap_days: 14 },
];

const unconfigured: PaycheckPlan = {
  configured: false, notify: true, sources: [], lines: [], suggested_sources: suggestions,
  gap_days: 14, paydays_per_month: '2.17', latest: null,
};

const line = { id: 11, goal_id: 2, goal_name: 'Summer 2027', amount: '1500.00', account_id: 52, account_name: 'Home' };

const configured = (overrides: Partial<PaycheckPlan['latest'] & object> = {}, lineState = { done: false, set_aside: false }): PaycheckPlan => ({
  configured: true, notify: true,
  sources: [{ merchant_key: 'philips', name: 'PHILIPS' }, { merchant_key: 'passavant', name: 'Passavant' }],
  lines: [line], suggested_sources: suggestions, gap_days: 14, paydays_per_month: '2.17',
  latest: {
    date: '2026-11-07', amount: '3022.35',
    deposits: [{ name: 'PHILIPS', amount: '1835.29', account_id: 47 }, { name: 'Passavant', amount: '1187.06', account_id: 47 }],
    next_payday: '2026-11-21',
    bills: [
      { name: 'Spotify', amount: '7.48', date: '2026-11-09', paid: true },
      { name: 'Planet Fitness', amount: '25.40', date: '2026-11-18', paid: false },
    ],
    bills_total: '32.88',
    lines: [{ ...line, ...lineState }],
    planned_total: '1500.00',
    free: '1489.47',
    ...overrides,
  },
});

const renderCard = (plan: PaycheckPlan | null, handlers: { onPlanChange?: Mock; onGoalsChanged?: Mock } = {}) =>
  render(
    <PaycheckPlanCard plan={plan} goals={goals} accounts={accounts} today={TODAY}
      onPlanChange={handlers.onPlanChange ?? vi.fn()} onGoalsChanged={handlers.onGoalsChanged ?? vi.fn()} />,
  );

describe('PaycheckPlanCard', () => {
  it('offers to set up, naming the payers that look like paychecks', () => {
    renderCard(unconfigured);
    expect(screen.getByText(/PHILIPS and Passavant look like paychecks/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up the plan' })).toBeInTheDocument();
  });

  it('works the latest payday through the plan', () => {
    renderCard(configured());

    expect(screen.getByRole('heading', { name: /payday nov 7 \$3,022\.35/i })).toBeInTheDocument();
    expect(screen.getByText('Next payday Nov 21, in 11 days')).toBeInTheDocument();
    expect(screen.getByText('$32.88')).toBeInTheDocument();
    expect(screen.getByText('Into Home')).toBeInTheDocument();
    expect(screen.getByText('$1,489.47')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /bills before nov 21/i }));
    expect(screen.getByText('Spotify · paid Nov 9')).toBeInTheDocument();
    expect(screen.getByText('Planet Fitness · due Nov 18')).toBeInTheDocument();
  });

  it('ticking sets the money aside and reloads the goals', async () => {
    const onPlanChange = vi.fn();
    const onGoalsChanged = vi.fn();
    (tickPaycheckLine as Mock).mockResolvedValue({ data: configured({}, { done: true, set_aside: true }) });
    renderCard(configured(), { onPlanChange, onGoalsChanged });

    fireEvent.click(screen.getByRole('button', { name: 'Mark Summer 2027 done' }));

    await waitFor(() => expect(tickPaycheckLine).toHaveBeenCalledWith('2026-11-07', 11, true));
    expect(onPlanChange).toHaveBeenCalled();
    expect(onGoalsChanged).toHaveBeenCalled();
  });

  it('says when the account does not hold the money yet, and can mark it done only', async () => {
    (tickPaycheckLine as Mock)
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: { message: 'Home has $0.00 not set aside yet.', available: '0' } } } })
      .mockResolvedValueOnce({ data: configured({}, { done: true, set_aside: false }) });
    const onGoalsChanged = vi.fn();
    renderCard(configured(), { onGoalsChanged });

    fireEvent.click(screen.getByRole('button', { name: 'Mark Summer 2027 done' }));
    expect(await screen.findByText('Home has $0.00 not set aside yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark done without setting aside' }));
    await waitFor(() => expect(tickPaycheckLine).toHaveBeenLastCalledWith('2026-11-07', 11, false));
    expect(onGoalsChanged).not.toHaveBeenCalled();
  });

  it('undoes a tick', async () => {
    (untickPaycheckLine as Mock).mockResolvedValue({ data: configured() });
    const onGoalsChanged = vi.fn();
    renderCard(configured({}, { done: true, set_aside: true }), { onGoalsChanged });

    expect(screen.getByText('Set aside in Home')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo Summer 2027' }));

    await waitFor(() => expect(untickPaycheckLine).toHaveBeenCalledWith('2026-11-07', 11));
    expect(onGoalsChanged).toHaveBeenCalled();
  });

  it('warns when the plan asks for more than the paycheck', () => {
    renderCard(configured({ free: '-210.00' }));
    expect(screen.getByText('−$210.00')).toBeInTheDocument();
    expect(screen.getByText(/asks for more than this paycheck/)).toBeInTheDocument();
  });

  it('renders nothing while the plan is unavailable', () => {
    const { container } = renderCard(null);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PaycheckPlanSheet', () => {
  it('starts with the suggested payers ticked and saves what was entered', async () => {
    (savePaycheckPlan as Mock).mockResolvedValue({ data: configured() });
    const onSaved = vi.fn();
    render(<PaycheckPlanSheet isOpen onClose={vi.fn()} plan={unconfigured} goals={goals} accounts={accounts} onSaved={onSaved} />);

    expect(screen.getByRole('checkbox', { name: /PHILIPS/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Passavant/ })).toBeChecked();
    // Cards cannot hold goal money.
    const accountsFor = within(screen.getByRole('combobox', { name: 'Account for Summer 2027' })).getAllByRole('option').map(o => o.textContent);
    expect(accountsFor).toEqual(['No account', 'Spend', 'Home']);

    fireEvent.change(screen.getByLabelText('Summer 2027'), { target: { value: '1500' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Account for Summer 2027' }), { target: { value: '52' } });
    expect(screen.getByText('$1,500.00 a payday to goals, about $3,255.00 a month.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => expect(savePaycheckPlan).toHaveBeenCalledWith({
      sources: [{ merchant_key: 'philips', name: 'PHILIPS' }, { merchant_key: 'passavant', name: 'Passavant' }],
      lines: [{ goal_id: 2, amount: 1500, account_id: 52 }],
      notify: true,
    }));
    expect(onSaved).toHaveBeenCalled();
  });

  it('keeps an existing plan as it was saved', () => {
    render(<PaycheckPlanSheet isOpen onClose={vi.fn()} plan={{ ...configured(), sources: [{ merchant_key: 'philips', name: 'PHILIPS' }] }}
      goals={goals} accounts={accounts} onSaved={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: /PHILIPS/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Passavant/ })).not.toBeChecked();
    expect(screen.getByLabelText('Summer 2027')).toHaveValue(1500);
  });
});

describe('daysUntil', () => {
  it('counts calendar days from today', () => {
    expect(daysUntil('2026-11-21', TODAY)).toBe(11);
    expect(daysUntil('2026-11-10', TODAY)).toBe(0);
    expect(daysUntil('2026-11-07', TODAY)).toBe(-3);
  });
});
