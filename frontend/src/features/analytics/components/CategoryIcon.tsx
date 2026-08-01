import React from 'react';

/**
 * A glyph for a spending category.
 *
 * Fintrack categories carry a name and a colour, but no icon — so this maps
 * keywords in the user's own category name onto a small fixed set. The match
 * is deliberately shallow: a keyword hit or the neutral tag fallback, with no
 * fuzzy matching that could confidently mislabel something.
 *
 * The icon is decorative. Colour and the category name already carry the
 * meaning, so it is always `aria-hidden`.
 */

type IconKey =
  | 'food' | 'transport' | 'home' | 'health' | 'shopping'
  | 'entertainment' | 'utilities' | 'travel' | 'education' | 'fitness' | 'tag';

const PATHS: Record<IconKey, string> = {
  food: 'M6.5 2.5v5.5a1.5 1.5 0 003 0V2.5M8 2.5v4.5M8 8v9.5M13.5 2.5c-1.2 1.6-1.5 3.2-1.5 5.5h3c0-2.3-.3-3.9-1.5-5.5zM13.5 8v9.5',
  transport: 'M4 13h12M5.2 13l1.1-3.8A1.5 1.5 0 017.7 8h4.6a1.5 1.5 0 011.4 1.2L14.8 13M4 13v2.5M16 13v2.5M6.6 15.5h.01M13.4 15.5h.01',
  home: 'M3.5 9L10 3.5 16.5 9M5 8v8.5h10V8M8.5 16.5v-4.5h3v4.5',
  health: 'M10 16.5s-5.5-3.4-5.5-7A3 3 0 0110 7.2 3 3 0 0115.5 9.5c0 3.6-5.5 7-5.5 7z',
  shopping: 'M5.5 6.5h9l1 10h-11l1-10zM7.5 6.5V5a2.5 2.5 0 015 0v1.5',
  entertainment: 'M3.5 5.5h13v9h-13zM8.5 8.5l4 2.5-4 2.5z',
  utilities: 'M11 2.5L5 11h4l-1 6.5L15 9h-4l1-6.5z',
  travel: 'M17 3.5L3 9l5 2 2 5 7-12.5z',
  education: 'M4 4.5h5a2 2 0 012 2v10a1.5 1.5 0 00-1.5-1.5H4v-10.5zM16 4.5h-5a2 2 0 00-2 2v10a1.5 1.5 0 011.5-1.5H16v-10.5z',
  fitness: 'M4 8v4M6.5 6.5v7M13.5 6.5v7M16 8v4M6.5 10h7',
  tag: 'M3.5 10.5l6-6h5.5v5.5l-6 6a1.5 1.5 0 01-2.1 0l-3.4-3.4a1.5 1.5 0 010-2.1zM12.6 7.4h.01',
};

/** Longest keywords first so "car insurance" does not match "car" before "insurance". */
const KEYWORDS: [IconKey, string[]][] = [
  ['food', ['grocer', 'restaurant', 'dining', 'takeaway', 'food', 'cafe', 'coffee', 'lunch', 'bar']],
  ['transport', ['motorcycle', 'transport', 'commut', 'parking', 'petrol', 'fuel', 'gas', 'car', 'taxi', 'uber', 'train', 'bus', 'bike']],
  ['home', ['mortgage', 'household', 'furniture', 'rent', 'home', 'house', 'garden']],
  ['health', ['healthcare', 'pharmacy', 'medical', 'dental', 'doctor', 'health', 'therapy']],
  ['shopping', ['clothing', 'shopping', 'clothes', 'retail', 'apparel', 'gift']],
  ['entertainment', ['entertainment', 'streaming', 'subscription', 'cinema', 'movie', 'music', 'gaming', 'game', 'hobby']],
  ['utilities', ['electricity', 'utilities', 'internet', 'utility', 'water', 'energy', 'phone', 'mobile', 'bill']],
  ['travel', ['holiday', 'travel', 'flight', 'hotel', 'vacation']],
  ['education', ['education', 'tuition', 'school', 'course', 'book']],
  ['fitness', ['fitness', 'gym', 'sport', 'workout']],
];

export function categoryIconKey(name: string): IconKey {
  const haystack = name.toLowerCase();
  for (const [key, words] of KEYWORDS) {
    if (words.some(word => haystack.includes(word))) return key;
  }
  return 'tag';
}

interface Props {
  name: string;
  color: string;
  size?: number;
  className?: string;
}

const CategoryIcon: React.FC<Props> = ({ name, color, size = 36, className }) => (
  <span
    className={`inline-flex items-center justify-center rounded-xl shrink-0 ${className ?? ''}`}
    style={{
      width: size,
      height: size,
      // A tint of the category's own colour, so the token reads as that
      // category without introducing a second palette.
      backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`,
      border: `1px solid color-mix(in oklab, ${color} 28%, transparent)`,
    }}
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size * 0.55, height: size * 0.55 }}
    >
      <path d={PATHS[categoryIconKey(name)]} />
    </svg>
  </span>
);

export default CategoryIcon;
