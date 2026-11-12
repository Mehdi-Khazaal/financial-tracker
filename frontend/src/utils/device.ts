/**
 * Whether a sheet may put the cursor in its first field as it opens.
 *
 * On a computer that saves a click. On a phone it pops the on-screen keyboard
 * over a sheet the user has not looked at yet and shoves the form up, so
 * there the field waits to be tapped. "A computer" means the main pointer is
 * a mouse or trackpad that can hover; a tablet with a keyboard case still
 * counts as touch, which errs on the quiet side.
 *
 * Without `matchMedia` (tests) the answer is yes, as before.
 */
export function shouldAutoFocus(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}
