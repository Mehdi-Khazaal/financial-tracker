/**
 * Light / dark mode.
 *
 * "system" (the default) follows the device: the stylesheet switches on
 * `prefers-color-scheme` by itself. Choosing light or dark in Settings pins it
 * by setting `data-theme` on <html>; `public/theme-init.js` re-applies a saved
 * choice before the first paint.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'ft_theme';
const BAR_COLORS = { light: '#FAFAF8', dark: '#0F1012' } as const;

export function getThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Put the choice on the page: the `data-theme` attribute and the browser bar colour. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);

  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => {
    const media = meta.getAttribute('media') ?? '';
    const own = media.includes('dark') ? BAR_COLORS.dark : BAR_COLORS.light;
    meta.setAttribute('content', preference === 'system' ? own : BAR_COLORS[preference]);
  });
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* Storage blocked: the choice lasts for this visit only. */
  }
  applyThemePreference(preference);
}
