// «لوحة تحكم الحركة» — the frame around the tabs (the approved v2 shell, zz-fleetdash-v2.tsx):
//
//   · NO PAGE HEAD. The sticky pill navbar is the first thing in the content: the brand logo badge at
//     one end, the two groups «الآن» | «حسب الفلاتر», the pressed tab in the site's indigo (the
//     custody tabs' pressed look), a count on the tabs that have one (plan §5.10).
//   · The tab heading's «آخر تحديث قبل N ثانية» + «تحديث» (D6).
//   · A section the server could not compute shows its error and «إعادة المحاولة»; a whole read
//     that failed shows the read's error; a read on its way shows the skeleton of a tab.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FLEET_DASHBOARD_NOW_TABS,
  FLEET_DASHBOARD_PERIOD_TABS,
  type FleetDashboardNowDto,
  type FleetDashboardTab,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { FRESHNESS_TICK_MS, freshness } from '../../lib/fleet-dashboard-refresh';
import { type AlertLine, type TabBadge } from '../../lib/fleet-dashboard-tabs';
import { type CustodyFigures } from './custody-fund-line';
import { COUNT, custodyCountForm, useMoney } from '../custody-dashboard-parts';
import { BTN, Card, I, Icon, MUTED, N, NUM, NOTE, UNIT, cn } from './dash-kit';

// ── What every «الآن» tab is given ──────────────────────────────────────────────────────────────

export interface NowTabProps {
  /** R1's answer; `null` when the reader holds no key of R1 (custody alone). */
  now: FleetDashboardNowDto | null;
  /** The custody screen's own figures; `null` without `fleetCustody.view`. */
  custody: CustodyFigures | null;
  /** The alert lines that fired (`alertLines`), red first. */
  lines: readonly AlertLine[];
  can: (permission: string) => boolean;
  /** When the tab's figures last answered (ms since the epoch). */
  updatedAt: number;
  refreshing: boolean;
  /** «تحديث»: refetch R1 and the custody reads. */
  onRefresh: () => void;
  /** «إعادة المحاولة» on a section that failed. */
  onRetry: () => void;
  /** A fixed «now» for the heading's freshness — the specs pin it. */
  clock?: number;
}

// ── The pill navbar ───────────────────────────────────────────────────────────────────────────

/** The count on a tab: the rail's tones; on the pressed pill they read against its fill. */
const BADGE: Record<TabBadge['tone'], { off: string; on: string }> = {
  red: {
    off: 'bg-red-600 text-white dark:bg-red-500',
    on: 'bg-red-500 text-white dark:bg-red-600',
  },
  amber: {
    off: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    on: 'bg-amber-400 text-slate-900 dark:bg-amber-400 dark:text-slate-900',
  },
  plain: {
    off: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    on: 'bg-white/20 text-white',
  },
};

const NAV_BAR = cn(
  'flex min-h-14 items-center gap-2 rounded-full border p-1.5',
  'border-slate-200/80 bg-white shadow-[0_12px_32px_-14px_rgba(15,23,42,.28),0_2px_6px_-2px_rgba(15,23,42,.06)]',
  'dark:border-[rgba(42,58,84,.65)] dark:bg-[#121a2a] dark:shadow-[0_14px_34px_-12px_rgba(0,0,0,.75),inset_0_1px_0_0_rgba(255,255,255,.05)]',
);
/** The system's pressed tab (CustodyTabs.tsx): brand, white text. */
const PILL_ON = 'bg-brand-600 text-white shadow-md shadow-brand-700/30';
const PILL_OFF =
  'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white';

/** The bar's short word for a tab whose heading is long (the heading is its tooltip). */
const SHORT: Partial<Record<FleetDashboardTab, string>> = {
  licences: 'fleet.dash.shell.tabShort.licences',
};

const NavTab = ({
  tab,
  on,
  badge,
  onPick,
}: {
  tab: FleetDashboardTab;
  on: boolean;
  badge: TabBadge | undefined;
  onPick: (tab: FleetDashboardTab) => void;
}): JSX.Element => {
  const t = useT();
  const label = t(`fleet.dash.shell.tab.${tab}`);
  const short = SHORT[tab];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      data-dash-tab={tab}
      title={short !== undefined ? label : undefined}
      onClick={() => onPick(tab)}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-semibold leading-5 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-1',
        on ? PILL_ON : PILL_OFF,
      )}
    >
      <span>{short !== undefined ? t(short) : label}</span>
      {badge !== undefined && (
        <span
          data-dash-badge={tab}
          title={t(`fleet.dash.shell.badge.${tab}`, { count: badge.n })}
          className={cn(
            'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none',
            NUM,
            on ? BADGE[badge.tone].on : BADGE[badge.tone].off,
          )}
        >
          {badge.n}
        </span>
      )}
    </button>
  );
};

/**
 * The first thing in the content. It sticks to the top of the scrolling `main` while the page scrolls
 * and stands at the same place at rest and stuck; its strip fades the page out under it.
 */
export const TopNav = ({
  visible,
  active,
  badges,
  onPick,
}: {
  visible: readonly FleetDashboardTab[];
  active: FleetDashboardTab;
  badges: Partial<Record<FleetDashboardTab, TabBadge>>;
  onPick: (tab: FleetDashboardTab) => void;
}): JSX.Element => {
  const t = useT();
  const group = (
    tabs: readonly FleetDashboardTab[],
    zone: 'now' | 'filters',
  ): JSX.Element | null => {
    const shown = tabs.filter((tab) => visible.includes(tab));
    if (shown.length === 0) return null;
    return (
      <div
        role="group"
        aria-label={t(`fleet.dash.shell.group.${zone}`)}
        data-dash-group={zone}
        className="flex items-center gap-0.5"
      >
        {shown.map((tab) => (
          <NavTab key={tab} tab={tab} on={tab === active} badge={badges[tab]} onPick={onPick} />
        ))}
      </div>
    );
  };
  const live = group(FLEET_DASHBOARD_NOW_TABS, 'now');
  const filtered = group(FLEET_DASHBOARD_PERIOD_TABS, 'filters');
  // On a narrow screen the pills scroll sideways: bring the pressed one into the strip, sideways
  // only (the page itself never moves) — again whenever the pills change width (a tab or a badge
  // arrives with its read, the fonts land).
  const strip = useRef<HTMLDivElement>(null);
  const shape = `${visible.join()}|${Object.values(badges)
    .map((badge) => badge.n)
    .join()}`;
  useEffect(() => {
    let live = true;
    const reveal = (): void => {
      const box = strip.current;
      const pill = box?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!live || box === null || box === undefined || pill === null || pill === undefined) {
        return;
      }
      const outer = box.getBoundingClientRect();
      const inner = pill.getBoundingClientRect();
      if (inner.left < outer.left) box.scrollLeft -= outer.left - inner.left + 8;
      else if (inner.right > outer.right) box.scrollLeft += inner.right - outer.right + 8;
    };
    reveal();
    void document.fonts?.ready.then(reveal);
    return () => {
      live = false;
    };
  }, [active, shape]);
  return (
    <div
      data-dash-sticky="true"
      className="sticky top-0 z-20 -mx-3 bg-[linear-gradient(to_bottom,#f8fafc_0,#f8fafc_calc(100%-14px),rgba(248,250,252,0))] px-3 pb-4 pt-6 dark:bg-[linear-gradient(to_bottom,#020617_0,#020617_calc(100%-14px),rgba(2,6,23,0))]"
    >
      <nav
        data-dash-nav="true"
        role="tablist"
        aria-orientation="horizontal"
        aria-label={t('fleet.dash.shell.navLabel')}
        className={NAV_BAR}
      >
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-md shadow-brand-700/30"
        >
          <Icon d={I.truck} className="h-5 w-5" />
        </span>
        {/* Centred while the pills fit; once they overflow, the auto margins fall to zero, so the
            strip starts at its first pill and every pill can be scrolled to (a centred overflow
            would push the first pills out of reach). */}
        <div ref={strip} className="flex min-w-0 flex-1 items-center overflow-x-auto">
          <div className="mx-auto flex shrink-0 items-center gap-2">
            {live}
            {live !== null && filtered !== null && (
              <span
                aria-hidden="true"
                className="mx-1 h-6 w-px shrink-0 bg-slate-200 dark:bg-[#26324a]"
              />
            )}
            {filtered}
          </div>
        </div>
      </nav>
    </div>
  );
};

// ── «آخر تحديث قبل N ثانية» + «تحديث» ─────────────────────────────────────────────────────────

/** The muted time of the last answer, then the outline button whose icon spins while it works. */
export const RefreshTools = ({
  updatedAt,
  onRefresh,
  refreshing = false,
  clock,
}: {
  /** When the read last answered (ms since the epoch; 0 = not yet). */
  updatedAt: number;
  onRefresh: () => void;
  refreshing?: boolean;
  /** A fixed «now», for the specs; the heading ticks on its own otherwise. */
  clock?: number;
}): JSX.Element => {
  const t = useT();
  const noun = useNoun();
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (clock !== undefined) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), FRESHNESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [clock]);
  const fresh = freshness(updatedAt, clock ?? tick);
  return (
    <>
      {fresh !== null && (
        <span
          data-dash-updated="true"
          className={cn('whitespace-nowrap text-xs font-semibold', MUTED)}
        >
          {fresh.unit === 'now' ? (
            t('fleet.dash.shell.updatedNow')
          ) : (
            <Phrase
              text={t('fleet.dash.shell.updatedAgo')}
              parts={{
                count: <N>{fresh.n}</N>,
                noun: noun(fresh.unit === 'seconds' ? 'second' : 'minute', fresh.n),
              }}
            />
          )}
        </span>
      )}
      {/* Held while a read is on its way: a second press would only start the same read again. */}
      <button
        type="button"
        data-dash-refresh="true"
        onClick={onRefresh}
        disabled={refreshing}
        aria-busy={refreshing}
        className={cn(BTN.outline, 'disabled:cursor-wait disabled:opacity-70')}
      >
        <Icon d={I.refresh} className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        {t('fleet.dash.shell.refresh')}
      </button>
    </>
  );
};

/**
 * A translated sentence with some of its values set apart: each `{{name}}` of the template (read
 * with `t(key)` and no params, so the placeholders stay) is replaced by `parts[name]` — a figure in
 * the figure face, a car chip, a link. A placeholder with no part is left as written.
 */
export const Phrase = ({
  text,
  parts,
}: {
  text: string;
  parts: Record<string, ReactNode>;
}): JSX.Element => (
  <>
    {text.split(/(\{\{\w+\}\})/u).map((piece, i) => {
      const name = /^\{\{(\w+)\}\}$/u.exec(piece)?.[1];
      return (
        <Fragment key={i}>{name !== undefined && name in parts ? parts[name] : piece}</Fragment>
      );
    })}
  </>
);

// ── Counted words and money ───────────────────────────────────────────────────────────────────

export type DashNoun =
  | 'car'
  | 'driver'
  | 'card'
  | 'request'
  | 'row'
  | 'notice'
  | 'alert'
  | 'file'
  | 'violation'
  | 'day'
  | 'visit'
  | 'second'
  | 'minute';

/**
 * The counted noun: Arabic writes «1 سيارة», «3 سيارات», «11 سيارة» (the custody dashboard's rule,
 * `custodyCountForm`), English the plural but for one.
 */
export const useNoun = (): ((noun: DashNoun, n: number) => string) => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  return (noun, n) => t(`fleet.dash.common.noun.${noun}.${custodyCountForm(locale, n)}`);
};

/** A whole count as the boards write it: Latin digits, comma-grouped. */
export const count = (n: number): string => COUNT.format(n);

/** An amount and «ج.م.», kept on one line: the figure face, the unit a size down. A negative keeps
 *  its minus before the figure, left to right. The two sit in the line (not in an inline-flex box,
 *  which a decoration never enters), so inside a link (`Fig`) the figure wears the link's dotted
 *  line; the unit is an inline block, so it does not. */
export const Amount = ({
  value,
  className,
  unitClassName = UNIT,
}: {
  value: number;
  className?: string;
  unitClassName?: string;
}): JSX.Element => {
  const { figure, currency } = useMoney()(Math.abs(value));
  return (
    <span className="whitespace-nowrap">
      <N className={cn('font-bold', className)}>
        {value < 0 ? '−' : ''}
        {figure}
      </N>
      <span className={cn('ms-1 inline-block', unitClassName)}>{currency}</span>
    </span>
  );
};

// ── States ────────────────────────────────────────────────────────────────────────────────────

/** A section whose source failed (named in `unavailable`): the error and the retry, in its place. */
export const SectionError = ({
  section,
  onRetry,
  className,
}: {
  section: string;
  onRetry: () => void;
  className?: string;
}): JSX.Element => {
  const t = useT();
  return (
    <Card
      data-section-error={section}
      className={cn('items-center justify-center gap-3 px-5 py-8 text-center', className)}
    >
      <Icon d={I.warn} className="h-6 w-6 text-red-500 dark:text-red-400" />
      <p className={cn(NOTE, 'text-[13px]')}>{t('fleet.dash.common.sectionError')}</p>
      <button type="button" onClick={onRetry} className={BTN.outline}>
        <Icon d={I.refresh} className="h-4 w-4" />
        {t('fleet.dash.common.retry')}
      </button>
    </Card>
  );
};

/** A read on its way: the tab's shape in grey, never zeroes pretending to be data. */
export const TabSkeleton = (): JSX.Element => (
  <div data-dash-loading="true" className="space-y-5">
    <Skeleton className="h-12 w-72 rounded-xl" />
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-44 rounded-2xl" />
      ))}
    </div>
  </div>
);

/** A whole read that failed: its error and the retry. */
export const ReadError = ({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): JSX.Element => (
  <Card data-dash-read-error="true">
    <ErrorState error={error} onRetry={onRetry} />
  </Card>
);
