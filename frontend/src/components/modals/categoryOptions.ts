import type { Category } from '../../types';

/**
 * Categories offerable for a given direction.
 *
 * `investment` and `transfer` categories are offered in *both* directions,
 * because the sign already carries the direction: buying gold is money out,
 * selling it is money in; a card payment leaves checking and arrives on the
 * card. Filtering strictly by `type` would hide them from the picker where the
 * row is actually filed, and leave a transaction that already holds one
 * showing a blank dropdown.
 */
const EITHER_DIRECTION: Category['type'][] = ['investment', 'transfer'];

export const selectableCategories = (categories: Category[], type: 'income' | 'expense'): Category[] =>
  categories.filter(c => c.type === type || EITHER_DIRECTION.includes(c.type));
