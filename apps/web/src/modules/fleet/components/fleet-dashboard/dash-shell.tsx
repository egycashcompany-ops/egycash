// «لوحة تحكم الحركة» — the frame around the tabs (the approved v2 shell, zz-fleetdash-v2.tsx; the
// strip, its scroll cue and the branch chip from the approved bars, zz-fuel.tsx / zz-today.tsx):
//
//   · NO PAGE HEAD. The sticky pill navbar is the first thing in the content: the brand logo badge at
//     one end, ONE strip of tabs in the bar's order (the old «الآن» | «حسب الفلاتر» groups are gone —
//     the new tabs and the old ones still waiting for their redesign share one order), the pressed
//     tab in the site's indigo (the custody tabs' pressed look), a count on the tabs that have one.
//   · When the pills do not fit, the strip scrolls sideways: a cue on each side that hides pills, the
//     pressed pill kept clear of it, never a pill cut to a sliver.
//   · «الفرع: …» at the bar's far end, outside the tab list: what the figures cover, as the server
//     answered it (the whole company, the branch, or «كل فروعي»). A statement, not a picker — the
//     app bar's switcher is the picker.
//   · The tab heading's «آخر تحديث قبل N ثانية» + «تحديث» (D6).
//   · A section the server could not compute shows its error and «إعادة المحاولة»; a whole read
//     that failed shows the read's error; a read on its way shows the skeleton of a tab.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  type FleetDashboardNamedDto,
  type FleetDashboardNowDto,
  type FleetDashboardPeriodDto,
  type FleetDashboardTab,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { localized } from '../../../../shared/lib/format';
import { Skeleton } from '../../../../shared/ui/Skeleton';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { FRESHNESS_TICK_MS, freshness } from '../../lib/fleet-dashboard-refresh';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { type AlertLine, type TabBadge } from '../../lib/fleet-dashboard-tabs';
import { type CustodyFigures } from './custody-fund-line';
import { COUNT, custodyCountForm, useMoney } from '../custody-dashboard-parts';
import { BTN, Card, I, Icon, MUTED, N, NUM, NOTE, UNIT, cn } from './dash-kit';

// ── What every «الآن» tab is given ──────────────────────────────────────────────────────────────

/**
 * R2 over «هذا الشهر» — the 1st of the month to today, with NO page filter (no period, type,
 * operation or codes): the overview's month card. The page reads it; only the overview draws it.
 */
export interface MonthRead {
  /** The answer; `undefined` while it is on its way, failed with nothing kept, or not asked. */
  data: FleetDashboardPeriodDto | undefined;
  loading: boolean;
  failed: boolean;
  /** `false` when the reader holds no key of R2 (or the tab does not draw it): no card at all. */
  enabled: boolean;
  /** «إعادة المحاولة» on the month card. */
  onRetry: () => void;
}

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
  /** «تحديث»: refetch R1 and the custody reads (and, on the overview, the month read). */
  onRefresh: () => void;
  /** «إعادة المحاولة» on a section that failed. */
  onRetry: () => void;
  /** A fixed «now» for the heading's freshness — the specs pin it. */
  clock?: number;
  /** R2 «هذا الشهر» (no page filters) — read by the page, only the overview draws it. */
  month: MonthRead;
  /**
   * A link to another tab of this page, keeping the page's own filters (never a period of its own);
   * `null` when the reader cannot see that tab — the figure is then plain.
   */
  tabLink: (tab: FleetDashboardTab, metric: string) => DashLink | null;
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
        'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[14px] font-semibold leading-5 transition-colors min-[1800px]:px-3',
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
 * What the figures cover, as the server echoed it: `null` = the whole company; a list = the
 * reader's branches (one = a branch view, several = «كل فروعي»). `undefined` = no read has answered
 * yet, `[]` = a branch reach with no branch (nothing in reach): the chip is not drawn for either.
 */
export type DashScope = readonly FleetDashboardNamedDto[] | null | undefined;

type ScopeKind = 'company' | 'one' | 'several';

/** The chip's statement, or `null` when there is nothing true to state yet. */
const scopeChip = (
  scope: DashScope,
  locale: Locale,
): { kind: ScopeKind; name: string | null } | null => {
  if (scope === undefined) return null;
  if (scope === null) return { kind: 'company', name: null };
  const [first, second] = scope;
  if (first === undefined) return null;
  return second === undefined
    ? { kind: 'one', name: localized(first.name, locale) }
    : { kind: 'several', name: null };
};

/**
 * «الفرع: الشركة كلها» — what the figures cover, at the bar's far end, outside the tab list. It
 * states the app bar's switcher (as the server honoured it); it is not a second picker: no link, no
 * button. A narrowed dashboard wears the brand tint, so it is never mistaken for the whole company.
 */
const BranchChip = ({
  chip,
  at,
  className,
}: {
  chip: { kind: ScopeKind; name: string | null };
  /** The bar's copy, or the one standing above the bar on a phone (each shows at its own width). */
  at: 'bar' | 'phone';
  className?: string;
}): JSX.Element => {
  const t = useT();
  const company = chip.kind === 'company';
  const word =
    chip.kind === 'company'
      ? t('nav.branchSwitcher.all')
      : chip.kind === 'several'
        ? t('nav.branchSwitcher.mine')
        : chip.name;
  return (
    <span
      {...(at === 'bar'
        ? { 'data-dash-branch': chip.kind }
        : { 'data-dash-branch-phone': chip.kind })}
      className={cn(
        'me-1 inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-semibold',
        className,
        company
          ? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-[#26324a] dark:bg-[#0d1424] dark:text-slate-200'
          : 'border-brand-500/50 bg-brand-500/15 text-brand-700 dark:text-brand-200',
      )}
    >
      <Icon d={I.building} className="h-4 w-4 shrink-0 opacity-70" />
      <span className={company ? MUTED : 'opacity-80'}>{t('fleet.dash.shell.branch')}</span>
      <span className="font-bold">{word}</span>
    </span>
  );
};

/** How far the strip keeps the pressed pill from an edge that wears a scroll cue (the cue's width). */
const CUE_ROOM = 64;
/** The cue's width (w-14). Its outer 80 % is solid, so a pill cut at the cue's inner edge hides under
 *  it whole: its last letters and its count with it. */
const CUE_W = 56;
/** A pill the clear part of the strip shows less of than this share of is a sliver (a letter or two,
 *  or a count without its name): the strip settles where none shows. Its first 10 px are its padding
 *  (px-2.5): a cut that shows no more than that shows no letter. */
const SLIVER = 0.6;
const PILL_PAD = 10;
/** A short pill («الصيانة», «نظرة عامة») shows whole or not at all: any cut leaves a broken word. */
const SHORT_PILL = 90;
/** On a phone, a neighbour beside the pressed pill fades out within this many px of the pill. */
const FADE_W = 24;

/**
 * The cue on a side of the strip that hides pills: a fade and a round chevron that pages the strip.
 * Logical sides (RTL: the start is the right, the end the left). A pointer's aid only — hidden from
 * the reading order and the Tab key: the pills themselves are reached by the keyboard.
 */
const StripCue = ({ side, onPage }: { side: 'start' | 'end'; onPage: () => void }): JSX.Element => (
  <div
    data-dash-cue={side}
    aria-hidden="true"
    className={cn(
      'pointer-events-none absolute inset-y-0 flex w-14 items-center from-white from-80% to-transparent dark:from-[#121a2a]',
      side === 'end'
        ? 'end-0 justify-start rtl:bg-gradient-to-r ltr:bg-gradient-to-l'
        : 'start-0 justify-end rtl:bg-gradient-to-l ltr:bg-gradient-to-r',
    )}
  >
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={onPage}
      className="pointer-events-auto grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm hover:text-slate-900 dark:border-[#2a3a54] dark:bg-[#0d1424] dark:text-slate-300 dark:hover:text-white"
    >
      <Icon
        d={I.chevron}
        className={cn(
          'h-3.5 w-3.5',
          side === 'end' ? 'rtl:rotate-90 ltr:-rotate-90' : 'rtl:-rotate-90 ltr:rotate-90',
        )}
      />
    </button>
  </div>
);

/**
 * The first thing in the content. It sticks to the top of the scrolling `main` while the page scrolls
 * and stands at the same place at rest and stuck; its strip fades the page out under it.
 */
export const TopNav = ({
  visible,
  active,
  badges,
  onPick,
  scope,
}: {
  /** The tabs this reader sees, in the bar's order (`FLEET_DASHBOARD_TABS` filtered). */
  visible: readonly FleetDashboardTab[];
  active: FleetDashboardTab;
  badges: Partial<Record<FleetDashboardTab, TabBadge>>;
  onPick: (tab: FleetDashboardTab) => void;
  /** What the figures cover (the reads' `scopeBranches` echo) — the «الفرع: …» chip. */
  scope: DashScope;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const chip = scopeChip(scope, locale);
  // On a narrow screen the pills scroll sideways inside the strip, the pressed one brought into
  // sight clear of the cue, a cue on each side that hides pills — sideways only (the page itself
  // never moves), again whenever the pills change width (a tab or a badge arrives with its read,
  // the fonts land) or the strip does (the window, the chip arriving beside it).
  const strip = useRef<HTMLDivElement>(null);
  const [cue, setCue] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  // A phone's strip holds the pressed pill and a part of a neighbour at best: the pill is centred
  // and what is beside it fades out over this many px, so a cut neighbour reads as «more this
  // way», never as a tab's name.
  const [fade, setFade] = useState<number | null>(null);
  const shape = `${visible.join()}|${Object.values(badges)
    .map((badge) => badge.n)
    .join()}`;
  useEffect(() => {
    let live = true;
    const edges = (): void => {
      const box = strip.current;
      if (!live || box === null) return;
      const spare = box.scrollWidth - box.clientWidth;
      const at = Math.abs(box.scrollLeft);
      const next = { start: spare > 1 && at > 1, end: spare > 1 && at < spare - 1 };
      setCue((was) => (was.start === next.start && was.end === next.end ? was : next));
    };
    // Settle: of the places that put a pill's edge on a cue's inner edge (or an end of the strip)
    // and keep the pressed pill clear of the cues, take the one where every cut pill shows nothing
    // or most of itself, the nearest to the reveal. `scrollLeft` runs from 0 (the start) to −spare
    // in RTL and to +spare in LTR; either way a box at x moves to x + (s0 − s) when scrollLeft
    // goes from s0 to s.
    const settle = (): void => {
      const box = strip.current;
      const pressed = box?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (box === null || box === undefined || pressed === null || pressed === undefined) return;
      const spare = box.scrollWidth - box.clientWidth;
      if (spare <= 1) {
        setFade(null);
        return;
      }
      const rtl = window.getComputedStyle(box).direction === 'rtl';
      const far = rtl ? -spare : spare;
      const s0 = box.scrollLeft;
      const outer = box.getBoundingClientRect();
      const pills = [...box.querySelectorAll<HTMLElement>('[data-dash-tab]')].map((el) =>
        el.getBoundingClientRect(),
      );
      const on = pressed.getBoundingClientRect();
      const clamp = (s: number): number =>
        Math.round(Math.min(Math.max(s, Math.min(0, far)), Math.max(0, far)));
      // The pressed pill centred between the cues (a phone's strip is little wider than it).
      const centre = (outer.left + CUE_W + outer.right - CUE_W) / 2;
      const clear = box.clientWidth - 2 * CUE_W;
      if (clear < on.width + SHORT_PILL) {
        box.scrollLeft = clamp(s0 + (on.left + on.right) / 2 - centre);
        setFade(Math.max(16, Math.floor((clear - on.width) / 2)));
        return;
      }
      setFade(null);
      const places = new Set<number>([
        0,
        far,
        Math.round(s0),
        clamp(s0 + (on.left + on.right) / 2 - centre),
      ]);
      for (const b of pills) {
        places.add(clamp(s0 + b.right - (outer.right - CUE_W)));
        places.add(clamp(s0 + b.left - (outer.left + CUE_W)));
      }
      const slivers = (s: number): number | null => {
        const atStart = Math.abs(s) <= 1;
        const atEnd = Math.abs(s) >= spare - 1;
        // The cue on each physical side (RTL: the end on the left; LTR: the start on the left).
        const left = outer.left + ((rtl ? !atEnd : !atStart) ? CUE_W : 0);
        const right = outer.right - ((rtl ? !atStart : !atEnd) ? CUE_W : 0);
        const shift = s0 - s;
        if (on.left + shift < left - 0.5 || on.right + shift > right + 0.5) return null;
        return pills.filter((b) => {
          const seen = Math.min(b.right + shift, right) - Math.max(b.left + shift, left);
          const cut = seen > PILL_PAD && seen < b.width - 1;
          return cut && (seen < b.width * SLIVER || b.width < SHORT_PILL);
        }).length;
      };
      let best: { s: number; bad: number } | null = null;
      for (const s of places) {
        const bad = slivers(s);
        if (bad === null) continue;
        if (
          best === null ||
          bad < best.bad ||
          (bad === best.bad && Math.abs(s - s0) < Math.abs(best.s - s0))
        )
          best = { s, bad };
      }
      if (best !== null) box.scrollLeft = best.s;
    };
    const reveal = (): void => {
      const box = strip.current;
      const pill = box?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!live || box === null || box === undefined || pill === null || pill === undefined) return;
      const room =
        box.scrollWidth - box.clientWidth > 1
          ? Math.min(CUE_ROOM, Math.max(0, (box.clientWidth - pill.offsetWidth) / 2))
          : 0;
      const outer = box.getBoundingClientRect();
      const inner = pill.getBoundingClientRect();
      if (inner.left < outer.left + room) box.scrollLeft -= outer.left + room - inner.left;
      else if (inner.right > outer.right - room)
        box.scrollLeft += inner.right - (outer.right - room);
      settle();
      edges();
    };
    reveal();
    void document.fonts?.ready.then(reveal);
    const box = strip.current;
    box?.addEventListener('scroll', edges, { passive: true });
    // The strip's own width moves with the window and with the chip beside it.
    const watch =
      typeof ResizeObserver === 'undefined' || box === null ? null : new ResizeObserver(reveal);
    if (watch !== null && box !== null) watch.observe(box);
    else window.addEventListener('resize', reveal);
    return () => {
      live = false;
      box?.removeEventListener('scroll', edges);
      watch?.disconnect();
      window.removeEventListener('resize', reveal);
    };
  }, [active, shape]);
  const page = (toward: 'start' | 'end'): void => {
    const box = strip.current;
    if (box === null) return;
    const step = Math.round(box.clientWidth * 0.6);
    const rtl = window.getComputedStyle(box).direction === 'rtl';
    // Toward the end: left in RTL, right in LTR.
    const sign = (toward === 'end') === rtl ? -1 : 1;
    box.scrollBy({ left: sign * step, behavior: 'smooth' });
  };
  return (
    <div
      data-dash-sticky="true"
      className="sticky top-0 z-20 -mx-3 bg-[linear-gradient(to_bottom,#f8fafc_0,#f8fafc_calc(100%-14px),rgba(248,250,252,0))] px-3 pb-4 pt-6 dark:bg-[linear-gradient(to_bottom,#020617_0,#020617_calc(100%-14px),rgba(2,6,23,0))]"
    >
      {/* Under 640 px the strip beside the chip is narrower than the pressed pill: the chip stands
          above the bar, at the start. */}
      {chip !== null && (
        <div className="mb-2 flex sm:hidden">
          <BranchChip chip={chip} at="phone" />
        </div>
      )}
      <div data-dash-nav="true" className={NAV_BAR}>
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-600 text-white shadow-md shadow-brand-700/30 max-sm:hidden"
        >
          <Icon d={I.truck} className="h-5 w-5" />
        </span>
        <div className="relative flex min-w-0 flex-1">
          {/* Centred while the pills fit; once they overflow, the auto margins fall to zero, so the
              strip starts at its first pill and every pill can be scrolled to (a centred overflow
              would push the first pills out of reach). */}
          <div
            ref={strip}
            data-dash-strip="true"
            role="tablist"
            aria-orientation="horizontal"
            aria-label={t('fleet.dash.shell.navLabel')}
            className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={
              fade !== null && cue.start && cue.end
                ? {
                    maskImage: `linear-gradient(to right, transparent ${CUE_W + Math.max(0, fade - FADE_W)}px, #000 ${CUE_W + fade}px, #000 calc(100% - ${CUE_W + fade}px), transparent calc(100% - ${CUE_W + Math.max(0, fade - FADE_W)}px))`,
                  }
                : undefined
            }
          >
            <div className="mx-auto flex shrink-0 items-center gap-0.5">
              {visible.map((tab) => (
                <NavTab
                  key={tab}
                  tab={tab}
                  on={tab === active}
                  badge={badges[tab]}
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
          {cue.start && <StripCue side="start" onPage={() => page('start')} />}
          {cue.end && <StripCue side="end" onPage={() => page('end')} />}
        </div>
        {chip !== null && <BranchChip chip={chip} at="bar" className="max-sm:hidden" />}
      </div>
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
  | 'branch'
  | 'accident'
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
