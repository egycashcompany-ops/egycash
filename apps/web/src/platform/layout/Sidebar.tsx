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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { type Locale, type MyApplicationDto } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../store';
import { setSidebarOpen } from '../../store/uiSlice';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { localized } from '../../shared/lib/format';
import {
  BuildingIcon,
  CheckIcon,
  ChevronEndIcon,
  ChevronStartIcon,
  CloseIcon,
  FileIcon,
  GridIcon,
  InboxIcon,
  SearchIcon,
  StarIcon,
} from '../../shared/ui/icons';
import { LoadingState } from '../../shared/ui/states/LoadingState';
import { ErrorState } from '../../shared/ui/states/ErrorState';
import { useMyApplications } from '../navigation/me-applications-queries';
import { resolveNavIcon, type NavIcon } from '../navigation/app-icon';
import { useNavPrefs } from '../navigation/NavPrefs';
import {
  flattenApps,
  moduleEntryRoute,
  moduleOfPathname,
  requiresExactMatch,
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
const LAST_PAGE_KEY = 'ecms.nav.lastPage';

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

/**
 * moduleId → the last page open in it. Coming back to a module should return you to your desk,
 * not to its lobby; every switcher worth the name does this. Validated against the live catalog
 * before use (see `moduleEntryRoute`), so a revoked page can never be navigated into.
 */
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
  end = false,
}: {
  child: NavChild;
  onNavigate?: (() => void) | undefined;
  end?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <NavLink to={child.route} onClick={onNavigate} end={end} className={rowClass}>
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
  end = false,
}: {
  app: MyApplicationDto;
  onNavigate?: (() => void) | undefined;
  /** Live queue count published by the module's nav provider, if it has one (RW16). */
  count?: number | null;
  /** False inside the Pinned section, where a filled star on every row states the obvious. */
  showPinAtRest?: boolean;
  /** Exact-match highlighting — set when another row lives under this row's route. */
  end?: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { isPinned, togglePin } = useNavPrefs();
  const Icon = resolveNavIcon(app.icon, FileIcon);
  const pinned = isPinned(app.id);
  return (
    <NavLink to={app.route} onClick={onNavigate} end={end} className={rowClass}>
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
  end,
}: {
  app: MyApplicationDto;
  provider: NavChildrenProvider;
  onNavigate?: (() => void) | undefined;
  end: boolean;
}): JSX.Element => {
  const { count, children } = provider();
  // A family app whose stages live under its own route must match exactly, or it stays lit
  // while the user is inside one of its stages.
  const childRoutes = children.map((c) => c.route);
  return (
    <li>
      <AppRow app={app} onNavigate={onNavigate} count={count} end={end || children.length > 0} />
      {children.length > 0 && (
        <ul className="space-y-px">
          {children.map((c) => (
            <li key={c.key}>
              <ChildRow
                child={c}
                onNavigate={onNavigate}
                end={requiresExactMatch(c.route, childRoutes)}
              />
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
  end,
}: {
  app: MyApplicationDto;
  onNavigate?: (() => void) | undefined;
  end: boolean;
}): JSX.Element => {
  const provider = navChildrenProviderFor(app.route);
  if (provider === undefined) {
    return (
      <li>
        <AppRow app={app} onNavigate={onNavigate} end={end} />
      </li>
    );
  }
  return <DynamicAppRow app={app} provider={provider} onNavigate={onNavigate} end={end} />;
};

// ── Module Launchpad ────────────────────────────────────────────────────────
/**
 * Where a module is chosen: a LAUNCHPAD over the whole product (the Azure / SAP Fiori / Atlassian
 * switcher family, spoken in ECMS's monochrome dialect). Clicking the module header — its name in
 * the column, its icon in the collapsed strip — lifts a full-viewport surface: the working page
 * stays visible through a FROSTED VEIL, and one card per permitted module sits centred in a grid.
 * Nothing navigates on open. Choosing a card returns you to the last page you had open in that
 * module (its first page otherwise) and re-scopes the column to it.
 *
 * The veil is a light frost in light mode and a deep one in dark mode — never a black sheet that
 * shuts the app off. That choice is what lets the surface stay bright and still carry ordinary
 * dark text at full contrast: the type sits on frosted glass, not on a dim page.
 *
 * The intent is a WORKSPACE change, not a menu pick, so this behaves like a screen of its own: a
 * titled header, cards with room to breathe, focus ownership while open (trap + scroll lock),
 * arrow-key movement across the grid, a filter once the catalog outgrows a glance, and — with
 * twenty modules — a header that stays put while only the grid scrolls. One 170ms fade-and-settle
 * in, the same in reverse out. Monochrome throughout: slate, thin borders, no tile colours.
 *
 * With a single permitted module the header degrades to a plain label: no launchpad, no trigger,
 * no affordance pretending otherwise.
 */

/** A catalog this size is scanned, not searched; past it, typing beats hunting. */
const FILTER_THRESHOLD = 6;
/** Entry/exit duration. Long enough to read as motion, short enough to feel like a state change. */
const LAUNCHPAD_MS = 170;

/** Per-row entry offset. Three rows in, the cascade stops: nobody should wait on a launcher. */
const STAGGER_MS = 30;
const STAGGER_MAX_ROWS = 3;

/**
 * The app itself steps back while the launcher is up — a slight zoom-out and a soft blur, exactly
 * the way an OS-level switcher sets the running workspace aside. This is what separates a launcher
 * from an overlay: the workspace you were in visibly recedes instead of merely being covered, so
 * choosing another one reads as leaving rather than as answering a dialog.
 *
 * The launchpad is portalled to <body>, never inside #root, so the transform below moves the app
 * without touching the launcher standing over it.
 */
const APP_RECEDE_MS = 220;
/**
 * The two halves of one movement. Opening, the app starts back first and the launcher arrives
 * into the space it left; closing, the launcher goes first and the app comes forward behind it.
 * Overlapping them by this much is what makes it read as a single gesture rather than two
 * animations that happen to fire together.
 */
const HANDOVER_MS = 70;
const recedeApp = (active: boolean): void => {
  const app = document.getElementById('root');
  if (app === null) return;
  app.style.transformOrigin = '50% 42%';
  app.style.transition = `transform ${APP_RECEDE_MS}ms cubic-bezier(0.16,1,0.3,1), filter ${APP_RECEDE_MS}ms cubic-bezier(0.16,1,0.3,1), border-radius ${APP_RECEDE_MS}ms ease-out`;
  app.style.transform = active ? 'scale(0.975)' : 'scale(1)';
  app.style.filter = active ? 'blur(2px)' : 'blur(0px)';
  // Set back from the viewport edges, the app has edges of its own; square corners would give
  // away that this is a page being scaled rather than a surface being put aside.
  app.style.overflow = 'hidden';
  app.style.borderRadius = active ? '12px' : '0px';
};
const releaseApp = (): void => {
  const app = document.getElementById('root');
  if (app === null) return;
  app.style.transformOrigin = '';
  app.style.transition = '';
  app.style.transform = '';
  app.style.filter = '';
  app.style.overflow = '';
  app.style.borderRadius = '';
};

/**
 * The app's half of the movement, owned at module level: the styles must finish coming back even
 * though the launchpad unmounts partway through the return trip.
 */
let appTimer: number | null = null;
const appStepsBack = (): void => {
  if (appTimer !== null) {
    window.clearTimeout(appTimer);
    appTimer = null;
  }
  recedeApp(true);
};
const appComesForward = (): void => {
  if (appTimer !== null) window.clearTimeout(appTimer);
  recedeApp(false);
  // Inline styles are cleared only once the app has actually arrived; wiping them mid-transition
  // would snap it the rest of the way.
  appTimer = window.setTimeout(() => {
    releaseApp();
    appTimer = null;
  }, APP_RECEDE_MS + 40);
};

/** How many cards the responsive grid put on a row — read from the DOM, never assumed. */
const columnsOf = (cards: readonly HTMLElement[]): number => {
  const top = cards[0]?.offsetTop;
  if (top === undefined) return 1;
  const n = cards.findIndex((c) => c.offsetTop !== top);
  return n === -1 ? cards.length : Math.max(1, n);
};

const ModuleCard = ({
  module,
  isCurrent,
  shown,
  delayMs,
  onPick,
}: {
  module: NavModule;
  isCurrent: boolean;
  /** Entry state, carried on a wrapper so the stagger delay never slows the hover. */
  shown: boolean;
  delayMs: number;
  onPick: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const Icon = resolveNavIcon(module.icon, BuildingIcon);
  return (
    <div
      // Exactly two columns on a phone, three on a tablet, four on a desktop — sized rather than
      // placed in grid tracks, so a row that does not fill up stays centred instead of hugging
      // the start edge.
      className={cn(
        'w-[calc((100%_-_1.25rem)/2)] sm:w-[calc((100%_-_2.5rem)/3)] lg:w-[calc((100%_-_3.75rem)/4)]',
        'transition-[opacity,transform] duration-[170ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
      style={{ transitionDelay: shown ? `${delayMs}ms` : '0ms' }}
    >
      <button
        type="button"
        data-module-card
        data-current={isCurrent}
        onClick={onPick}
        aria-current={isCurrent}
        aria-label={
          isCurrent
            ? `${localized(module.name, locale)} — ${t('nav.currentWorkspace')}`
            : localized(module.name, locale)
        }
        className={cn(
          // 36 + 80 icon + 24 + 40 name box + 28 = 208, and 24 + 64 + 16 + 40 + 16 = 160 on a
          // phone, where a desktop-scale tile would crowd a 160px column. Laid out from the top
          // rather than centred, so every icon in the grid sits on exactly the same line whether
          // its module's name takes one line or two.
          'group/card relative flex h-40 w-full flex-col items-center gap-4 pb-4 pt-6',
          'sm:h-[208px] sm:gap-6 sm:pb-7 sm:pt-9',
          'rounded-2xl border px-6 text-center outline-none',
          // The whole tile is one control, so it moves as one: shadow, lift and scale all ride
          // the same curve, and the press releases them together.
          'shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200',
          'ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform',
          'focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2',
          'focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950',
          'dark:shadow-none',
          // The workspace you are already in: a shade of surface and a shade of border, nothing loud.
          isCurrent
            ? 'border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/50'
            : 'border-slate-200/70 bg-white dark:border-slate-700/60 dark:bg-slate-900',
          // The lift is the whole hover: a step up, a breath of scale and a deeper shadow. No
          // colour anywhere. Pressing settles it back down, so the tile answers the click.
          'hover:-translate-y-1 hover:scale-[1.015] hover:border-slate-300',
          'hover:shadow-[0_22px_48px_-24px_rgba(15,23,42,0.45)]',
          'active:-translate-y-0 active:scale-[0.995] active:duration-75',
          'active:shadow-[0_6px_16px_-10px_rgba(15,23,42,0.35)]',
          'dark:hover:border-slate-600 dark:hover:shadow-[0_22px_48px_-24px_rgba(0,0,0,0.9)]',
        )}
      >
        {isCurrent && (
          <CheckIcon className="absolute end-4 top-4 h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
        )}
        <span
          className={cn(
            'grid h-16 w-16 shrink-0 place-items-center rounded-2xl transition-colors sm:h-20 sm:w-20',
            'bg-slate-100 group-hover/card:bg-slate-200/70',
            'dark:bg-slate-800 dark:group-hover/card:bg-slate-700/70',
          )}
        >
          <Icon
            className={cn(
              'h-8 w-8 transition-colors sm:h-10 sm:w-10',
              'text-slate-500 group-hover/card:text-slate-700',
              'dark:text-slate-400 dark:group-hover/card:text-slate-200',
            )}
          />
        </span>
        <span className="flex h-10 w-full items-center justify-center">
          <span className="line-clamp-2 text-[16px] font-semibold leading-5 tracking-[-0.01em] text-slate-900 dark:text-slate-50">
            {localized(module.name, locale)}
          </span>
        </span>
        {/* The promise of the click, shown only while the pointer is on it — and never on the
            card you are already in, which leads nowhere. */}
        {!isCurrent && (
          <ChevronEndIcon
            className={cn(
              'absolute bottom-3.5 end-3.5 h-4 w-4 text-slate-300 opacity-0 transition-opacity',
              'rtl:-scale-x-100 group-hover/card:opacity-100 dark:text-slate-600',
            )}
          />
        )}
      </button>
    </div>
  );
};

const Launchpad = ({
  modules,
  current,
  onChoose,
  onClose,
}: {
  modules: NavModule[];
  current: NavModule;
  onChoose: (m: NavModule) => void;
  /** `focusTrigger` — true when the launchpad was dismissed rather than used. */
  onClose: (focusTrigger: boolean) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const rtl = locale === 'ar';
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollable, setScrollable] = useState(false);
  const [cols, setCols] = useState(4);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const exitTimer = useRef<number | null>(null);
  const handoverTimer = useRef<number | null>(null);
  const withFilter = modules.length > FILTER_THRESHOLD;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return modules;
    return modules.filter((m) =>
      `${m.name.ar} ${m.name.en}`.toLowerCase().includes(q),
    );
  }, [modules, query]);

  const cards = (): HTMLButtonElement[] =>
    Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('[data-module-card]') ?? []);

  // Leave the way it arrived, in the same order reversed: the launcher goes first and the app
  // follows it forward, so the whole thing reads as one movement rather than two.
  const leave = (fn: () => void): void => {
    setShown(false);
    handoverTimer.current = window.setTimeout(appComesForward, HANDOVER_MS);
    exitTimer.current = window.setTimeout(fn, LAUNCHPAD_MS);
  };
  const dismiss = (): void => leave(() => onClose(true));
  const choose = (m: NavModule): void => {
    if (m.id !== current.id) onChoose(m);
    leave(() => onClose(false));
  };

  useEffect(() => {
    // The app starts back first; the launcher arrives a beat later, into the space it left.
    appStepsBack();
    const enter = window.setTimeout(() => setShown(true), HANDOVER_MS);
    // A launchpad is a screen while it is up: the page behind must not scroll under it. Taking
    // the scrollbar away would let the app reflow wider by its width, so its space is held —
    // inline-end covers both writing directions, since that is the side the scrollbar sits on.
    const { overflow, paddingInlineEnd } = document.body.style;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (gutter > 0) document.body.style.paddingInlineEnd = `${gutter}px`;
    (filterRef.current ??
      gridRef.current?.querySelector<HTMLButtonElement>('[data-current="true"]') ??
      gridRef.current?.querySelector<HTMLButtonElement>('[data-module-card]'))?.focus();
    return () => {
      window.clearTimeout(enter);
      document.body.style.overflow = overflow;
      document.body.style.paddingInlineEnd = paddingInlineEnd;
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      if (handoverTimer.current !== null) window.clearTimeout(handoverTimer.current);
      // Unmounted without going through `leave` (a route change, say): the app must still return.
      appComesForward();
    };
  }, []);

  /**
   * Two facts the layout has to be asked for rather than assumed: how many cards ended up on a
   * row (the entry cascade goes row by row) and whether the grid actually overflows (only then
   * does it get its soft top/bottom edge — with six cards the same mask would quietly fade the
   * cards themselves). Both are read after layout and before the entry frame.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (el === null) return undefined;
    const measure = (): void => {
      setScrollable(el.scrollHeight > el.clientHeight + 1);
      setCols(columnsOf(cards()));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible.length]);

  // Escape and Alt+M both put it away — the chord that opened it also closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || (e.altKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM'))) {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Bound once for the life of the overlay: `dismiss` only ever closes this instance.
  }, []);

  /** Tab stays inside: nothing behind the overlay is reachable while it is up. */
  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const focusables = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('button, input') ?? [],
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /** The grid is driven like a grid: arrows move by row and column, mirrored for RTL. */
  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const all = cards();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = columnsOf(all);
    const step: Record<string, number | undefined> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: cols,
      ArrowUp: -cols,
    };
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = all.length - 1;
    else {
      const d = step[e.key];
      if (d === undefined) return;
      next = i + d;
    }
    e.preventDefault();
    // Walking up off the top row lands in the filter, where typing is the faster path anyway.
    if (next < 0 && filterRef.current !== null) {
      filterRef.current.focus();
      return;
    }
    all[Math.max(0, Math.min(all.length - 1, next))]?.focus();
  };

  const onFilterKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      cards()[0]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const only = visible[0];
      if (only !== undefined) choose(only);
    }
  };

  return createPortal(
    <div
      className={cn('fixed inset-0 z-[90]', shown ? '' : 'pointer-events-none')}
      role="dialog"
      aria-modal="true"
      aria-label={t('nav.modules')}
    >
      {/* A wash rather than a wall. The blur now lives on the receding app itself, so this only
          has to settle the contrast under the type — the workspace behind stays recognisable. */}
      <div
        aria-hidden="true"
        onClick={dismiss}
        className={cn(
          'absolute inset-0 bg-slate-100/40 backdrop-blur-[2px] transition-opacity duration-[170ms]',
          'dark:bg-slate-950/45',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* Not a panel floating over the app but a SCREEN: the title sits near the top of the
          viewport, the cards take the middle, the shortcut legend rests on the bottom edge.
          There is no dialog silhouette anywhere, which is what makes it read as a place you
          entered rather than a window that opened. */}
      <div
        ref={panelRef}
        onKeyDown={onPanelKey}
        className={cn(
          'relative flex h-full flex-col px-6 pb-7 pt-14 transition-[opacity,transform]',
          'duration-[170ms] ease-[cubic-bezier(0.16,1,0.3,1)] sm:px-10 sm:pb-8 sm:pt-20',
          shown ? 'scale-100 opacity-100' : 'scale-[0.985] opacity-0',
        )}
      >
        <div className="mx-auto flex min-h-0 w-full max-w-[1300px] flex-1 flex-col">
          {/* Header and legend are pinned; only the grid scrolls, so twenty modules still open
              on a title and a search field rather than on a wall of cards. */}
          <div className="relative shrink-0 pb-8 text-center">
            <p className="text-[17px] font-semibold tracking-[-0.01em] text-slate-900 dark:text-slate-50">
              {t('nav.modules')}
            </p>
            <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
              {t('nav.launchpadSubtitle')}
            </p>
            {/* Aligned with the title rather than jammed into the viewport corner, where it would
                sit on the topbar's own controls and read as one of them. */}
            <button
              type="button"
              onClick={dismiss}
              aria-label={t('common.close')}
              className={cn(
                'absolute -top-1 end-0 rounded-lg p-2 text-slate-400 transition-colors',
                'hover:bg-slate-900/[0.05] hover:text-slate-700 focus-visible:ring-2',
                'focus-visible:ring-slate-500 focus-visible:ring-offset-2',
                'focus-visible:ring-offset-white dark:hover:bg-white/[0.07]',
                'dark:hover:text-slate-200 dark:focus-visible:ring-offset-slate-950',
              )}
            >
              <CloseIcon className="h-4 w-4" />
            </button>
            {withFilter && (
              <div className="relative mx-auto mt-5 w-full max-w-[320px]">
                <SearchIcon className="pointer-events-none absolute inset-y-0 start-3.5 my-auto h-4 w-4 text-slate-400" />
                <input
                  ref={filterRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onFilterKey}
                  placeholder={t('nav.filterModules')}
                  aria-label={t('nav.filterModules')}
                  className={cn(
                    'h-10 w-full rounded-xl border border-slate-200 bg-white ps-10 pe-3.5 text-[13px]',
                    'text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] placeholder:text-slate-400',
                    'focus-visible:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-500',
                    'focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
                    'dark:focus-visible:ring-offset-slate-950',
                  )}
                />
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2.5 pb-10">
              <InboxIcon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-[13px] text-slate-500 dark:text-slate-400">{t('nav.noModules')}</p>
            </div>
          ) : (
            <div
              ref={gridRef}
              onKeyDown={onGridKey}
              // The padding keeps hover shadows and focus rings from being clipped by the scroller.
              className={cn(
                '-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2',
                // Centred only while everything fits. A centred flex child that overflows pushes
                // its first row above the scroll origin, where nothing can reach it — with twenty
                // modules that row is the one holding the module you are in.
                scrollable
                  ? 'justify-start [mask-image:linear-gradient(to_bottom,transparent,black_24px,black_calc(100%_-_24px),transparent)]'
                  : 'justify-center',
              )}
            >
              <div className="flex flex-wrap justify-center gap-5">
                {visible.map((m, i) => (
                  <ModuleCard
                    key={m.id}
                    module={m}
                    isCurrent={m.id === current.id}
                    shown={shown}
                    delayMs={Math.min(Math.floor(i / cols), STAGGER_MAX_ROWS) * STAGGER_MS}
                    onPick={() => choose(m)}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>,
    document.body,
  );
};

const ModuleSwitcher = ({
  modules,
  current,
  collapsed = false,
  shortcuts,
  onOpen,
  onPick,
}: {
  modules: NavModule[];
  current: NavModule;
  collapsed?: boolean;
  /**
   * Whether this switcher answers the Alt+M chord. The shell is mounted twice — the desktop
   * column and the mobile drawer both live in the DOM at all times — so exactly one of them may
   * listen, or one keystroke would raise two launchpads on top of each other.
   */
  shortcuts: boolean;
  /** Fired as the launchpad opens, so the mobile drawer can step out from behind it. */
  onOpen?: (() => void) | undefined;
  onPick: (m: NavModule) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const CurrentIcon = resolveNavIcon(current.icon, BuildingIcon);
  const only = modules.length <= 1;

  const raise = (): void => {
    setOpen(true);
    onOpen?.();
  };

  // Alt+M — a dedicated chord, deliberately NOT ⌘K: the palette already owns that muscle memory
  // for "go to a page", and overloading it would make both slower to think about. While the
  // launchpad is up it owns the chord itself, so the two never fight over one keystroke.
  useEffect(() => {
    if (only || open || !shortcuts) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM')) {
        e.preventDefault();
        raise();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `raise` closes over props that do not change for a mounted shell.
  }, [only, open, shortcuts]);

  // One module: a quiet label, not a control.
  if (only) {
    return (
      <div
        className={cn(
          'flex h-8 items-center gap-2.5 text-[13px] font-medium text-slate-700 dark:text-slate-200',
          collapsed ? 'w-8 justify-center' : 'px-2',
        )}
      >
        <CurrentIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
        {!collapsed && <span className="min-w-0 truncate">{localized(current.name, locale)}</span>}
      </div>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={raise}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('nav.switchModule')}
        title={`${localized(current.name, locale)} · ${t('nav.switchModuleHint')}`}
        className={cn(
          'flex h-8 items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors',
          'text-slate-700 hover:bg-slate-900/[0.04] focus-visible:outline-none',
          'focus-visible:ring-2 focus-visible:ring-slate-400/40',
          'dark:text-slate-200 dark:hover:bg-white/[0.05]',
          collapsed ? 'w-8 justify-center' : 'w-full px-2',
        )}
      >
        <CurrentIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-start">
              {localized(current.name, locale)}
            </span>
            <GridIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
          </>
        )}
      </button>

      {open && (
        <Launchpad
          modules={modules}
          current={current}
          onChoose={onPick}
          onClose={(focusTrigger) => {
            setOpen(false);
            if (focusTrigger) triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
};

// ── Collapsed mode: the switcher, then THIS module's page icons ─────────────
const StripLink = ({
  route,
  name,
  Icon,
  end,
  onNavigate,
}: {
  route: string;
  name: string;
  Icon: NavIcon;
  end: boolean;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => (
  <NavLink
    to={route}
    end={end}
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
    <Icon className="h-4 w-4" />
  </NavLink>
);

const IconStrip = ({
  modules,
  current,
  pinnedApps,
  allRoutes,
  shortcuts,
  onPickModule,
  onNavigate,
}: {
  modules: NavModule[];
  current: NavModule;
  /** Collapsed must not silently drop features the expanded column has. */
  pinnedApps: NavApp[];
  allRoutes: string[];
  shortcuts: boolean;
  onPickModule: (m: NavModule) => void;
  onNavigate?: (() => void) | undefined;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const moduleRoutes = current.apps.map((a) => a.route);
  return (
    <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-2 py-3">
      <ModuleSwitcher
        modules={modules}
        current={current}
        collapsed
        shortcuts={shortcuts}
        onOpen={onNavigate}
        onPick={onPickModule}
      />
      <div className="my-1 h-px w-6 bg-slate-200 dark:bg-slate-700" />
      {pinnedApps.length > 0 && (
        <>
          {pinnedApps.map((a) => (
            <StripLink
              key={`pin-${a.id}`}
              route={a.route}
              name={localized(a.name, locale)}
              Icon={resolveNavIcon(a.icon, FileIcon)}
              end={requiresExactMatch(a.route, allRoutes)}
              onNavigate={onNavigate}
            />
          ))}
          <div className="my-1 h-px w-6 bg-slate-200 dark:bg-slate-700" />
        </>
      )}
      {current.apps.map((a) => {
        return (
          <StripLink
            key={a.id}
            route={a.route}
            name={localized(a.name, locale)}
            Icon={resolveNavIcon(a.icon, FileIcon)}
            end={requiresExactMatch(a.route, moduleRoutes)}
            onNavigate={onNavigate}
          />
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
  shortcuts = true,
  onNavigate,
}: {
  collapsible?: boolean;
  /** Only one mounted shell may answer the global chord — see `ModuleSwitcher.shortcuts`. */
  shortcuts?: boolean;
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
  const lastPages = useRef<Record<string, string>>(loadLastPages());
  useEffect(() => {
    if (urlModuleId === null) return;
    if (urlModuleId !== lastModuleId) {
      setLastModuleId(urlModuleId);
      persistLastModule(urlModuleId);
    }
    // Remember the desk, not just the building: switching back should return here.
    if (lastPages.current[urlModuleId] !== pathname) {
      lastPages.current = { ...lastPages.current, [urlModuleId]: pathname };
      persistLastPages(lastPages.current);
    }
  }, [urlModuleId, lastModuleId, pathname]);

  const [collapsed, setCollapsed] = useState<boolean>(() => collapsible && loadCollapsed());

  // Every route the catalog serves — the basis for "does another page live under this one?".
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
    const route = moduleEntryRoute(m, lastPages.current[m.id] ?? null);
    if (route === null) return;
    navigate(route);
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
          pinnedApps={pinnedApps}
          allRoutes={allRoutes}
          shortcuts={shortcuts}
          onPickModule={pickModule}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          <div className="border-b border-slate-200/60 px-3 py-2 dark:border-slate-800/60">
            <ModuleSwitcher
              modules={modules}
              current={current}
              shortcuts={shortcuts}
              onOpen={onNavigate}
              onPick={pickModule}
            />
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
            {/* This module's pages, and nothing else. */}
            <ul className="space-y-px">
              {current.apps.map((a) => (
                <AppWithChildren
                  key={a.id}
                  app={a}
                  onNavigate={onNavigate}
                  end={requiresExactMatch(a.route, allRoutes)}
                />
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
              'flex h-8 items-center gap-2.5 rounded-md text-slate-400 transition-colors',
              'hover:bg-slate-900/[0.04] hover:text-slate-600 focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:text-slate-500',
              'dark:hover:bg-white/[0.05] dark:hover:text-slate-300',
              collapsed ? 'w-9 justify-center' : 'w-full px-2',
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
          {/* The drawer's shell stays mounted while closed, so it must not also answer Alt+M —
              one chord, one launchpad. Opening the launchpad closes the drawer behind it rather
              than stacking two dimmed layers. */}
          <NavShell collapsible={false} shortcuts={false} onNavigate={close} />
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
