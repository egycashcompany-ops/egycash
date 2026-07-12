// Applies the chosen theme to <html> using Tailwind's class strategy (`dark`), resolving the
// `system` preference against the OS and reacting to OS changes live. Purely presentational —
// the preference itself lives in the ui slice (ADR-013).
import { useEffect, type ReactNode } from 'react';
import { useAppSelector } from '../../store';

const applyResolved = (resolved: 'light' | 'dark'): void => {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
};

export const ThemeProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const theme = useAppSelector((state) => state.ui.theme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const resolve = (): 'light' | 'dark' =>
      theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    applyResolved(resolve());
    if (theme !== 'system') return;
    const onChange = (): void => applyResolved(resolve());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return <>{children}</>;
};
