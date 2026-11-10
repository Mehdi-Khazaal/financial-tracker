import React, { useEffect, useState } from 'react';
import type { MetalPrice } from '../../../types';
import { getMetalPrices } from '../../../utils/api';
import { dollars } from '../../analytics/format';
import {
  PRESETS, PURITIES, TROY_OUNCE_GRAMS, fineOunces, gramsFrom, metalValue,
  type Metal,
} from '../calculations/metal';

/**
 * "Value it by its gold": the inputs that let the server price a piece from
 * today's gold price instead of leaving it at what was paid.
 *
 * Controlled by the asset form. A preset fills the weight and purity for the
 * common coins and bars; anything else is weighed in grams or troy ounces with
 * a karat. The preview uses the same arithmetic as the server, so the value it
 * shows is the value the piece will get.
 */

export interface MetalFieldsState {
  enabled: boolean;
  metal: Metal;
  weight: string;
  unit: 'g' | 'oz';
  purity: number;
}

export const EMPTY_METAL_FIELDS: MetalFieldsState = {
  enabled: false, metal: 'gold', weight: '', unit: 'g', purity: PURITIES.gold[0].purity,
};

/** The three API fields, or nulls when metal pricing is off or incomplete. */
export function metalPayload(state: MetalFieldsState): { metal: Metal | null; weight_grams: number | null; purity: number | null } {
  const weight = parseFloat(state.weight);
  if (!state.enabled || !(weight > 0) || !(state.purity > 0)) return { metal: null, weight_grams: null, purity: null };
  return { metal: state.metal, weight_grams: Number(gramsFrom(weight, state.unit).toFixed(7)), purity: state.purity };
}

/** Form state for an existing asset. */
export function metalFieldsFrom(asset: { metal?: string | null; weight_grams?: number | string | null; purity?: number | string | null } | null): MetalFieldsState {
  if (!asset?.metal || asset.weight_grams == null || asset.purity == null) return EMPTY_METAL_FIELDS;
  const grams = Number(asset.weight_grams);
  const isOunce = Math.abs(grams - TROY_OUNCE_GRAMS) < 0.001;
  return {
    enabled: true,
    metal: asset.metal === 'silver' ? 'silver' : 'gold',
    weight: isOunce ? '1' : String(Number(grams.toFixed(4))),
    unit: isOunce ? 'oz' : 'g',
    purity: Number(asset.purity),
  };
}

interface Props {
  value: MetalFieldsState;
  onChange: (next: MetalFieldsState) => void;
  /** How many units, for the preview. */
  quantity: number;
}

const MetalPricingFields: React.FC<Props> = ({ value, onChange, quantity }) => {
  const [prices, setPrices] = useState<MetalPrice[]>([]);
  const set = (patch: Partial<MetalFieldsState>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (!value.enabled) return;
    getMetalPrices()
      .then(res => setPrices(Array.isArray(res.data) ? res.data : []))
      .catch(() => setPrices([]));
  }, [value.enabled]);

  const price = Number(prices.find(p => p.metal === value.metal)?.price) || 0;
  const grams = gramsFrom(parseFloat(value.weight) || 0, value.unit);
  const preview = metalValue(grams, value.purity, quantity > 0 ? quantity : 1, price);
  const purities = PURITIES[value.metal];

  return (
    <div className="rounded-lg p-3 space-y-3" style={{ border: '1px solid var(--line)' }}>
      <label className="flex items-start gap-3 cursor-pointer min-h-[44px]" htmlFor="metal-enabled">
        <input
          id="metal-enabled"
          type="checkbox"
          checked={value.enabled}
          onChange={e => set({ enabled: e.target.checked })}
          className="mt-1 w-4 h-4 shrink-0"
        />
        <span>
          <span className="block text-sm font-medium" style={{ color: 'var(--fg)' }}>Value it by its gold or silver</span>
          <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Priced every day from the metal it contains. Jewelry reads below what you paid, because the making charge is not metal.
          </span>
        </span>
      </label>

      {value.enabled && (
        <>
          <div>
            <label className="label mb-2 block" htmlFor="metal-preset">Common pieces</label>
            <select
              id="metal-preset"
              className="input-dark"
              value=""
              onChange={e => {
                const preset = PRESETS.find(p => p.id === e.target.value);
                if (!preset) return;
                const ounce = Math.abs(preset.grams - TROY_OUNCE_GRAMS) < 0.001;
                set({ metal: preset.metal, weight: ounce ? '1' : String(preset.grams), unit: ounce ? 'oz' : 'g', purity: preset.purity });
              }}
            >
              <option value="">Choose to fill in the weight and purity…</option>
              {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-2 block" htmlFor="metal-kind">Metal</label>
              <select
                id="metal-kind"
                className="input-dark"
                value={value.metal}
                onChange={e => {
                  const metal = e.target.value as Metal;
                  set({ metal, purity: PURITIES[metal][0].purity });
                }}
              >
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
              </select>
            </div>
            <div>
              <label className="label mb-2 block" htmlFor="metal-purity">Purity</label>
              <select
                id="metal-purity"
                className="input-dark"
                value={String(value.purity)}
                onChange={e => set({ purity: Number(e.target.value) })}
              >
                {purities.map(p => <option key={p.purity} value={String(p.purity)}>{p.label}</option>)}
                {!purities.some(p => p.purity === value.purity) && (
                  <option value={String(value.purity)}>{(value.purity * 100).toFixed(2)}%</option>
                )}
              </select>
            </div>
          </div>

          <div>
            <label className="label mb-2 block" htmlFor="metal-weight">Weight of one piece</label>
            <div className="flex gap-2">
              <input
                id="metal-weight"
                type="number"
                step="any"
                min="0"
                value={value.weight}
                onChange={e => set({ weight: e.target.value })}
                className="input-dark flex-1"
                placeholder={value.unit === 'g' ? '8.00' : '1'}
              />
              <select
                aria-label="Weight unit"
                className="input-dark w-28"
                value={value.unit}
                onChange={e => set({ unit: e.target.value as 'g' | 'oz' })}
              >
                <option value="g">grams</option>
                <option value="oz">troy oz</option>
              </select>
            </div>
          </div>

          <p className="text-xs" style={{ color: 'var(--muted)' }} aria-live="polite">
            {preview != null
              ? `${Number(fineOunces(grams, value.purity).toFixed(4))} oz of fine ${value.metal} each. At ${dollars(price)} an ounce, ${quantity > 1 ? 'these are' : 'this is'} worth about ${dollars(preview)} today.`
              : price > 0
                ? `${value.metal === 'gold' ? 'Gold' : 'Silver'} is ${dollars(price)} an ounce today. Enter the weight to see what this is worth.`
                : 'Enter the weight and purity. The value updates with the metal price every day.'}
          </p>
        </>
      )}
    </div>
  );
};

export default MetalPricingFields;
