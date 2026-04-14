/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1F422C',
        accent: '#B12B24',
        lime: '#BBD151',
        beige: '#ECDFC7',
        peach: '#F9B672',
        gray: '#84848A',
        navy: '#050725',
      },
    },
  },
  plugins: [],
}