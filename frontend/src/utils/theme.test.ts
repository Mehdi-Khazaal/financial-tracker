import { getThemePreference, setThemePreference } from './theme';

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#FAFAF8">'
      + '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0F1012">';
  });

  it('follows the system until a mode is chosen', () => {
    expect(getThemePreference()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('pins light or dark, saves it, and colours the browser bar to match', () => {
    setThemePreference('dark');
    expect(getThemePreference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    const colours = Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(m => m.getAttribute('content'));
    expect(colours).toEqual(['#0F1012', '#0F1012']);

    setThemePreference('system');
    expect(getThemePreference()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(m => m.getAttribute('content')))
      .toEqual(['#FAFAF8', '#0F1012']);
  });

  it('ignores a corrupted saved value', () => {
    localStorage.setItem('ft_theme', 'purple');
    expect(getThemePreference()).toBe('system');
  });
});
