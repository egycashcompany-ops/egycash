// Dynamic sidebar: a persistent rail on desktop (lg+) and an off-canvas drawer on mobile (driven by
// ui.sidebarOpen). The navigation is loaded exclusively from GET /platform/me/applications — a tree
// of Category → Application, rendered in the backend's order. Categories collapse/expand locally.
// Fully RTL-safe via logical borders/spacing; the drawer slides from the reading-start edge.
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../store';
import { setSidebarOpen } from '../../store/uiSlice';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { localized } from '../../shared/lib/format';
import { CloseIcon, ChevronIcon, FileIcon, InboxIcon } from '../../shared/ui/icons';
import { LoadingState } from '../../shared/ui/states/LoadingState';
import { ErrorState } from '../../shared/ui/states/ErrorState';
import { useMyApplications } from '../navigation/me-applications-queries';
import { resolveNavIcon } from '../navigation/app-icon';

const NavTree = ({ onNavigate }: { onNavigate: () => void }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data = [], isLoading, isError, error, refetch } = useMyApplications();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto">
        <LoadingState />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex-1 overflow-y-auto">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <InboxIcon className="h-10 w-10 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-400 dark:text-slate-500">{t('sidebar.empty')}</p>
      </div>
    );
  }

  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
      {data.map((category) => {
        const isCollapsed = collapsed.has(category.id);
        return (
          <div key={category.id}>
            <button
              type="button"
              onClick={() => toggle(category.id)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-2 rounded-lg px-3 pb-2 pt-1 text-start text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <ChevronIcon
                className={cn('h-4 w-4 shrink-0 transition-transform', isCollapsed && '-rotate-90 rtl:rotate-90')}
              />
              <span className="truncate">{localized(category.name, locale)}</span>
            </button>
            {!isCollapsed && (
              <ul className="space-y-1">
                {category.applications.map((app) => {
                  const Icon = resolveNavIcon(app.icon, FileIcon);
                  return (
                    <li key={app.id}>
                      <NavLink
                        to={app.route}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200'
                              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                          )
                        }
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        <span className="truncate">{localized(app.name, locale)}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
};

const Brand = ({ titleKey }: { titleKey: string }): JSX.Element => {
  const t = useT();
  return (
    <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-5 dark:border-slate-800">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
        E
      </span>
      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t(titleKey)}</span>
    </div>
  );
};

export const Sidebar = ({ titleKey }: { titleKey: string }): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.ui.sidebarOpen);
  const close = (): void => {
    dispatch(setSidebarOpen(false));
  };

  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden w-64 shrink-0 flex-col border-e border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <Brand titleKey={titleKey} />
        <NavTree onNavigate={() => undefined} />
      </aside>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-40 lg:hidden', open ? '' : 'pointer-events-none')} aria-hidden={!open}>
        <div
          className={cn(
            'absolute inset-0 bg-slate-900/50 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          )}
          onClick={close}
        />
        <aside
          className={cn(
            'absolute inset-y-0 start-0 flex w-72 max-w-[80%] flex-col bg-white shadow-xl transition-transform dark:bg-slate-900',
            open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
          )}
          role="dialog"
          aria-modal="true"
          aria-label={t(titleKey)}
        >
          <div className="flex items-center justify-between border-b border-slate-200 pe-2 dark:border-slate-800">
            <Brand titleKey={titleKey} />
            <button
              type="button"
              onClick={close}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={t('common.close')}
            >
              <CloseIcon />
            </button>
          </div>
          <NavTree onNavigate={close} />
        </aside>
      </div>
    </>
  );
};
