// Client-side navigation preferences (no backend): the user's pinned applications and their recent
// history, shared through context so the module panel and the command palette stay in sync live.
// Persisted in localStorage; guarded for private-mode.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const PIN_KEY = 'ecms.nav.pinned';
const RECENT_KEY = 'ecms.nav.recent';
const RECENT_MAX = 8;

const read = (key: string): string[] => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? [] : (JSON.parse(raw) as string[]);
  } catch {
    return [];
  }
};

const write = (key: string, value: string[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — preferences still work for the session
  }
};

interface NavPrefs {
  pinned: string[];
  isPinned: (id: string) => boolean;
  togglePin: (id: string) => void;
  recent: string[];
  recordRecent: (id: string) => void;
}

const NavPrefsContext = createContext<NavPrefs | null>(null);

export const NavPrefsProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [pinned, setPinned] = useState<string[]>(() => read(PIN_KEY));
  const [recent, setRecent] = useState<string[]>(() => read(RECENT_KEY));

  const togglePin = useCallback((id: string): void => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      write(PIN_KEY, next);
      return next;
    });
  }, []);

  const recordRecent = useCallback((id: string): void => {
    setRecent((prev) => {
      if (prev[0] === id) return prev;
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_MAX);
      write(RECENT_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<NavPrefs>(
    () => ({ pinned, isPinned: (id) => pinned.includes(id), togglePin, recent, recordRecent }),
    [pinned, recent, togglePin, recordRecent],
  );

  return <NavPrefsContext.Provider value={value}>{children}</NavPrefsContext.Provider>;
};

export const useNavPrefs = (): NavPrefs => {
  const ctx = useContext(NavPrefsContext);
  if (ctx === null) throw new Error('useNavPrefs must be used within NavPrefsProvider');
  return ctx;
};
