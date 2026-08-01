import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
