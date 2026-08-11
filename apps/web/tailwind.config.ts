import type { Config } from 'tailwindcss';

// Theme tokens for the whole web app. Dark mode uses the `class` strategy (ThemeProvider stamps
// `dark` on <html>). `brand` is the primary accent scale; the rest of the palette uses Tailwind's
// built-in slate/emerald/amber/red. RTL is handled with logical utilities (ps-/pe-/ms-/me-/start/
// end) in components rather than config.
//
// The brand scale no longer holds its own values (P12-A). Each shade reads a CSS custom property
// declared in `src/styles.css`, so the palette is decided by the cascade at runtime rather than
// frozen into the bundle at build time. Nothing about the generated utilities changes: the class
// names, the shades and the colours they produce are all identical.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // `<alpha-value>` is the placeholder Tailwind fills in for an opacity modifier, and it is
        // the reason these are `rgb(channels)` rather than the hex they replaced — `bg-brand-500/40`
        // has no way to reach into a `#rrggbb` variable. The channel triplets live in `styles.css`.
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
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
      // Motion language. One settle curve (an ease-out-expo — quick to arrive, gentle to rest) shared
      // by everything that enters, so overlays, menus and toasts all move like one product. All of it
      // yields to `prefers-reduced-motion` via the guard in styles.css.
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'menu-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'pop-in': 'pop-in 190ms cubic-bezier(0.16, 1, 0.3, 1)',
        'menu-in': 'menu-in 130ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
