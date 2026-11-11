import { PRESETS, TROY_OUNCE_GRAMS, describeMetal, fineOunces, gramsFrom, metalValue, summariseMetal } from './metal';
import { metalFieldsFrom, metalPayload, EMPTY_METAL_FIELDS } from '../components/MetalPricingFields';

/**
 * The preview arithmetic must match the server's (`services/valuation.py`),
 * or the form would promise one value and the page show another. The server
 * test pins the same cases: 2 × 1 oz at $4,000 is $7,999.20 at 0.9999 fine,
 * and an English gold lira (7.988 g, 22k) is $941.71.
 */
describe('metal arithmetic', () => {
  it('values coins by their fine gold, like the server', () => {
    expect(metalValue(TROY_OUNCE_GRAMS, 0.9999, 2, 4000)).toBeCloseTo(7999.20, 2);
    expect(metalValue(7.988, 0.9167, 1, 4000)).toBeCloseTo(941.71, 2);
  });

  it('values a Lebanese 21k lira below the English 22k one', () => {
    const lebanese = PRESETS.find(p => p.id === 'lira-lebanese')!;
    const english = PRESETS.find(p => p.id === 'lira-english')!;
    // 8 g × 0.875 = 7 g of gold, against 7.32 g in a Royal Mint sovereign.
    expect(metalValue(lebanese.grams, lebanese.purity, 1, 4000)).toBeCloseTo(900.22, 2);
    expect(metalValue(english.grams, english.purity, 1, 4000)).toBeCloseTo(941.71, 2);
    expect(describeMetal({ metal: 'gold', weight_grams: lebanese.grams, purity: lebanese.purity })).toBe('8 g · 21k gold');
  });

  it('has no value until every input is there', () => {
    expect(metalValue(0, 0.9999, 1, 4000)).toBeNull();
    expect(metalValue(10, 0, 1, 4000)).toBeNull();
    expect(metalValue(10, 0.9999, 1, 0)).toBeNull();
    expect(metalValue(Number.NaN, 0.9999, 1, 4000)).toBeNull();
  });

  it('converts troy ounces to grams', () => {
    expect(gramsFrom(1, 'oz')).toBe(TROY_OUNCE_GRAMS);
    expect(gramsFrom(8, 'g')).toBe(8);
    expect(fineOunces(TROY_OUNCE_GRAMS, 1)).toBe(1);
  });
});

describe('describeMetal', () => {
  it('names a coin by the ounce and its karat', () => {
    expect(describeMetal({ metal: 'gold', weight_grams: '31.1034768', purity: '0.9999' })).toBe('1 oz · 24k gold');
  });

  it('names a piece by its grams', () => {
    expect(describeMetal({ metal: 'gold', weight_grams: 7.988, purity: 0.9167 })).toBe('7.99 g · 22k gold');
  });

  it('shows an unusual purity as a percentage', () => {
    expect(describeMetal({ metal: 'silver', weight_grams: 100, purity: 0.8 })).toBe('100 g · 80% silver');
  });

  it('is nothing for a piece not priced by metal', () => {
    expect(describeMetal({ metal: null, weight_grams: null, purity: null })).toBeNull();
  });
});

describe('metal form state', () => {
  it('sends grams, converting ounces, and the purity', () => {
    expect(metalPayload({ enabled: true, metal: 'gold', weight: '1', unit: 'oz', purity: 0.9999 }))
      .toEqual({ metal: 'gold', weight_grams: 31.1034768, purity: 0.9999 });
  });

  it('sends nulls when switched off or incomplete, so an edit clears it', () => {
    const off = { metal: null, weight_grams: null, purity: null };
    expect(metalPayload(EMPTY_METAL_FIELDS)).toEqual(off);
    expect(metalPayload({ enabled: true, metal: 'gold', weight: '', unit: 'g', purity: 0.75 })).toEqual(off);
  });

  it('reads an existing piece back, showing an ounce as an ounce', () => {
    expect(metalFieldsFrom({ metal: 'gold', weight_grams: '31.1034768', purity: '0.9999' }))
      .toEqual({ enabled: true, metal: 'gold', weight: '1', unit: 'oz', purity: 0.9999 });
    expect(metalFieldsFrom({ metal: 'gold', weight_grams: '7.9880500', purity: '0.9167' }))
      .toEqual({ enabled: true, metal: 'gold', weight: '7.9881', unit: 'g', purity: 0.9167 });
    expect(metalFieldsFrom(null)).toEqual(EMPTY_METAL_FIELDS);
  });
});

describe('summariseMetal', () => {
  // The live account's six gold pieces and what they cost.
  const piece = (id: number, quantity: number, paid: number, grams: number, purity: number) => ({
    id, user_id: 1, name: 'Gold', type: 'jewelry', asset_class: 'physical', quantity, value_per_unit: paid / quantity,
    total_value: paid, currency: 'USD', purchase_date: null, metal: 'gold', weight_grams: grams, purity,
    created_at: '', updated_at: '',
  }) as unknown as import('../../../types').Asset;
  const pieces = [
    piece(17, 2, 8000, TROY_OUNCE_GRAMS, 0.9999),
    piece(15, 1, 4099.99, TROY_OUNCE_GRAMS, 0.9999),
    piece(14, 1, 1050, 8, 0.875),
    piece(13, 1, 3620, TROY_OUNCE_GRAMS, 0.9999),
    piece(12, 2, 1460, 8, 0.875),
    piece(11, 1, 1200, 8, 0.875),
  ];
  const valuations = Object.fromEntries(pieces.map(p => [p.id, {
    current_value: metalValue(Number(p.weight_grams), Number(p.purity), Number(p.quantity), 4048.8)!.toFixed(2),
    spot_price: '4048.8',
  }]));

  it('adds up the pure gold, the cost and the value', () => {
    const gold = summariseMetal(pieces, valuations, 'gold')!;

    // Four 0.9999 ounces and four 21k liras of 7 g pure gold each.
    expect(gold.fineOunces).toBeCloseTo(3.9996 + 28 / TROY_OUNCE_GRAMS, 4);
    expect(gold.holdings).toBe(6);
    expect(gold.paid).toBeCloseTo(19429.99, 2);
    expect(gold.value).toBeCloseTo(gold.fineOunces * 4048.8, 0);
    expect(gold.averageCostPerOunce).toBeCloseTo(3965.45, 1);
    expect(gold.spotPrice).toBe(4048.8);
    expect(gold.gain).toBeCloseTo(gold.value - gold.paid, 2);
  });

  it('values an unpriced piece at what was paid, and ignores other metals', () => {
    const gold = summariseMetal(pieces.slice(0, 1), {}, 'gold')!;
    expect(gold.value).toBe(8000);
    expect(gold.spotPrice).toBeNull();
    expect(summariseMetal(pieces, valuations, 'silver')).toBeNull();
  });
});
