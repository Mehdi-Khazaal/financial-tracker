import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Asset } from '../../types';
import AddAssetModal from './AddAssetModal';
import { createAsset, updateAsset } from '../../utils/api';

jest.mock('../../utils/api', () => ({
  createAsset: jest.fn().mockResolvedValue({ data: {} }),
  updateAsset: jest.fn().mockResolvedValue({ data: {} }),
}));

const mockError = jest.fn();
jest.mock('../../context/ToastContext', () => ({
  useToast: () => ({ error: mockError, success: jest.fn(), info: jest.fn(), confirm: jest.fn() }),
}));

/**
 * The asset form, in both of its modes.
 *
 * The edit path exists because a recorded value could previously only be
 * corrected by deleting the asset and adding it again. These tests cover the
 * things that make an edit safe: the payload omits what must not change, a
 * failure leaves the modal open, and the ticker survives a round trip.
 */

const asset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 42,
  user_id: 1,
  name: 'Vanguard ETF (VTI)',
  type: 'etf',
  asset_class: 'investment',
  quantity: 40,
  value_per_unit: 250,
  total_value: 10000,
  currency: 'USD',
  purchase_date: '2026-01-15',
  created_at: '',
  updated_at: '',
  ...overrides,
});

const setup = (props: Partial<React.ComponentProps<typeof AddAssetModal>> = {}) => {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  const view = render(
    <AddAssetModal
      isOpen
      onClose={onClose}
      onSuccess={onSuccess}
      mode="investment"
      {...props}
    />,
  );
  return { ...view, onClose, onSuccess };
};

beforeEach(() => jest.clearAllMocks());

describe('add mode', () => {
  it('is titled as an addition', () => {
    setup();

    // Title and submit both say it; that is the point.
    expect(screen.getAllByText('Add Investment').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Add Investment/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('starts empty', () => {
    setup();

    screen.getAllByPlaceholderText('0.00').forEach(input => expect(input).toHaveValue(null));
  });

  it('accepts a ticker with no descriptive name, which the label calls optional', () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText('AAPL'), { target: { value: 'MSFT' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[1], { target: { value: '1500' } });

    expect(screen.getByRole('button', { name: /Add Investment/ })).toBeEnabled();
  });

  it('creates rather than updates', async () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText('AAPL'), { target: { value: 'msft' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[1], { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Investment/ }));

    await waitFor(() => expect(createAsset).toHaveBeenCalled());
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('sets the asset class on creation only', async () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText('AAPL'), { target: { value: 'MSFT' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[1], { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Investment/ }));

    await waitFor(() => expect(createAsset).toHaveBeenCalled());
    expect((createAsset as jest.Mock).mock.calls[0][0]).toMatchObject({ asset_class: 'investment' });
  });
});

describe('edit mode', () => {
  it('is titled as an edit, and its button saves rather than adds', () => {
    setup({ asset: asset() });

    expect(screen.getByText('Edit investment')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('loads the existing values', () => {
    setup({ asset: asset() });

    expect(screen.getByDisplayValue('40')).toBeInTheDocument();
    expect(screen.getByDisplayValue('250')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-01-15')).toBeInTheDocument();
  });

  it('splits a bracketed ticker back into name and symbol', () => {
    setup({ asset: asset({ name: 'Vanguard ETF (VTI)' }) });

    expect(screen.getByDisplayValue('Vanguard ETF')).toBeInTheDocument();
    expect(screen.getByDisplayValue('VTI')).toBeInTheDocument();
  });

  it('handles a bare ticker with no descriptive name', () => {
    setup({ asset: asset({ name: 'MSFT' }) });

    expect(screen.getByDisplayValue('MSFT')).toBeInTheDocument();
  });

  it('round-trips the ticker back into the stored name', async () => {
    setup({ asset: asset() });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalled());
    expect((updateAsset as jest.Mock).mock.calls[0][1]).toMatchObject({ name: 'Vanguard ETF (VTI)' });
  });

  it('updates the right asset by id', async () => {
    setup({ asset: asset({ id: 77 }) });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalledWith(77, expect.anything()));
  });

  it('never sends asset_class, so an edit cannot move the row to another tab', async () => {
    setup({ asset: asset() });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalled());
    expect((updateAsset as jest.Mock).mock.calls[0][1]).not.toHaveProperty('asset_class');
  });

  it('never sends identifiers', async () => {
    setup({ asset: asset() });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalled());
    const payload = (updateAsset as jest.Mock).mock.calls[0][1];
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('user_id');
  });

  it('carries an edited recorded value through', async () => {
    setup({ asset: asset() });

    fireEvent.change(screen.getByDisplayValue('10000'), { target: { value: '11500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalled());
    expect((updateAsset as jest.Mock).mock.calls[0][1]).toMatchObject({ total_value: 11500 });
  });

  it('recalculates the recorded total when quantity and unit value change', () => {
    setup({ asset: asset() });

    const quantity = screen.getByDisplayValue('40');
    fireEvent.change(quantity, { target: { value: '50' } });
    fireEvent.blur(quantity);

    // 50 × 250 = 12,500.
    expect(screen.getByDisplayValue('12500.00')).toBeInTheDocument();
  });

  it('does not destroy the recorded value when a ticker is removed', async () => {
    setup({ asset: asset() });

    fireEvent.change(screen.getByDisplayValue('VTI'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalled());
    const payload = (updateAsset as jest.Mock).mock.calls[0][1];
    expect(payload.total_value).toBe(10000);
    expect(payload.name).toBe('Vanguard ETF');
  });

  it('does not destroy the recorded value when the ticker is unknown', async () => {
    setup({ asset: asset() });

    fireEvent.change(screen.getByDisplayValue('VTI'), { target: { value: 'ZZZZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalled());
    // Pricing is a display concern; an unrecognised symbol must not zero the
    // value the user recorded.
    expect((updateAsset as jest.Mock).mock.calls[0][1].total_value).toBe(10000);
  });
});

describe('failure and cancellation', () => {
  it('keeps the modal open and reports the failure', async () => {
    (updateAsset as jest.Mock).mockRejectedValueOnce(new Error('nope'));
    const { onClose, onSuccess } = setup({ asset: asset() });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockError).toHaveBeenCalledWith('Failed to update'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('signals success only when the write landed', async () => {
    const { onClose, onSuccess } = setup({ asset: asset() });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('writes nothing when the form is simply closed', () => {
    setup({ asset: asset() });

    expect(updateAsset).not.toHaveBeenCalled();
    expect(createAsset).not.toHaveBeenCalled();
  });
});

describe('wording', () => {
  it('labels the figure a recorded value, never a cost basis', () => {
    setup({ asset: asset() });

    expect(screen.getByText('Recorded value')).toBeInTheDocument();
    // The old label is gone, and "cost basis" survives only inside the
    // explanation of what the figure is *not*.
    expect(screen.queryByText('Total Value')).not.toBeInTheDocument();
    expect(screen.queryByText('Cost Basis')).not.toBeInTheDocument();
  });

  it('explains that it is not a verified market or tax figure', () => {
    setup({ asset: asset() });

    expect(screen.getByText(/Not a verified purchase price/)).toBeInTheDocument();
    expect(screen.getByText(/not against a tax cost basis/)).toBeInTheDocument();
  });
});
