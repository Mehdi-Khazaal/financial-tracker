/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        bg:       '#070810',
        surface:  '#0d1018',
        surface2: '#121620',
        border:   '#1a1f2e',
        border2:  '#232940',
        text:     '#eef0f8',
        muted:    '#666e90',
        dim:      '#363d56',
        accent:   '#6366f1',
        purple:   '#a855f7',
        green:    '#10b981',
        red:      '#f43f5e',
        orange:   '#f59e0b',
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '8px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '28px',
        full: '9999px',
      },
    },
  },
  plugins: [],
}
