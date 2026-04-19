/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:  ['Geist', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'Georgia', 'serif'],
        mono:  ['"JetBrains Mono"', 'monospace'],
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
        orange:        '#f59e0b',
        purple:        '#a855f7',
      },
      fontSize: {
        'display-lg': ['56px', { lineHeight: '1',    letterSpacing: '-0.03em' }],
        'display':    ['48px', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
      },
      borderRadius: {
        sm:     '8px',
        DEFAULT:'10px',
        md:     '10px',
        lg:     '14px',
        xl:     '18px',
        '2xl':  '22px',
        '3xl':  '26px',
        full:   '9999px',
      },
    },
  },
  plugins: [],
}
