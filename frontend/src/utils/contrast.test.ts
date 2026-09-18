import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance, readableOn } from './contrast';

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#F97316', '#FFFFFF')!).toBeLessThan(3);      // why white on ember was replaced
    expect(contrastRatio('#F97316', '#0A0A0B')!).toBeGreaterThan(7);   // the ink that replaced it
    expect(contrastRatio('#F87171', '#342020')!).toBeGreaterThan(4.5); // the lighter expense tab red
    expect(luminance('nope')).toBeNull();
    expect(luminance('#fff')).toBeCloseTo(1, 5);
  });

  it('picks the more readable text colour for a user-chosen fill', () => {
    expect(readableOn('#f59e0b')).toBe('#0A0A0B'); // amber: ink
    expect(readableOn('#1e3a8a')).toBe('#FFFFFF'); // navy: white
    expect(readableOn('#6366f1')).toBe('#FFFFFF'); // indigo: white
    expect(readableOn('var(--accent)')).toBe('#0A0A0B'); // not hex: safe default
  });
});
