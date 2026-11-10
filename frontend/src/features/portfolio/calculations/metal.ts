/**
 * Gold and silver held as coins, bars or jewelry.
 *
 * A piece is valued by its fine metal: weight × purity, in troy ounces, at the
 * metal's price. The server does the valuation (`services/valuation.py`); this
 * module holds what the form needs to collect the inputs and preview the
 * result with the same arithmetic.
 */

import type { Asset } from '../../../types';

export type Metal = 'gold' | 'silver';

export const TROY_OUNCE_GRAMS = 31.1034768;

export interface PurityOption {
  label: string;
  /** Share of the weight that is the metal. */
  purity: number;
}

export const PURITIES: Record<Metal, PurityOption[]> = {
  gold: [
    { label: '24k (99.99%)', purity: 0.9999 },
    { label: '22k (91.67%)', purity: 0.9167 },
    { label: '21k (87.5%)', purity: 0.875 },
    { label: '18k (75%)', purity: 0.75 },
    { label: '14k (58.5%)', purity: 0.585 },
  ],
  silver: [
    { label: 'Fine (99.9%)', purity: 0.999 },
    { label: 'Sterling (92.5%)', purity: 0.925 },
  ],
};

export interface MetalPreset {
  id: string;
  label: string;
  metal: Metal;
  grams: number;
  purity: number;
}

/** Common pieces with a known weight and fineness, so nothing has to be looked up. */
export const PRESETS: MetalPreset[] = [
  { id: 'gold-oz', label: '1 oz gold coin or bar', metal: 'gold', grams: TROY_OUNCE_GRAMS, purity: 0.9999 },
  { id: 'gold-10g', label: '10 g gold bar', metal: 'gold', grams: 10, purity: 0.9999 },
  { id: 'lira-english', label: 'Gold lira, English (7.99 g, 22k)', metal: 'gold', grams: 7.98805, purity: 0.9167 },
  // The George V design struck in Lebanon (Lebanor and others): 8 g at 21k,
  // not the Royal Mint's 7.99 g at 22k.
  { id: 'lira-lebanese', label: 'Gold lira, Lebanese (8 g, 21k)', metal: 'gold', grams: 8, purity: 0.875 },
  { id: 'lira-ottoman', label: 'Gold lira, Ottoman (7.22 g, 22k)', metal: 'gold', grams: 7.216, purity: 0.9167 },
  { id: 'silver-oz', label: '1 oz silver coin', metal: 'silver', grams: TROY_OUNCE_GRAMS, purity: 0.999 },
];

/** Asset types where metal pricing is offered. */
export const METAL_TYPES = new Set(['jewelry', 'gold', 'silver', 'other']);

/** Troy ounces of fine metal in one unit. */
export const fineOunces = (weightGrams: number, purity: number): number =>
  (weightGrams * purity) / TROY_OUNCE_GRAMS;

/** What `quantity` units are worth at `pricePerOunce`, or null if any input is missing. */
export function metalValue(weightGrams: number, purity: number, quantity: number, pricePerOunce: number): number | null {
  if (!(weightGrams > 0) || !(purity > 0) || !(quantity > 0) || !(pricePerOunce > 0)) return null;
  return fineOunces(weightGrams, purity) * quantity * pricePerOunce;
}

export const gramsFrom = (value: number, unit: 'g' | 'oz'): number =>
  unit === 'oz' ? value * TROY_OUNCE_GRAMS : value;

/** "31.1 g · 24k gold" for a priced piece, or null when it is not priced by metal. */
export function describeMetal(asset: Pick<Asset, 'metal' | 'weight_grams' | 'purity'>): string | null {
  if (!asset.metal || asset.weight_grams == null || asset.purity == null) return null;
  const grams = Number(asset.weight_grams);
  const purity = Number(asset.purity);
  const option = PURITIES[asset.metal as Metal]?.find(o => Math.abs(o.purity - purity) < 0.0005);
  const fineness = option ? option.label.split(' ')[0] : `${(purity * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const weight = Math.abs(grams - TROY_OUNCE_GRAMS) < 0.001 ? '1 oz' : `${Number(grams.toFixed(2))} g`;
  return `${weight} · ${fineness} ${asset.metal}`;
}
