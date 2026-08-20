import { useEffect, useState } from 'react';

/** Matches the Tailwind `lg` breakpoint, where the two-pane layout begins. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * Whether the viewport is wide enough for the two-pane Settings layout.
 *
 * Deliberately a media *query* rather than CSS `display` toggling. Rendering
 * both layouts and hiding one would put two `<nav aria-label="Settings
 * sections">` elements and two `<h1>` elements in the document at once — a
 * screen reader announces both, since `display:none` from a stylesheet is the
 * only thing separating them and assistive technology walking the accessibility
 * tree is not helped by a duplicate it must learn to ignore.
 *
 * `matchMedia` is guarded: it is absent in jsdom and in some embedded webviews,
 * and an unguarded call throws during the effect. Matches the check already
 * used in `CountUp.tsx`, `Money.tsx` and `Sparkline.tsx`. Absent means mobile,
 * which is the layout that degrades more gracefully — a section list on a wide
 * screen is merely plain, whereas a two-pane grid on a 320px phone is broken.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(DESKTOP_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(query.matches);

    // `addEventListener` is the modern API; older WebKit only has the
    // deprecated `addListener`, and Fintrack is installed as a PWA on phones
    // that may still be on it.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  return isDesktop;
}
