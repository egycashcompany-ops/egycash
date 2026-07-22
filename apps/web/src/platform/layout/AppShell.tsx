// The ECMS application shell: a fixed command bar (top) + navigation rail (start) around a scrolling
// content area, plus the global ⌘K command palette. One consistent frame for every screen. The shell
// is data-driven (nav from GET /platform/me/applications) and unchanged at the backend/route level.
import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from '../navigation/CommandPalette';
import { NavPrefsProvider, useNavPrefs } from '../navigation/NavPrefs';
import { useMyApplications } from '../navigation/me-applications-queries';
import { flattenApps } from '../navigation/nav-model';

// Record the current page into Recents (for the palette + future surfaces).
const RecentTracker = (): null => {
  const { pathname } = useLocation();
  const { data = [] } = useMyApplications();
  const { recordRecent } = useNavPrefs();
  useEffect(() => {
    const apps = flattenApps(data);
    let bestId: string | null = null;
    let bestLen = -1;
    for (const a of apps) {
      if ((pathname === a.route || pathname.startsWith(`${a.route}/`)) && a.route.length > bestLen) {
        bestLen = a.route.length;
        bestId = a.id;
      }
    }
    if (bestId !== null) recordRecent(bestId);
  }, [pathname, data, recordRecent]);
  return null;
};

const Shell = (): JSX.Element => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <RecentTracker />
      <Topbar onOpenSearch={() => setPaletteOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* Keyed on the path so each navigation settles in with a subtle fade instead of a hard cut. */}
          <div key={pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
};

export const AppShell = (): JSX.Element => (
  // NavPrefsProvider keeps pinned/recents in sync across the rail, panel, and palette.
  <NavPrefsProvider>
    <Shell />
  </NavPrefsProvider>
);
