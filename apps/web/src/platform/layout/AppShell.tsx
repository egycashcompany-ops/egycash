// The application shell: dynamic sidebar + topbar around a routed content area (<Outlet/>). Generic
// and reused by any module shell — a module supplies only its brand title; the sidebar loads its own
// navigation from GET /platform/me/applications. Responsive (sidebar becomes a drawer under lg) and
// RTL-safe.
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export const AppShell = ({ titleKey }: { titleKey: string }): JSX.Element => (
  <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
    <Sidebar titleKey={titleKey} />
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  </div>
);
