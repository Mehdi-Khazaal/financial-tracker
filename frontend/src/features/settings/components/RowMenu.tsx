import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * A compact overflow menu for a list row.
 *
 * Replaces the pair of permanent 44px buttons every category row used to carry.
 * On a phone that was two large targets per row across twenty rows, which is
 * most of why the old list ran to ~800px; on desktop they were hover-revealed,
 * so keyboard users tabbed onto invisible controls. One trigger solves both.
 *
 * A real menu, not a styled dropdown: `aria-haspopup`, `aria-expanded`, and
 * `role="menu"`/`role="menuitem"` so it is announced as one. Escape and an
 * outside click dismiss it, and focus returns to the trigger on Escape so the
 * keyboard user is not dropped at the top of the document. Arrow keys move
 * between items; the pattern follows `InfoHint`, which already does the
 * open/dismiss half of this elsewhere in the app.
 */

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

interface Props {
  /** Names the menu for assistive technology, e.g. "Groceries actions". */
  label: string;
  items: RowMenuItem[];
}

const RowMenu: React.FC<Props> = ({ label, items }) => {
  const [open, setOpen] = useState(false);
  // Opens upward when there is not room below — the last row of a list sits
  // near the dock on a phone, where a downward menu would be unreachable.
  const [dropUp, setDropUp] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId().replace(/:/g, '');

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(true); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  const onItemKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = event.key === 'ArrowDown'
      ? (index + 1) % items.length
      : (index - 1 + items.length) % items.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <span className="relative inline-flex" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          // ~56px per item plus padding, and the mobile dock is ~96px tall.
          const needed = items.length * 56 + 24;
          if (rect) setDropUp(window.innerHeight - rect.bottom < needed + 96);
          setOpen(value => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        className="w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-colors"
        style={{ color: 'var(--muted)' }}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={`absolute right-0 z-30 min-w-[9rem] rounded-xl overflow-hidden ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
          style={{
            backgroundColor: 'var(--elev-2)',
            border: '1px solid var(--line)',
            boxShadow: 'var(--shadow-float)',
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={element => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              onClick={() => { close(false); item.onSelect(); }}
              onKeyDown={event => onItemKeyDown(event, index)}
              className="w-full text-left min-h-[44px] px-3.5 py-2.5 text-sm font-medium transition-colors"
              style={{ color: item.danger ? 'var(--neg)' : 'var(--fg)' }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
};

export default RowMenu;
