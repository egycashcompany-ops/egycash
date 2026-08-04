// The navigation ROWS both shells share. A page row is a page row whether it sits in the
// launchpad's single column or in the rail's module panel, so the row language — monochrome
// states, the live count, the pin affordance, and the dynamic stages a module may publish
// (RW16) — lives here once and is imported by each shell rather than copied into it.
import { NavLink } from 'react-router-dom';
import { type Locale, type MyApplicationDto } from '@ecms/contracts';
import { useAppSelector } from '../../store';
import { useT } from '../localization/useT';
import { cn } from '../../shared/lib/cn';
import { localized } from '../../shared/lib/format';
import { FileIcon, StarIcon } from '../../shared/ui/icons';
import { resolveNavIcon } from '../navigation/app-icon';
import { useNavPrefs } from '../navigation/NavPrefs';
import { requiresExactMatch } from '../navigation/nav-model';
import {
  navChildrenProviderFor,
  type NavChild,
  type NavChildrenProvider,
} from '../navigation/nav-children';

// Monochrome: transparent by default, a whisper of tint on hover, and the active row a soft
// neutral tint + darker text. The eye finds "where am I" by weight, not by color.
export const rowClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'group/item flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] leading-5 transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40',
    isActive
      ? 'bg-slate-900/[0.06] font-medium text-slate-900 dark:bg-white/[0.08] dark:text-slate-100'
      : 'font-normal text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100',
  );

/** A live queue count as a plain right-aligned number — quieter than any badge. Zero is silence. */
export const Count = ({ count, active }: { count: number | null; active: boolean }): JSX.Element | null => {
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
export const ChildRow = ({
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

export const AppRow = ({
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
export const DynamicAppRow = ({
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
export const AppWithChildren = ({
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

/** The frame the column keeps while it is loading, failed, or empty — one width, no jumping. */
export const StateShell = ({ children }: { children: JSX.Element }): JSX.Element => (
  <div className="flex w-60 shrink-0 flex-col border-e border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-1 items-center justify-center overflow-y-auto">{children}</div>
  </div>
);
