// Client-side navigation preferences (no backend): the user's pinned applications and their recent
// history, shared through context so the module panel and the command palette stay in sync live.
// Persisted in localStorage; guarded for private-mode.
//
// The history is the ACCOUNT's, and says when: «وتظهرله الـ Recent Pages اللى كان فيها» on the
// welcome page means this person's pages, with «منذ 5 دقائق» beside each. A browser shared by two
// people must never show one of them the other's pages, so the key carries the account id.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAppSelector } from '../../store';

const PIN_KEY = 'ecms.nav.pinned';
const RECENT_KEY = 'ecms.nav.recent';
const RECENT_MAX = 12;

/** One page in the history: the menu page's id, and when it was last opened (epoch ms). */
export interface RecentVisit {
  id: string;
  at: number;
}

const recentKeyOf = (userId: string | null): string =>
  userId === null ? RECENT_KEY : `${RECENT_KEY}.${userId}`;

const readVisits = (key: string): RecentVisit[] => {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown): RecentVisit[] => {
      // The list before visits carried a time: bare ids, read as "some time ago".
      if (typeof entry === 'string') return [{ id: entry, at: 0 }];
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as RecentVisit).id === 'string' &&
        typeof (entry as RecentVisit).at === 'number'
      ) {
        return [{ id: (entry as RecentVisit).id, at: (entry as RecentVisit).at }];
      }
      return [];
    });
  } catch {
    return [];
  }
};

const writeVisits = (key: string, value: RecentVisit[]): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — the history still works for the session
  }
};

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
  /** The same history with the time of each visit, newest first. */
  recentVisits: RecentVisit[];
  recordRecent: (id: string) => void;
}

const NavPrefsContext = createContext<NavPrefs | null>(null);

export const NavPrefsProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [pinned, setPinned] = useState<string[]>(() => read(PIN_KEY));
  const userId = useAppSelector((state) => state.auth.me?.id ?? null);
  const recentKey = recentKeyOf(userId);
  const [history, setHistory] = useState<{ key: string; visits: RecentVisit[] }>(() => ({
    key: recentKey,
    visits: readVisits(recentKey),
  }));
  // Another account signed in on this tab: its own history, read fresh.
  const visits = history.key === recentKey ? history.visits : readVisits(recentKey);
  if (history.key !== recentKey) setHistory({ key: recentKey, visits });

  const togglePin = useCallback((id: string): void => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      write(PIN_KEY, next);
      return next;
    });
  }, []);

  const recordRecent = useCallback(
    (id: string): void => {
      setHistory((prev) => {
        const current = prev.key === recentKey ? prev.visits : readVisits(recentKey);
        const next = [{ id, at: Date.now() }, ...current.filter((v) => v.id !== id)].slice(
          0,
          RECENT_MAX,
        );
        writeVisits(recentKey, next);
        return { key: recentKey, visits: next };
      });
    },
    [recentKey],
  );

  const recent = useMemo(() => visits.map((v) => v.id), [visits]);
  const value = useMemo<NavPrefs>(
    () => ({
      pinned,
      isPinned: (id) => pinned.includes(id),
      togglePin,
      recent,
      recentVisits: visits,
      recordRecent,
    }),
    [pinned, recent, visits, togglePin, recordRecent],
  );

  return <NavPrefsContext.Provider value={value}>{children}</NavPrefsContext.Provider>;
};

export const useNavPrefs = (): NavPrefs => {
  const ctx = useContext(NavPrefsContext);
  if (ctx === null) throw new Error('useNavPrefs must be used within NavPrefsProvider');
  return ctx;
};
