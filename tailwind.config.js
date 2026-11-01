/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Momentum: one light theme. Warm off-white page, white cards, one electric accent.
        ink: {
          950: '#F5F6F1', // page
          900: '#FFFFFF', // card
          850: '#F1F3EC', // raised / inputs
          800: '#E8EBE2', // hover
          700: '#DCE0D5', // borders
          600: '#C4CABB',
        },
        fg: {
          DEFAULT: '#111317',
          muted: '#4A515C', // ~8:1 on white
          subtle: '#687080', // ~5:1 on white
        },
        volt: {
          DEFAULT: '#C6F432', // fills only — use volt-ink for text
          soft: '#D7FA6A',
          deep: '#8DC21F',
          ink: '#4D7C0F', // readable on white (5:1)
        },
        discipline: {
          strength: '#E11D48',
          cycling: '#0284C7',
          walk: '#B45309',
          run: '#7C3AED',
          cardio: '#C2410C',
          stretch: '#0F766E',
          other: '#64748B',
        },
        danger: '#DC2626',
      },
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        volt: '0 0 0 1px rgba(141,194,31,0.45), 0 8px 24px -8px rgba(141,194,31,0.55)',
        card: '0 1px 2px rgba(16,24,40,0.04), 0 12px 32px -18px rgba(16,24,40,0.14)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        rise: 'rise 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms')({
      strategy: 'class',
    }),
  ],
}
