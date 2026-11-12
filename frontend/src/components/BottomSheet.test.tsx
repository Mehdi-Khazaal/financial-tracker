import { vi } from 'vitest';
import React, { useState } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BottomSheet from './BottomSheet';

/**
 * These lock down the behaviours that were actually broken.
 *
 * The drawer used to render in place, inside `.stagger-in`'s transformed
 * wrapper. A `transform` on any ancestor makes it the containing block for
 * `position: fixed`, so the sheet sized itself against a ~10,000px-tall page
 * section instead of the viewport and ended up mostly off-screen. Portalling
 * to `<body>` is the fix, and the first test is what proves it.
 */

const Harness: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    // A transformed ancestor — exactly the condition that broke the old sheet.
    <div style={{ transform: 'translateY(10px)' }} data-testid="transformed-ancestor">
      <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
      <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Motorcycle">
        {children ?? (
          <>
            <button type="button">First action</button>
            <button type="button">Last action</button>
          </>
        )}
      </BottomSheet>
    </div>
  );
};

describe('BottomSheet', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('escapes a transformed ancestor by rendering into document.body', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));

    const dialog = screen.getByRole('dialog');
    const ancestor = screen.getByTestId('transformed-ancestor');

    expect(dialog).toBeInTheDocument();
    // The whole point: the panel must not live inside the transformed subtree.
    expect(ancestor.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('locks background scrolling while open and restores it after', () => {
    render(<Harness />);
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns focus to the trigger when closed', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open drawer' });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab inside the panel', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));

    const last = screen.getByRole('button', { name: 'Last action' });
    const close = screen.getByRole('button', { name: 'Close' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // Wrapped forward to the first focusable element in the panel.
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('is labelled as a modal dialog for assistive technology', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Motorcycle');
  });

  it('goes back on Escape when the sheet has a back step', () => {
    const onBack = vi.fn();
    const onClose = vi.fn();
    render(
      <BottomSheet isOpen onClose={onClose} onBack={onBack} title="Edit">
        <button type="button">Field</button>
      </BottomSheet>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('pins the footer outside the scrolling body', () => {
    render(
      <BottomSheet isOpen onClose={() => {}} title="Edit" footer={<button type="button">Save</button>}>
        <p>Body</p>
      </BottomSheet>,
    );

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.closest('.sheet-footer')).not.toBeNull();
    expect(save.closest('.sheet-body')).toBeNull();
  });

  it('leaves focus alone when the page behind re-renders', () => {
    // The parent passes a new onClose on every render, as most pages do.
    const Page: React.FC<{ tick: number }> = ({ tick }) => (
      <BottomSheet isOpen onClose={() => void tick} title="Details">
        <input aria-label="Note" />
      </BottomSheet>
    );
    const { rerender } = render(<Page tick={1} />);
    const note = screen.getByLabelText('Note');
    note.focus();

    rerender(<Page tick={2} />);
    expect(document.activeElement).toBe(note);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('ignores Escape while a confirm dialog on top has focus', () => {
    const onClose = vi.fn();
    render(
      <>
        <BottomSheet isOpen onClose={onClose} title="Details"><p>Body</p></BottomSheet>
        <div role="alertdialog" aria-label="Sure?"><button type="button">Cancel</button></div>
      </>,
    );
    screen.getByRole('button', { name: 'Cancel' }).focus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('plays its exit with the content it had, then unmounts', () => {
    vi.useFakeTimers();
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
    try {
      // The page clears the record as it closes the sheet, as many do.
      const Page: React.FC<{ name: string | null }> = ({ name }) => (
        <BottomSheet isOpen={!!name} onClose={() => {}} title="Category">
          {name && <p>{name}</p>}
        </BottomSheet>
      );
      const { rerender } = render(<Page name="Groceries" />);
      rerender(<Page name={null} />);

      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(document.querySelector('.sheet-root')).toHaveClass('is-exiting');
      expect(document.body.style.overflow).toBe('');

      act(() => { vi.advanceTimersByTime(250); });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
      vi.useRealTimers();
    }
  });

  it('keeps the title and close button outside the scrolling region', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));

    const header = screen.getByRole('heading', { name: 'Motorcycle' }).closest('.sheet-header');
    expect(header).not.toBeNull();
    // The close button lives in the fixed header, so it cannot scroll away.
    expect(header!.contains(screen.getByRole('button', { name: 'Close' }))).toBe(true);
    expect(header!.closest('.sheet-body')).toBeNull();
  });
});
