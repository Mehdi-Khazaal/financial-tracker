import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import RulesSection from './RulesSection';
import { useRules } from '../hooks/useRules';
import { applyRule, createRule, deleteRule, getRules, previewRule, updateRule } from '../../../utils/api';
import type { Category, CategorizationRule } from '../../../types';
import type { UseCategories } from '../hooks/useCategories';

const { mockConfirm, mockSuccess, mockError } = vi.hoisted(() => ({ mockConfirm: vi.fn(), mockSuccess: vi.fn(), mockError: vi.fn() }));

vi.mock('../../../utils/api', () => ({
  __esModule: true,
  getRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  deleteRule: vi.fn(),
  previewRule: vi.fn(),
  applyRule: vi.fn(),
}));

vi.mock('../../../context/ToastContext', () => ({
  useToast: () => ({ error: mockError, success: mockSuccess, info: vi.fn(), confirm: mockConfirm }),
}));

const category = (id: number, name: string): Category => ({ id, name, type: 'expense', color: '#fff', user_id: 1, is_system: false, created_at: '2026-01-01' });
const categories: UseCategories = {
  status: 'ready', items: [category(1, 'Subscriptions'), category(2, 'Groceries')], reload: vi.fn(),
  create: vi.fn(), rename: vi.fn(), remove: vi.fn(),
};
const rule = (over: Partial<CategorizationRule> = {}): CategorizationRule => ({
  id: 7, category_id: 1, field: 'description', match_type: 'contains', pattern: 'netflix', priority: 100, is_active: true, applied_count: 3, ...over,
});

const Harness: React.FC<{ initialDraft?: { pattern: string } | null }> = ({ initialDraft = null }) => {
  const rules = useRules();
  return <RulesSection rules={rules} categories={categories} initialDraft={initialDraft} />;
};

beforeEach(() => {
  (getRules as Mock).mockResolvedValue({ data: [] });
  (createRule as Mock).mockResolvedValue({ data: {} });
  (updateRule as Mock).mockResolvedValue({ data: {} });
  (deleteRule as Mock).mockResolvedValue({ data: {} });
  (applyRule as Mock).mockResolvedValue({ data: { changed: 2 } });
  (previewRule as Mock).mockResolvedValue({ data: { matched: 0, would_change: 0, protected: 0, sample: [] } });
  mockConfirm.mockResolvedValue(true);
});

describe('RulesSection', () => {
  it('lists rules in plain words with their category and count', async () => {
    (getRules as Mock).mockResolvedValue({ data: [rule(), rule({ id: 8, pattern: '^uber', match_type: 'regex', field: 'merchant', category_id: 2, is_active: false, applied_count: 0 })] });
    render(<Harness />);
    expect(await screen.findByText('description contains “netflix”')).toBeInTheDocument();
    expect(screen.getByText('merchant matches “^uber”')).toBeInTheDocument();
    expect(screen.getByText(/→ Subscriptions/)).toBeInTheDocument();
    expect(screen.getByText(/filed 3/)).toBeInTheDocument();
    expect(screen.getByText(/paused/)).toBeInTheDocument();
  });

  it('previews a draft and saves it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    (previewRule as Mock).mockResolvedValue({
      data: { matched: 4, would_change: 2, protected: 1, sample: [{ id: 1, description: 'NETFLIX.COM', amount: '-15.99', transaction_date: '2026-03-01', category_id: null, category_source: null, would_change: true }] },
    });
    render(<Harness />);
    await screen.findByText(/No rules yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));

    const form = screen.getByRole('form', { name: 'New rule' });
    fireEvent.change(within(form).getByLabelText('Text'), { target: { value: 'netflix' } });
    fireEvent.change(within(form).getByLabelText('File it under'), { target: { value: '1' } });

    await waitFor(() => expect(previewRule).toHaveBeenCalledWith({ category_id: 1, field: 'description', match_type: 'contains', pattern: 'netflix' }));
    expect(await within(form).findByText(/Matches/)).toHaveTextContent('Matches 4 past transactions · 2 would move · 1 filed by hand, left alone');
    expect(within(form).getByText('NETFLIX.COM')).toBeInTheDocument();

    fireEvent.click(within(form).getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(createRule).toHaveBeenCalledWith({ category_id: 1, field: 'description', match_type: 'contains', pattern: 'netflix', priority: 100 }));
    await waitFor(() => expect(mockSuccess).toHaveBeenCalledWith('Rule saved'));
    vi.useRealTimers();
  });

  it('shows a server rejection against the pattern field', async () => {
    (createRule as Mock).mockRejectedValue({ response: { data: { detail: 'pattern is not a valid regular expression: missing )' } } });
    render(<Harness />);
    await screen.findByText(/No rules yet/);
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    const form = screen.getByRole('form', { name: 'New rule' });
    fireEvent.change(within(form).getByLabelText('Match type'), { target: { value: 'regex' } });
    fireEvent.change(within(form).getByLabelText('Pattern'), { target: { value: '(' } });
    fireEvent.change(within(form).getByLabelText('File it under'), { target: { value: '1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save rule' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('missing )');
  });

  it('opens the sheet prefilled when a draft arrives from a transaction', async () => {
    render(<Harness initialDraft={{ pattern: 'Spotify' }} />);
    const form = await screen.findByRole('form', { name: 'New rule' });
    expect(within(form).getByLabelText('Text')).toHaveValue('Spotify');
  });

  it('applies to the past, pauses and removes from the row menu', async () => {
    (getRules as Mock).mockResolvedValue({ data: [rule()] });
    render(<Harness />);
    await screen.findByText('description contains “netflix”');
    const menu = screen.getByRole('button', { name: 'description contains “netflix” actions' });

    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Apply to past transactions' }));
    await waitFor(() => expect(applyRule).toHaveBeenCalledWith(7));
    await waitFor(() => expect(mockSuccess).toHaveBeenCalledWith('2 transactions filed'));

    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' }));
    await waitFor(() => expect(updateRule).toHaveBeenCalledWith(7, { is_active: false }));

    mockConfirm.mockResolvedValue(false);
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(deleteRule).not.toHaveBeenCalled();
  });
});
