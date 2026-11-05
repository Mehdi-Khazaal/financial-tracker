/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      // One typeface everywhere; `mono` and `display` keep their names so
      // existing classes still work, but resolve to the same family.
      fontFamily: {
        sans:    ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        serif:   ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono:    ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Ledger design tokens
        bg:            'var(--bg)',
        'elev-1':      'var(--elev-1)',
        'elev-sub':    'var(--elev-sub)',
        fg:            'var(--fg)',
        muted:         'var(--muted)',
        dim:           'var(--dim)',
        line:          'var(--line)',
        'line-strong': 'var(--line-strong)',
        accent:        'var(--accent)',
        pos:           'var(--pos)',
        neg:           'var(--neg)',
        // backward-compat aliases (other pages)
        surface:       'var(--elev-1)',
        surface2:      'var(--elev-sub)',
        border:        'var(--line)',
        border2:       'var(--line-strong)',
        text:          'var(--fg)',
        green:         'var(--pos)',
        red:           'var(--neg)',
        orange:        'var(--warn)',
        purple:        'var(--cat-4)',
      },
      fontSize: {
        'display-lg': ['56px', { lineHeight: '1',    letterSpacing: '-0.03em' }],
        'display':    ['48px', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
      },
      // Small, consistent corners. The scale keeps its names so every
      // rounded-xl / rounded-2xl in the app tightens at once.
      borderRadius: {
        sm:     '4px',
        DEFAULT:'6px',
        md:     '6px',
        lg:     '8px',
        xl:     '8px',
        '2xl':  '10px',
        '3xl':  '12px',
        full:   '9999px',
      },
    },
  },
  plugins: [],
};
