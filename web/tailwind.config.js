/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // IceBox ice-blue palette
        ice: {
          50: '#eafaff',
          100: '#c9f2ff',
          200: '#9be7ff',
          300: '#5fd6ff',
          400: '#33c2ff',
          500: '#12a9f5',
          600: '#0a86d6',
          700: '#0b69ab',
          800: '#10578b',
          900: '#134a73',
        },
        night: {
          900: '#05070d',
          800: '#0a0f1a',
          700: '#101827',
          600: '#18202f',
          500: '#222c3d',
        },
        // Generic "reward/positive" green (not Tether brand green).
        coin: '#2eb872',
        usdt: '#2eb872',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(51, 194, 255, 0.45)',
        card: '0 8px 30px -12px rgba(0, 0, 0, 0.6)',
      },
      keyframes: {
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        'fade-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.35s ease-out',
        'sheet-up': 'sheet-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        float: 'float 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
