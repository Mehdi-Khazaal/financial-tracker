import fs from 'fs';
import path from 'path';

/**
 * Mobile fixed-control geometry.
 *
 * Two floating bars sit over the bottom of every page on a phone — the context
 * tabs and the dock — and a third thing, the page's own bottom padding, has to
 * clear both. All three are derived from the same custom properties, so the
 * invariant worth protecting is the arithmetic between them rather than any
 * individual pixel value. A reserve that stops matching the controls is
 * invisible in code review and very visible on a phone.
 *
 * Read from the stylesheet rather than the DOM: jsdom does not resolve nested
 * `calc()` over custom properties, so asserting against a rendered element
 * would pass whatever the values were.
 */

const css = fs.readFileSync(path.join(__dirname, '../../index.css'), 'utf8');

const declaration = (name: string): string => {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing custom property ${name}`);
  return match[1].trim();
};

const px = (name: string): number => {
  const value = declaration(name);
  const match = value.match(/^(\d+(?:\.\d+)?)px$/);
  if (!match) throw new Error(`${name} is not a plain pixel value: ${value}`);
  return Number(match[1]);
};

describe('bottom control geometry', () => {
  it('leaves visible daylight between the context tabs and the dock', () => {
    // At 8px the two dark pills read as one control with a seam in it.
    expect(px('--context-tabs-gap')).toBeGreaterThanOrEqual(12);
  });

  it('does not spend an unreasonable amount of viewport on the gap', () => {
    expect(px('--context-tabs-gap')).toBeLessThanOrEqual(20);
  });

  it('keeps the combined controls inside a sensible share of a small phone', () => {
    // Dock shell + its edge gap + tabs + gap, against a 568pt viewport.
    const total = px('--dock-shell-height') + px('--dock-edge-gap')
      + px('--context-tabs-height') + px('--context-tabs-gap');

    expect(total).toBeLessThan(160);
  });
});

describe('page bottom reserve clears both bars', () => {
  it('derives the tabs reserve from the dock reserve, not a magic number', () => {
    const reserve = declaration('--mobile-tabs-reserve');

    expect(reserve).toContain('--mobile-dock-reserve');
    expect(reserve).toContain('--context-tabs-height');
    expect(reserve).toContain('--context-tabs-gap');
  });

  it('positions the context tabs above the dock using the same gap', () => {
    const bottom = declaration('--mobile-context-bottom');

    expect(bottom).toContain('--dock-height');
    expect(bottom).toContain('--context-tabs-gap');
  });

  it('accounts for the safe-area inset in both the reserve and the offset', () => {
    expect(declaration('--mobile-dock-reserve')).toContain('--safe-bottom');
    expect(declaration('--mobile-context-bottom')).toContain('--safe-bottom');
  });

  it('clears the tabs with room to spare rather than exactly', () => {
    // reserve − (dock + gap + tabs) is the visible breathing room above the
    // topmost bar. Zero would leave the last row touching it.
    const dockReserveSlack = 16;
    expect(declaration('--mobile-dock-reserve')).toContain(`${dockReserveSlack}px`);
  });
});

describe('scrolling regions opt into the reserve', () => {
  it('applies the tabs reserve to pages that have context tabs', () => {
    expect(css).toContain('body.has-mobile-context-tabs .mobile-tabs-spacer');
    expect(css).toMatch(/\.mobile-tabs-spacer[\s\S]{0,200}--mobile-tabs-reserve/);
  });

  it('still reserves for the dock alone elsewhere', () => {
    expect(css).toMatch(/\.mobile-dock-spacer[\s\S]{0,200}--mobile-dock-reserve/);
  });
});
