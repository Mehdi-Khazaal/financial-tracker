/**
 * Test helper: build the server's valuation from a price table.
 *
 * The server owns ticker resolution and pricing (`services/valuation.py`); a
 * test that wants "VTI is at $268" needs the valuation the server would send
 * for that. This mirrors the server's rule closely enough for that purpose:
 * a holding whose name carries a priced ticker is worth price × quantity.
 */

import type { Asset } from '../../../types';
import type { Valuations } from './investments';

const tickerOf = (name: string): string | null => {
  const bracketed = name.match(/\(([A-Z0-9]+)\)/)?.[1];
  if (bracketed) return bracketed;
  const trimmed = name.trim();
  return /^[A-Z0-9]{1,10}$/.test(trimmed) ? trimmed : null;
};

export function marketValuations(assets: Asset[], prices: Record<string, number>): Valuations {
  const out: Record<number, Valuations[number]> = {};
  assets.forEach(asset => {
    const ticker = tickerOf(asset.name ?? '');
    const price = ticker != null ? prices[ticker] : undefined;
    if (price == null) return;
    const quantity = Number(asset.quantity ?? 1) || 0;
    const current = price * quantity;
    out[asset.id] = {
      asset_id: asset.id,
      current_value: current,
      recorded_value: Number(asset.total_value) || 0,
      change_since_recorded: current - (Number(asset.total_value) || 0),
      price_per_unit: price,
      source: 'market',
      priced_at: '2026-11-10T15:00:00',
    };
  });
  return out;
}
