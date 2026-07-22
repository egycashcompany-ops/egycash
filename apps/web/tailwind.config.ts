import type { Config } from 'tailwindcss';

// Theme tokens for the whole web app. Dark mode uses the `class` strategy (ThemeProvider stamps
// `dark` on <html>). `brand` is the primary accent scale; the rest of the palette uses Tailwind's
// built-in slate/emerald/amber/red. RTL is handled with logical utilities (ps-/pe-/ms-/me-/start/
// end) in components rather than config.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Noto Sans Arabic',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      // Signature elevation language. Two tokens only, both tinted with slate-900 (cooler and more
      // intentional than pure-black defaults): `card` for resting surfaces, `elevated` for anything
      // that floats above the page (dialogs, menus, the command palette, toasts).
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        elevated: '0 12px 32px -12px rgb(15 23 42 / 0.28), 0 4px 12px -4px rgb(15 23 42 / 0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
