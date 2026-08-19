import type { Category } from '../../types';

/**
 * Categories offerable for a given direction.
 *
 * An `investment` category is offered in *both* directions, because the sign
 * already carries the direction: buying gold is money out, selling it is money
 * in, and both belong to the same category. Filtering strictly by `type` would
 * hide it from the expense picker — where a purchase is actually filed — and
 * leave a transaction that already holds one showing a blank dropdown.
 */
export const selectableCategories = (categories: Category[], type: 'income' | 'expense'): Category[] =>
  categories.filter(c => c.type === type || c.type === 'investment');
