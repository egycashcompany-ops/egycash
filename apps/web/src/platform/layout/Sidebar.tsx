// The ECMS navigation shell: a two-part rail designed to stay clean at dozens of modules and
// hundreds of pages.
//   • ModuleRail — a slim vertical strip of module icons. Switching modules is one glance + one
//     click; it scales far better than a long scrolling list.
//   • ModulePanel — the selected module's pages, plus the user's cross-module Pinned favorites.
// Visual language (minimal-enterprise, Linear/Notion-style): ONE quiet neutral surface; every
// element is transparent with neutral icon/text, and ONLY the active item sits in a white
// (dark: slate-800) rounded container with the brand color. No fills, no shadows, no per-module
// colors; hover is a faint neutral tint via transition-colors only.
// Data is the dynamic GET /platform/me/applications (PR #64/#65); nothing here changes the backend,
// routing, or permission model. Persistent on desktop (lg+); an off-canvas drawer on mobile.
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { type Locale, type MyApplicationDto } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../store';
import { setSidebarOpen } from '../../store/uiSlice';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { localized } from '../../shared/lib/format';
import {
  BuildingIcon,
  ChevronStartIcon,
  CloseIcon,
  FileIcon,
  InboxIcon,
  StarIcon,
} from '../../shared/ui/icons';
import { LoadingState } from '../../shared/ui/states/LoadingState';
import { ErrorState } from '../../shared/ui/states/ErrorState';
import { useMyApplications } from '../navigation/me-applications-queries';
import { resolveNavIcon } from '../navigation/app-icon';
import { useNavPrefs } from '../navigation/NavPrefs';
import {
  flattenApps,
  moduleOfPathname,
  toModules,
  type NavApp,
  type NavModule,
} from '../navigation/nav-model';
import {
  navChildrenProviderFor,
  type NavChild,
  type NavChildrenProvider,
} from '../navigation/nav-children';

const PANEL_KEY = 'ecms.nav.panelCollapsed';
const loadCollapsed = (): boolean => {
  try {
    return localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
};
const persistCollapsed = (v: boolean): void => {
  try {
    localStorage.setItem(PANEL_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
};

// Minimal nav language: every row is transparent and neutral; ONLY the active page sits in a
// white rounded container with the brand color on its icon and label. No fills, no shadows.
const rowClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'group/item flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] leading-5 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
    isActive
      ? 'bg-white font-medium text-brand-600 dark:bg-slate-800 dark:text-brand-400'
      : 'font-normal text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100',
  );

/**
 * The live queue count on a nav row. Zero is deliberately NOT rendered: a badge means "there is
 * work here", so an empty queue is silence rather than a "0" the eye has to dismiss.
 */
const NavBadge = ({ count, active }: { count: number | null; active: boolean }): JSX.Element | null => {
  if (count === null || count === 0) return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        active
          ? 'bg-brand-600/10 text-brand-600 dark:bg-brand-400/10 dark:text-brand-400'
          : 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};

/** A dynamic stage under its family app (RW16) — its own route, its own live count. */
const ChildRow = ({
  child,
  onNavigate,
}: {
  child: NavChild;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <NavLink to={child.route} onClick={onNavigate} className={rowClass}>
      {({ isActive }) => (
        <>
          <span className="ms-6 min-w-0 flex-1 truncate">{localized(child.label, locale)}</span>
          <NavBadge count={child.count} active={isActive} />
        </>
      )}
    </NavLink>
  );
};

const AppRow = ({
  app,
  onNavigate,
  count = null,
}: {
  app: MyApplicationDto;
  onNavigate?: (() => void) | undefined;
  /** Live queue count published by the module's nav provider, if it has one (RW16). */
  count?: number | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { isPinned, togglePin } = useNavPrefs();
  const Icon = resolveNavIcon(app.icon, FileIcon);
  const pinned = isPinned(app.id);
  return (
    <NavLink to={app.route} onClick={onNavigate} className={rowClass}>
      {({ isActive }) => (
        <>
          <Icon
            className={cn(
              'h-[18px] w-[18px] shrink-0',
              isActive ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400 dark:text-slate-500',
            )}
          />
          <span className="min-w-0 flex-1 truncate">{localized(app.name, locale)}</span>
          <NavBadge count={count} active={isActive} />
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              togglePin(app.id);
            }}
            aria-label={t(pinned ? 'nav.unpin' : 'nav.pin')}
            className={cn(
              'grid h-5 w-5 shrink-0 place-items-center rounded transition-colors',
              isActive
                ? 'text-brand-600/50 hover:text-brand-600 dark:text-brand-400/50 dark:hover:text-brand-400'
                : 'text-slate-300 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300',
              pinned ? 'opacity-100' : 'opacity-0 focus:opacity-100 group-hover/item:opacity-100',
            )}
          >
            <StarIcon className={cn('h-3.5 w-3.5', pinned && 'fill-current')} />
          </button>
        </>
      )}
    </NavLink>
  );
};

/**
 * An app whose module publishes dynamic children for its route (RW16). A provider is a hook, so
 * it lives in its OWN component that always calls it — never behind a condition.
 */
const DynamicAppRow = ({
  app,
  provider,
  onNavigate,
}: {
  app: MyApplicationDto;
  provider: NavChildrenProvider;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const { count, children } = provider();
  return (
    <li>
      <AppRow app={app} onNavigate={onNavigate} count={count} />
      {children.length > 0 && (
        <ul className="space-y-px">
          {children.map((c) => (
            <li key={c.key}>
              <ChildRow child={c} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

/** Picks the dynamic or the plain row. The choice is stable for a given app, so hooks are too. */
const AppWithChildren = ({
  app,
  onNavigate,
}: {
  app: MyApplicationDto;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const provider = navChildrenProviderFor(app.route);
  if (provider === undefined) {
    return (
      <li>
        <AppRow app={app} onNavigate={onNavigate} />
      </li>
    );
  }
  return <DynamicAppRow app={app} provider={provider} onNavigate={onNavigate} />;
};

const ModuleRail = ({
  modules,
  shownId,
  onPick,
}: {
  modules: NavModule[];
  shownId: string;
  onPick: (id: string) => void;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-e border-slate-200 bg-slate-50 py-3 dark:border-slate-800 dark:bg-slate-900">
      {modules.map((m) => {
        const name = localized(m.name, locale);
        const shown = m.id === shownId;
        const Icon = resolveNavIcon(m.icon, BuildingIcon);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onPick(m.id)}
            title={name}
            aria-label={name}
            aria-current={shown ? 'page' : undefined}
            className={cn(
              'grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              shown
                ? 'bg-white text-brand-600 dark:bg-slate-800 dark:text-brand-400'
                : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200',
            )}
          >
            <Icon className="h-5 w-5" />
          </button>
        );
      })}
    </div>
  );
};

const ModulePanel = ({
  module,
  collapsible,
  onCollapse,
  onNavigate,
}: {
  module: NavModule;
  collapsible: boolean;
  onCollapse: () => void;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data = [] } = useMyApplications();
  const { pinned } = useNavPrefs();
  const ModuleIcon = resolveNavIcon(module.icon, BuildingIcon);

  const pinnedApps = useMemo(() => {
    const all = flattenApps(data);
    return pinned
      .map((id) => all.find((a) => a.id === id))
      .filter((a): a is NavApp => a !== undefined);
  }, [data, pinned]);

  return (
    <div className="flex w-56 shrink-0 flex-col border-e border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex h-12 items-center justify-between gap-2 border-b border-slate-200/70 px-3 dark:border-slate-800/70">
        <div className="flex min-w-0 items-center gap-2">
          <ModuleIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {localized(module.name, locale)}
          </span>
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t('nav.collapse')}
            title={t('nav.collapse')}
            className="hidden shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-600 dark:hover:bg-slate-800/60 lg:block"
          >
            <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 pt-2">
        {pinnedApps.length > 0 && (
          <div className="pb-1">
            <p className="px-2 pb-1 text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-slate-400 dark:text-slate-500">
              {t('nav.pinned')}
            </p>
            <ul className="space-y-px">
              {pinnedApps.map((a) => (
                <li key={`pin-${a.id}`}>
                  <AppRow app={a} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className={cn('space-y-px', pinnedApps.length > 0 && 'pt-2')}>
          {module.apps.map((a) => (
            <AppWithChildren key={a.id} app={a} onNavigate={onNavigate} />
          ))}
        </ul>
      </div>
    </div>
  );
};

const StateShell = ({ children }: { children: JSX.Element }): JSX.Element => (
  <div className="flex w-64 shrink-0 flex-col border-e border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-1 items-center justify-center overflow-y-auto">{children}</div>
  </div>
);

const NavShell = ({
  collapsible = true,
  onNavigate,
}: {
  collapsible?: boolean;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const { data = [], isLoading, isError, error, refetch } = useMyApplications();
  const modules = useMemo(() => toModules(data), [data]);
  const { pathname } = useLocation();
  const activeModuleId = useMemo(() => moduleOfPathname(modules, pathname), [modules, pathname]);
  const [picked, setPicked] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(() => collapsible && loadCollapsed());

  // Navigating clears a manual module peek so the panel follows the current page's module.
  useEffect(() => {
    setPicked(null);
  }, [pathname]);

  if (isLoading) {
    return (
      <StateShell>
        <LoadingState />
      </StateShell>
    );
  }
  if (isError) {
    return (
      <StateShell>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </StateShell>
    );
  }
  if (modules.length === 0) {
    return (
      <StateShell>
        <div className="flex flex-col items-center gap-2 px-6 text-center">
          <InboxIcon className="h-9 w-9 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400 dark:text-slate-500">{t('sidebar.empty')}</p>
        </div>
      </StateShell>
    );
  }

  const shownModule = modules.find((m) => m.id === (picked ?? activeModuleId)) ?? modules[0]!;
  const showPanel = !collapsible || !collapsed;

  const pick = (id: string): void => {
    setPicked(id);
    if (collapsed) {
      setCollapsed(false);
      persistCollapsed(false);
    }
  };

  return (
    <div className="flex h-full">
      <ModuleRail modules={modules} shownId={shownModule.id} onPick={pick} />
      {showPanel && (
        <ModulePanel
          module={shownModule}
          collapsible={collapsible}
          onCollapse={() => {
            setCollapsed(true);
            persistCollapsed(true);
          }}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
};

export const Sidebar = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.ui.sidebarOpen);
  const close = (): void => {
    dispatch(setSidebarOpen(false));
  };

  return (
    <>
      {/* Desktop */}
      <div className="hidden h-full shrink-0 lg:flex">
        <NavShell />
      </div>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-40 lg:hidden', open ? '' : 'pointer-events-none')} aria-hidden={!open}>
        <div
          className={cn('absolute inset-0 bg-slate-900/50 transition-opacity', open ? 'opacity-100' : 'opacity-0')}
          onClick={close}
        />
        <aside
          className={cn(
            'absolute inset-y-0 start-0 flex max-w-[88%] bg-slate-50 transition-transform dark:bg-slate-900',
            open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
          )}
          role="dialog"
          aria-modal="true"
          aria-label={t('common.menu')}
        >
          <NavShell collapsible={false} onNavigate={close} />
          <button
            type="button"
            onClick={close}
            aria-label={t('common.close')}
            className="absolute end-2 top-2.5 z-10 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-200/60 dark:hover:bg-slate-800/60"
          >
            <CloseIcon />
          </button>
        </aside>
      </div>
    </>
  );
};
