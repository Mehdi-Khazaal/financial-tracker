import { vi, type Mock } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Asset } from '../../types';
import AddAssetModal from './AddAssetModal';
import { createAsset, getMetalPrices, updateAsset } from '../../utils/api';

vi.mock('../../utils/api', () => ({
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  getMetalPrices: vi.fn(),
}));
vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), confirm: vi.fn() }),
}));

beforeEach(() => {
  (createAsset as Mock).mockResolvedValue({ data: {} });
  (updateAsset as Mock).mockResolvedValue({ data: {} });
  (getMetalPrices as Mock).mockResolvedValue({ data: [{ metal: 'gold', price: '4000', fetched_at: '2026-11-10T15:00:00' }] });
});

const ounces: Asset = {
  id: 8, user_id: 1, name: 'Gold Ounce', type: 'jewelry', asset_class: 'physical',
  quantity: 2, value_per_unit: 4000, total_value: 8000, currency: 'USD', purchase_date: '2026-10-14',
  metal: null, weight_grams: null, purity: null, created_at: '', updated_at: '',
};

const metalToggle = () => screen.getByRole('checkbox', { name: /value it by its gold or silver/i });

/**
 * Gold valued by what it contains. The live account's six gold pieces sat at
 * purchase price; pricing one now takes a preset and a quantity.
 */
describe('AddAssetModal metal pricing', () => {
  it('prices an existing piece from a preset and previews the value', async () => {
    render(<AddAssetModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} mode="physical" asset={ounces} />);

    fireEvent.click(metalToggle());
    fireEvent.change(screen.getByLabelText('Common pieces'), { target: { value: 'gold-oz' } });

    expect(await screen.findByText(/worth about \$7,999\.20 today/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateAsset).toHaveBeenCalledWith(8, expect.objectContaining({
      metal: 'gold', weight_grams: 31.1034768, purity: 0.9999, total_value: 8000,
    })));
  });

  it('fills a Lebanese 21k lira from its preset', async () => {
    const lira = { ...ounces, name: 'Gold Lira', quantity: 1, value_per_unit: 1050, total_value: 1050 };
    render(<AddAssetModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} mode="physical" asset={lira} />);

    fireEvent.click(metalToggle());
    fireEvent.change(screen.getByLabelText('Common pieces'), { target: { value: 'lira-lebanese' } });

    expect(screen.getByLabelText('Purity')).toHaveValue('0.875');
    expect(screen.getByLabelText('Weight of one piece')).toHaveValue(8);
    expect(await screen.findByText(/this is worth about \$900\.22 today/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateAsset).toHaveBeenCalledWith(8, expect.objectContaining({
      metal: 'gold', weight_grams: 8, purity: 0.875,
    })));
  });

  it('turning it off on an edit clears it', async () => {
    render(
      <AddAssetModal
        isOpen onClose={vi.fn()} onSuccess={vi.fn()} mode="physical"
        asset={{ ...ounces, metal: 'gold', weight_grams: '31.1034768', purity: '0.9999' }}
      />,
    );

    expect(metalToggle()).toBeChecked();
    fireEvent.click(metalToggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalledWith(8, expect.objectContaining({
      metal: null, weight_grams: null, purity: null,
    })));
  });

  it('is not offered for real estate', () => {
    render(<AddAssetModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} mode="physical" />);
    expect(screen.queryByRole('checkbox', { name: /value it by its gold or silver/i })).not.toBeInTheDocument();
  });

  it('weighs custom jewelry in grams with a karat', async () => {
    render(<AddAssetModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} mode="physical" />);
    fireEvent.click(screen.getByRole('button', { name: /jewelry/i }));
    fireEvent.click(metalToggle());
    fireEvent.change(screen.getByLabelText('Purity'), { target: { value: '0.75' } });
    fireEvent.change(screen.getByLabelText('Weight of one piece'), { target: { value: '12.5' } });

    // 12.5 g × 0.75 / 31.1034768 × 4,000.
    expect(await screen.findByText(/worth about \$1,205\.65 today/)).toBeInTheDocument();
  });
});
