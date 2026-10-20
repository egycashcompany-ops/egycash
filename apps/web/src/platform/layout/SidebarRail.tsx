// The RAIL shell — the two-part navigation ECMS shipped before the launcher, restored as a
// choice rather than a replacement (the header switch picks between them):
//   • ModuleRail — a slim strip of module icons. Switching modules is one glance and one click,
//     with no surface to open and nothing to read; at a dozen modules it stays a strip.
//   • ModulePanel — the pages of whichever module the rail is showing, plus pinned favourites.
// Monochrome throughout, exactly as PR #122 left it: no per-module colours, no filled pills.
//
// It reads the same catalog and obeys the same rules the launchpad does — the current module is
// DERIVED FROM THE URL, so a deep link, a ⌘K jump or Back/Forward re-scope the panel for free,
// and picking a module lands on the page you last had open there. Rows come from `nav-rows`,
// shared with the launchpad, so a page row behaves identically in either shell.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { localized } from '../../shared/lib/format';
import { BuildingIcon, ChevronEndIcon, ChevronStartIcon, InboxIcon } from '../../shared/ui/icons';
import { LoadingState } from '../../shared/ui/states/LoadingState';
import { ErrorState } from '../../shared/ui/states/ErrorState';
import { useMyApplications } from '../navigation/me-applications-queries';
import { resolveNavIcon } from '../navigation/app-icon';
import { useNavPrefs } from '../navigation/NavPrefs';
import {
  flattenApps,
  moduleEntryRoute,
  moduleOfPathname,
  requiresExactMatch,
  visibleModules,
  type NavApp,
  type NavModule,
} from '../navigation/nav-model';
import { AppRow, AppWithChildren, NavSectionGroup, StateShell } from './nav-rows';
import { useFloatingNav } from './floating-nav';

// Whether the floating panel is pinned open lives in `floating-nav.ts`.
const LAST_MODULE_KEY = 'ecms.nav.lastModule';
const LAST_PAGE_KEY = 'ecms.nav.lastPage';
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
const loadLastPages = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(LAST_PAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};
const persistLastPages = (v: Record<string, string>): void => {
  try {
    localStorage.setItem(LAST_PAGE_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
};

const ModuleRail = ({
  modules,
  shownId,
  onPick,
  footer,
}: {
  modules: NavModule[];
  shownId: string;
  onPick: (m: NavModule) => void;
  /** Pinned under the module icons: the desktop's open/close toggle for the floating panel. */
  footer?: JSX.Element | undefined;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className="flex w-14 shrink-0 flex-col border-e border-slate-200/80 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
        {modules.map((m) => {
          const name = localized(m.name, locale);
          const shown = m.id === shownId;
          const Icon = resolveNavIcon(m.icon, BuildingIcon);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m)}
              title={name}
              aria-label={name}
              aria-current={shown ? 'page' : undefined}
              className={cn(
                'grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
                shown
                  ? 'bg-white text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-500 hover:bg-slate-200/60 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200',
              )}
            >
              <Icon className="h-5 w-5" />
            </button>
          );
        })}
      </div>
      {footer !== undefined && (
        <div className="flex justify-center border-t border-slate-200/60 py-2 dark:border-slate-800/60">
          {footer}
        </div>
      )}
    </div>
  );
};

const ModulePanel = ({
  module,
  pinnedApps,
  allRoutes,
  collapsible,
  pinned,
  onTogglePinned,
  onNavigate,
}: {
  module: NavModule;
  pinnedApps: NavApp[];
  allRoutes: string[];
  collapsible: boolean;
  /** Whether the floating panel is pinned open; its header button pins or closes it. */
  pinned: boolean;
  onTogglePinned: () => void;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const ModuleIcon = resolveNavIcon(module.icon, BuildingIcon);
  return (
    <div className="flex w-56 shrink-0 flex-col border-e border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex h-12 items-center justify-between gap-2 border-b border-slate-200/60 px-3 dark:border-slate-800/60">
        <div className="flex min-w-0 items-center gap-2">
          <ModuleIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          <span className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">
            {localized(module.name, locale)}
          </span>
        </div>
        {collapsible && (
          <button
            type="button"
            onClick={onTogglePinned}
            aria-label={t(pinned ? 'nav.collapse' : 'nav.expand')}
            aria-expanded={pinned}
            title={t(pinned ? 'nav.collapse' : 'nav.expand')}
            className="hidden shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-900/[0.04] hover:text-slate-600 dark:hover:bg-white/[0.05] lg:block"
          >
            {pinned ? (
              <ChevronStartIcon className="h-4 w-4 rtl:-scale-x-100" />
            ) : (
              <ChevronEndIcon className="h-4 w-4 rtl:-scale-x-100" />
            )}
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-2">
        {pinnedApps.length > 0 && (
          <section className="pb-2">
            <p className="flex h-7 items-center px-2 text-[11px] font-medium uppercase tracking-[0.07em] text-slate-400 dark:text-slate-500">
              {t('nav.pinned')}
            </p>
            <ul className="mt-0.5 space-y-px">
              {pinnedApps.map((a) => (
                <li key={`pin-${a.id}`}>
                  <AppRow
                    app={a}
                    onNavigate={onNavigate}
                    showPinAtRest={false}
                    end={requiresExactMatch(a.route, allRoutes)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* Ungrouped rows first — the module's own top level, where a page with no section has
            always rendered. */}
        <ul className="space-y-px">
          {module.apps.map((a) => (
            <AppWithChildren
              key={a.id}
              app={a}
              onNavigate={onNavigate}
              end={requiresExactMatch(a.route, allRoutes)}
            />
          ))}
        </ul>
        {/* …then the module's groups, through the SAME component the other shell uses. This panel
            used to render `module.apps` alone, so a page in a section did not appear here at all —
            a module that had organized every one of its pages showed an empty column. */}
        {module.sections.map((section) => (
          <NavSectionGroup
            key={section.id}
            section={section}
            allRoutes={allRoutes}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </div>
  );
};

const RailShell = ({
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

  // A module counts as present when it has ANY page — grouped or not. Counting only `apps` meant
  // a module whose pages were all in sections vanished from the rail entirely. The rule itself
  // lives in the nav model, so the other shells cannot answer this differently.
  const modules = useMemo(() => visibleModules(data), [data]);
  const urlModuleId = useMemo(() => moduleOfPathname(modules, pathname), [modules, pathname]);

  const [lastModuleId, setLastModuleId] = useState<string | null>(loadLastModule);
  const lastPages = useRef<Record<string, string>>(loadLastPages());
  useEffect(() => {
    if (urlModuleId === null) return;
    if (urlModuleId !== lastModuleId) {
      setLastModuleId(urlModuleId);
      persistLastModule(urlModuleId);
    }
    if (lastPages.current[urlModuleId] !== pathname) {
      lastPages.current = { ...lastPages.current, [urlModuleId]: pathname };
      persistLastPages(lastPages.current);
    }
  }, [urlModuleId, lastModuleId, pathname]);

  // On a desktop the module panel floats over the page (floating-nav.ts); the mobile drawer
  // shows it beside the rail, as it always did.
  const floating = useFloatingNav(collapsible);

  const allRoutes = useMemo(() => flattenApps(data).map((a) => a.route), [data]);
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

  const current =
    modules.find((m) => m.id === urlModuleId) ??
    modules.find((m) => m.id === lastModuleId) ??
    modules[0]!;

  // Picking a module NAVIGATES; the URL then re-scopes the panel, so the two cannot drift.
  const pickModule = (m: NavModule): void => {
    const route = moduleEntryRoute(m, lastPages.current[m.id] ?? null);
    if (route === null) return;
    navigate(route);
    onNavigate?.();
  };

  const panel = (
    <ModulePanel
      module={current}
      pinnedApps={pinnedApps}
      allRoutes={allRoutes}
      collapsible={collapsible}
      pinned={floating.pinned}
      onTogglePinned={floating.togglePinned}
      onNavigate={onNavigate}
    />
  );

  // The mobile drawer: the rail and the panel side by side, as they always were.
  if (!collapsible) {
    return (
      <div className="flex">
        <ModuleRail modules={modules} shownId={current.id} onPick={pickModule} />
        {panel}
      </div>
    );
  }

  const toggleLabel = t(floating.pinned ? 'nav.collapse' : 'nav.expand');
  const ToggleIcon = floating.pinned ? ChevronStartIcon : ChevronEndIcon;

  // A desktop: only the rail stands beside the page. The module's panel is drawn OVER the page from
  // the rail's edge — on hover, or pinned open with the toggle — and the page keeps its width.
  return (
    <div data-nav-strip className="relative flex h-full" {...floating.hoverProps}>
      <ModuleRail
        modules={modules}
        shownId={current.id}
        onPick={pickModule}
        footer={
          <button
            data-nav-toggle
            type="button"
            onClick={floating.togglePinned}
            aria-label={toggleLabel}
            aria-expanded={floating.pinned}
            title={toggleLabel}
            className="grid h-9 w-9 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:text-slate-500 dark:hover:bg-slate-800/60 dark:hover:text-slate-300"
          >
            <ToggleIcon className="h-4 w-4 rtl:-scale-x-100" />
          </button>
        }
      />
      {floating.shown && (
        <div
          data-nav-panel
          className="absolute inset-y-0 start-14 z-[35] flex animate-fade-in shadow-[0_18px_48px_-12px_rgba(15,23,42,0.28)] dark:shadow-[0_18px_48px_-12px_rgba(0,0,0,0.7)]"
        >
          {panel}
        </div>
      )}
    </div>
  );
};

export { RailShell };
