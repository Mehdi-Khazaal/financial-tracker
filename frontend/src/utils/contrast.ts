/**
 * Readable text on a colour the user chose.
 *
 * Category colours are picked from a palette or typed in, so no single text
 * colour works on all of them: white disappears on yellow, ink on navy. This
 * picks whichever of the two has the higher WCAG contrast ratio against the
 * fill. Non-hex input falls back to ink, which is the safer default on the
 * app's bright accents.
 */

const INK = '#0A0A0B';
const WHITE = '#FFFFFF';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rgb` / `#rrggbb` colour, or null. */
export function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].split('').map(d => d + d).join('') : match[1];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function readableOn(fill: string): string {
  const withInk = contrastRatio(fill, INK);
  const withWhite = contrastRatio(fill, WHITE);
  if (withInk === null || withWhite === null) return INK;
  return withWhite > withInk ? WHITE : INK;
}
