import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AddSavingsGoalModal from './AddSavingsGoalModal';
import { createSavingsGoal, updateSavingsGoal } from '../../utils/api';
import type { SavingsGoal } from '../../types';

vi.mock('../../utils/api', () => ({
  __esModule: true,
  createSavingsGoal: vi.fn(),
  updateSavingsGoal: vi.fn(),
}));

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => toast }));

beforeEach(() => {
  (createSavingsGoal as Mock).mockResolvedValue({ data: {} });
  (updateSavingsGoal as Mock).mockResolvedValue({ data: {} });
});

const emergency: SavingsGoal = {
  id: 5, user_id: 1, name: 'Emergency Funds', target_amount: 5000, deadline: '2026-07-01',
  is_emergency_fund: true, created_at: '', allocations: [], current_amount: 500,
};

/**
 * A goal could be created but never edited: the card said "adjusting the date
 * keeps the goal useful" with no way to adjust it. One form now does both, and
 * carries the emergency-fund mark that decides what counts as cover.
 */
describe('AddSavingsGoalModal', () => {
  it('edits a goal: fields start from it and the save goes to that goal', async () => {
    const onSuccess = vi.fn();
    render(<AddSavingsGoalModal isOpen onClose={vi.fn()} onSuccess={onSuccess} goal={{ ...emergency, is_emergency_fund: false, name: 'Trip' }} />);

    expect(screen.getByLabelText('Goal Name')).toHaveValue('Trip');
    expect(screen.getByLabelText(/^deadline/i)).toHaveValue('2026-07-01');
    expect(screen.getByRole('checkbox', { name: /this is my emergency fund/i })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText(/^deadline/i), { target: { value: '2027-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));

    await waitFor(() => expect(updateSavingsGoal).toHaveBeenCalledWith(5, {
      name: 'Trip', target_amount: 5000, deadline: '2027-05-01', is_emergency_fund: false,
    }));
    expect(onSuccess).toHaveBeenCalled();
    expect(createSavingsGoal).not.toHaveBeenCalled();
  });

  it('keeps no date on the emergency fund, which is never due', async () => {
    // The live fund carried a July date and read "Past deadline" ever since.
    render(<AddSavingsGoalModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} goal={emergency} />);

    expect(screen.getByRole('checkbox', { name: /this is my emergency fund/i })).toBeChecked();
    expect(screen.queryByLabelText(/^deadline/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));

    await waitFor(() => expect(updateSavingsGoal).toHaveBeenCalledWith(5, {
      name: 'Emergency Funds', target_amount: 5000, deadline: null, is_emergency_fund: true,
    }));
  });

  it('creates a goal and can mark it as the emergency fund', async () => {
    render(<AddSavingsGoalModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Goal Name'), { target: { value: 'Rainy day' } });
    fireEvent.change(screen.getByLabelText('Target Amount'), { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /this is my emergency fund/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Goal' }));

    await waitFor(() => expect(createSavingsGoal).toHaveBeenCalledWith({
      name: 'Rainy day', target_amount: 3000, deadline: null, is_emergency_fund: true,
    }));
  });

  it('says so when saving fails', async () => {
    (updateSavingsGoal as Mock).mockRejectedValue(new Error('500'));
    render(<AddSavingsGoalModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} goal={emergency} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update goal'));
  });
});
