import React, { useId } from 'react';
import type { Category } from '../../../types';

/**
 * Controls shared by the add and edit transaction sheets, so both read and
 * behave the same: a segmented money-out / money-in switch and a set of
 * category chips.
 */

type Direction = 'income' | 'expense';

interface DirectionToggleProps {
  value: Direction;
  onChange: (next: Direction) => void;
}

export const DirectionToggle: React.FC<DirectionToggleProps> = ({ value, onChange }) => (
  <fieldset>
    <legend className="form-label">Type</legend>
    <div className="segmented">
      {(['expense', 'income'] as const).map(option => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option === 'expense' ? 'Expense' : 'Income'}
        </button>
      ))}
    </div>
  </fieldset>
);

interface CategoryChipsProps {
  categories: Category[];
  /** The chosen category id as a string; '' is uncategorized. */
  value: string;
  onChange: (id: string) => void;
  /** Sits at the right of the label, e.g. a "+ New" button. */
  action?: React.ReactNode;
  /** Id for the group, so a detail row can jump straight to it. */
  id?: string;
}

export const CategoryChips: React.FC<CategoryChipsProps> = ({ categories, value, onChange, action, id }) => {
  const labelId = useId();
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span id={labelId} className="form-label mb-0">Category</span>
        {action}
      </div>
      <div id={id} role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        <button
          type="button"
          className="choice-chip"
          aria-pressed={!value}
          onClick={() => onChange('')}
        >
          Uncategorized
        </button>
        {categories.map(category => (
          <button
            key={category.id}
            type="button"
            className="choice-chip"
            aria-pressed={value === String(category.id)}
            onClick={() => onChange(String(category.id))}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: category.color }} aria-hidden="true" />
            {category.name}
          </button>
        ))}
      </div>
    </div>
  );
};
