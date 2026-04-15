/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Syne', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
      colors: {
        bg:       '#0b0d12',
        surface:  '#11141c',
        surface2: '#181c28',
        border:   '#252a3a',
        border2:  '#323855',
        text:     '#e8eaf2',
        muted:    '#7880a0',
        dim:      '#3e4460',
        accent:   '#5b8fff',
        purple:   '#a78bfa',
        green:    '#2ecc8a',
        red:      '#ff5f6d',
        orange:   '#f5a623',
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
