// The ECMS navigation shell, fourth generation — module SCOPE, not a module index.
// Choosing a module and navigating inside it are two different questions, so they get two
// different surfaces (Linear/Notion/Vercel language, kept monochrome):
//   • A module SWITCHER chip sits at the top: current module + a small anchored popover listing
//     the modules this user may see. One module ⇒ no popover, just a quiet label.
//   • The column below shows ONLY the current module's pages. Nothing from other modules.
//   • The current module is DERIVED FROM THE URL — never a second source of truth. A deep link,
//     a ⌘K jump, a pinned favourite from elsewhere, or Back/Forward all re-scope the column
//     automatically and correctly.
//   • Rows are monochrome: the ACTIVE row is a soft neutral tint with darker text, counts are
//     plain right-aligned numbers, and colour stays reserved for data and actions.
//   • Collapsed mode is a slim icon strip: the switcher on top, then this module's page icons.
// Data is the dynamic GET /platform/me/applications; nothing here changes the backend, routing,
// or permission model. Persistent on desktop (lg+); an off-canvas drawer on mobile.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { type Locale, type MyApplicationDto } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../store';
import { setSidebarOpen } from '../../store/uiSlice';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { localized } from '../../shared/lib/format';
import { useOnClickOutside } from '../../shared/lib/useOnClickOutside';
import {
  BuildingIcon,
  CheckIcon,
  ChevronIcon,
  ChevronEndIcon,
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

// ── Persisted chrome state ──────────────────────────────────────────────────
const PANEL_KEY = 'ecms.nav.panelCollapsed';
const LAST_MODULE_KEY = 'ecms.nav.lastModule';

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

/**
 * The last module the user actually worked in. This is a FALLBACK, not a mode: it answers the
 * column's question only when the URL names no module at all (the landing page, an account
 * screen, a 404). A URL that does name one always wins, so a deep link can never open the
 * "wrong" module.
 */
const loadLastModule = (): string | null => {
  try {
    return localStorage.getItem(LAST_MODULE_KEY);
  } catch {
    return null;
  }
};
const persistLastModule = (id: string): void => {
  try {
    localStorage.setItem(LAST_MODULE_KEY, id);
  } catch {
    /* ignore */
  }
};

// ── Row language ────────────────────────────────────────────────────────────
// Monochrome: transparent by default, a whisper of tint on hover, and the active row a soft
// neutral tint + darker text. The eye finds "where am I" by weight, not by color.
const rowClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'group/item flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] leading-5 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
    isActive
      ? 'bg-slate-900/[0.06] font-medium text-slate-900 dark:bg-white/[0.08] dark:text-slate-100'
      : 'font-normal text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100',
  );

/** A live queue count as a plain right-aligned number — quieter than any badge. Zero is silence. */
const Count = ({ count, active }: { count: number | null; active: boolean }): JSX.Element | null => {
  if (count === null || count === 0) return null;
  return (
    <span
      className={cn(
        'shrink-0 text-[11px] tabular-nums',
        active ? 'text-slate-500 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500',
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
          <span className="ms-[26px] min-w-0 flex-1 truncate">{localized(child.label, locale)}</span>
          <Count count={child.count} active={isActive} />
        </>
      )}
    </NavLink>
  );
};

const AppRow = ({
  app,
  onNavigate,
  count = null,
  showPinAtRest = true,
}: {
  app: MyApplicationDto;
  onNavigate?: (() => void) | undefined;
  /** Live queue count published by the module's nav provider, if it has one (RW16). */
  count?: number | null;
  /** False inside the Pinned section, where a filled star on every row states the obvious. */
  showPinAtRest?: boolean;
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
              'h-4 w-4 shrink-0',
              isActive ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500',
            )}
          />
          <span className="min-w-0 flex-1 truncate">{localized(app.name, locale)}</span>
          <Count count={count} active={isActive} />
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
              'text-slate-300 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300',
              pinned && showPinAtRest
                ? 'opacity-100'
                : 'opacity-0 focus:opacity-100 group-hover/item:opacity-100',
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

// ── Module switcher ─────────────────────────────────────────────────────────
/**
 * The one place a module is chosen. A chip showing where you are; clicking it opens a small
 * popover anchored right beneath — never a full-screen takeover, because switching modules is a
 * frequent, lightweight act and blanking the screen for it costs more than it gives.
 *
 * With a single permitted module the chip degrades to a plain label: nothing to switch to, so
 * nothing to click.
 */
const ModuleSwitcher = ({
  modules,
  current,
  collapsed = false,
  onPick,
}: {
  modules: NavModule[];
  current: NavModule;
  collapsed?: boolean;
  onPick: (m: NavModule) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  const CurrentIcon = resolveNavIcon(current.icon, BuildingIcon);
  const only = modules.length <= 1;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // One module: a quiet label, not a control.
  if (only) {
    return (
      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-md text-[13px] font-medium text-slate-800 dark:text-slate-100',
          collapsed ? 'w-9 justify-center' : 'px-2',
        )}
      >
        <CurrentIcon className="h-[18px] w-[18px] shrink-0 text-slate-400 dark:text-slate-500" />
        {!collapsed && <span className="min-w-0 truncate">{localized(current.name, locale)}</span>}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('nav.switchModule')}
        {...(collapsed ? { title: localized(current.name, locale) } : {})}
        className={cn(
          'flex h-9 items-center gap-2 rounded-md text-[13px] font-medium transition-colors',
          'text-slate-800 hover:bg-slate-900/[0.04] focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-slate-400/40',
          'dark:text-slate-100 dark:hover:bg-white/[0.05]',
          collapsed ? 'w-9 justify-center' : 'w-full px-2',
        )}
      >
        <CurrentIcon className="h-[18px] w-[18px] shrink-0 text-slate-400 dark:text-slate-500" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-start">
              {localized(current.name, locale)}
            </span>
            <ChevronIcon
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform dark:text-slate-500',
                open && 'rotate-180',
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-30 mt-1 min-w-[13rem] origin-top rounded-lg border border-slate-200/80 bg-white p-1',
            'animate-menu-in dark:border-slate-700 dark:bg-slate-800',
            collapsed ? 'start-full ms-1 top-0 mt-0' : 'inset-x-0',
          )}
        >
          {modules.map((m) => {
            const Icon = resolveNavIcon(m.icon, BuildingIcon);
            const isCurrent = m.id === current.id;
            return (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (!isCurrent) onPick(m);
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
                  isCurrent
                    ? 'font-medium text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 hover:bg-slate-900/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.05]',
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                <span className="min-w-0 flex-1 truncate text-start">
                  {localized(m.name, locale)}
                </span>
                {isCurrent && (
                  <CheckIcon className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Collapsed mode: the switcher, then THIS module's page icons ─────────────
const IconStrip = ({
  modules,
  current,
  onPickModule,
  onNavigate,
}: {
  modules: NavModule[];
  current: NavModule;
  onPickModule: (m: NavModule) => void;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-3">
      <ModuleSwitcher modules={modules} current={current} collapsed onPick={onPickModule} />
      <div className="my-1 h-px w-6 bg-slate-200 dark:bg-slate-700" />
      {current.apps.map((a) => {
        const name = localized(a.name, locale);
        const Icon = resolveNavIcon(a.icon, FileIcon);
        return (
          <NavLink
            key={a.id}
            to={a.route}
            onClick={onNavigate}
            title={name}
            aria-label={name}
            className={({ isActive }) =>
              cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-md transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
                isActive
                  ? 'bg-slate-900/[0.06] text-slate-800 dark:bg-white/[0.08] dark:text-slate-100'
                  : 'text-slate-400 hover:bg-slate-900/[0.04] hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/[0.05] dark:hover:text-slate-200',
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" />
          </NavLink>
        );
      })}
    </div>
  );
};

const StateShell = ({ children }: { children: JSX.Element }): JSX.Element => (
  <div className="flex w-60 shrink-0 flex-col border-e border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-1 items-center justify-center overflow-y-auto">{children}</div>
  </div>
);

// ── The shell ───────────────────────────────────────────────────────────────
const NavShell = ({
  collapsible = true,
  onNavigate,
}: {
  collapsible?: boolean;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const navigate = useNavigate();
  const { data = [], isLoading, isError, error, refetch } = useMyApplications();
  const { pinned } = useNavPrefs();
  const { pathname } = useLocation();

  // A module with no pages yet (e.g. one seeded ahead of its screens) earns no chrome.
  const modules = useMemo(() => toModules(data).filter((m) => m.apps.length > 0), [data]);

  // THE source of truth: which module owns the page currently open. Deep links, ⌘K jumps,
  // pinned favourites from another module and Back/Forward therefore all re-scope the column
  // for free — there is no second state to fall out of sync.
  const urlModuleId = useMemo(() => moduleOfPathname(modules, pathname), [modules, pathname]);

  // Remembered ONLY to answer "which module should the column show when the URL names none?"
  // (the landing page, /account/security, a 404). It never overrides a URL that does name one.
  const [lastModuleId, setLastModuleId] = useState<string | null>(loadLastModule);
  useEffect(() => {
    if (urlModuleId !== null && urlModuleId !== lastModuleId) {
      setLastModuleId(urlModuleId);
      persistLastModule(urlModuleId);
    }
  }, [urlModuleId, lastModuleId]);

  const [collapsed, setCollapsed] = useState<boolean>(() => collapsible && loadCollapsed());

  const pinnedApps = useMemo(() => {
    const all = flattenApps(data);
    return pinned
      .map((id) => all.find((a) => a.id === id))
      .filter((a): a is NavApp => a !== undefined);
  }, [data, pinned]);

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

  // The module the column is scoped to: the URL's, else the one last visited, else the first.
  const current =
    modules.find((m) => m.id === urlModuleId) ??
    modules.find((m) => m.id === lastModuleId) ??
    modules[0]!;

  const toggleCollapsed = (): void => {
    setCollapsed((v) => {
      persistCollapsed(!v);
      return !v;
    });
  };

  // Switching modules NAVIGATES — it does not flip a local flag. The URL then re-scopes the
  // column, which is what keeps the two in step by construction.
  const pickModule = (m: NavModule): void => {
    const first = m.apps[0];
    if (first === undefined) return;
    navigate(first.route);
    onNavigate?.();
  };

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-e border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      {collapsed ? (
        <IconStrip
          modules={modules}
          current={current}
          onPickModule={pickModule}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          <div className="px-3 pt-3">
            <ModuleSwitcher modules={modules} current={current} onPick={pickModule} />
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-3">
            {pinnedApps.length > 0 && (
              <section className="mb-5">
                <p className="flex h-7 items-center px-2 text-[11px] font-medium uppercase tracking-[0.07em] text-slate-400 dark:text-slate-500">
                  {t('nav.pinned')}
                </p>
                <ul className="mt-0.5 space-y-px">
                  {pinnedApps.map((a) => (
                    <li key={`pin-${a.id}`}>
                      <AppRow app={a} onNavigate={onNavigate} showPinAtRest={false} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {/* This module's pages, and nothing else. */}
            <ul className="space-y-px">
              {current.apps.map((a) => (
                <AppWithChildren key={a.id} app={a} onNavigate={onNavigate} />
              ))}
            </ul>
          </nav>
        </>
      )}

      {collapsible && (
        <div className="border-t border-slate-200/60 px-2 py-2 dark:border-slate-800/60">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={t(collapsed ? 'nav.expand' : 'nav.collapse')}
            title={t(collapsed ? 'nav.expand' : 'nav.collapse')}
            className={cn(
              'flex h-8 items-center gap-2 rounded-md text-slate-400 transition-colors',
              'hover:bg-slate-900/[0.04] hover:text-slate-600 focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:text-slate-500',
              'dark:hover:bg-white/[0.05] dark:hover:text-slate-300',
              collapsed ? 'w-10 justify-center' : 'w-full px-2',
            )}
          >
            {collapsed ? (
              <ChevronEndIcon className="h-4 w-4 rtl:-scale-x-100" />
            ) : (
              <>
                <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
                <span className="text-[12px]">{t('nav.collapse')}</span>
              </>
            )}
          </button>
        </div>
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
            'absolute inset-y-0 start-0 flex max-w-[88%] bg-white transition-transform dark:bg-slate-900',
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
            className="absolute end-2 top-2.5 z-10 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05]"
          >
            <CloseIcon />
          </button>
        </aside>
      </div>
    </>
  );
};
