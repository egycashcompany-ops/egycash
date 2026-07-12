// The HR/Recruitment application shell: persistent sidebar + topbar around a routed content
// area (<Outlet/>). Generic and reused by any module shell — a module supplies its nav and
// title. Responsive (sidebar becomes a drawer under lg) and RTL-safe.
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { type NavSection } from '../navigation/nav';

export const AppShell = ({ nav, titleKey }: { nav: NavSection[]; titleKey: string }): JSX.Element => (
  <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
    <Sidebar nav={nav} titleKey={titleKey} />
    <div className="flex min-w-0 flex-1 flex-col">
      <Topbar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  </div>
);
