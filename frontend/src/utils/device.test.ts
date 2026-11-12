import { vi } from 'vitest';
import { shouldAutoFocus } from './device';
import { installNoZoom } from '../lib/noZoom';

/**
 * A sheet opened on a phone must not pop the keyboard before the user has
 * looked at it; on a computer the cursor still goes straight to the field.
 */
describe('shouldAutoFocus', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  const pointer = (fine: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(hover: hover) and (pointer: fine)' ? fine : false,
      media: query,
    })) as unknown as typeof window.matchMedia;
  };

  it('focuses on a computer with a mouse or trackpad', () => {
    pointer(true);
    expect(shouldAutoFocus()).toBe(true);
  });

  it('waits for a tap on a touch screen', () => {
    pointer(false);
    expect(shouldAutoFocus()).toBe(false);
  });
});

describe('installNoZoom', () => {
  it('cancels the iOS pinch gesture', () => {
    const doc = document.implementation.createHTMLDocument('t');
    installNoZoom(doc);
    const event = new Event('gesturestart', { cancelable: true });
    doc.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves ordinary touches alone', () => {
    const doc = document.implementation.createHTMLDocument('t');
    installNoZoom(doc);
    const event = new Event('touchstart', { cancelable: true });
    const spy = vi.fn();
    doc.addEventListener('touchstart', spy);
    doc.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalled();
  });
});
