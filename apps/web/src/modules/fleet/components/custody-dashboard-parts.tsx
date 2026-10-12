// What every card of «لوحة تحكم» shares — the owner's design («عاوز دى تكون فى شاشه العهد لما ادوس
// على لوحة التحكم فى اللايت سيم والدارك سيم»), its two themes as Tailwind `dark:` variants over the
// `dark` class the app stamps on <html>, and the arithmetic the drawings are made of.
//
// The design's `.obsidian-card` (dark) and the light map's `.light-card` are ONE class list here,
// so a card is the same card in both themes. Titles and figures are in Cairo — the design's
// `font-cairo`, served from `@fontsource/cairo` (imported by `FuelCardBoard`); the design's body
// font, IBM Plex Sans Arabic, is not installed, so the body keeps the app's own and nothing is
// fetched from Google at run time.
import { createContext, type ReactNode } from 'react';
import { type FleetFuelCardCompany, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { formatMoneyParts } from '../../../shared/lib/format';
import { BOARD_FONT, ymd } from './FuelCardBoard';

// Latin digits grouped with a comma, as the boards write a figure — `formatNumber` would give
// Arabic-Indic in Arabic, and «١٬٢٣٤» beside «1,234.00» reads as two different numbers. The
// design writes a few of its figures in Arabic-Indic («١٠٠٪», «معدل ٦ حركات/يوم»); here they are
// Latin like every other figure on the screen.
export const COUNT = new Intl.NumberFormat('en-US');
export const LITRES = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
/** «معدل 2.4 حركات/يوم» — one decimal at most. */
export const RATE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** The design's `font-cairo`. */
export const CAIRO = BOARD_FONT;

/** The card's surface without its resting shadow on the dark theme — `CARD_SURFACE` adds it. */
const CARD_BASE = cn(
  'border transition-[border-color,box-shadow]',
  // `.light-card`
  'bg-white shadow-[0_1px_3px_0_rgba(0,0,0,.05),0_1px_2px_-1px_rgba(0,0,0,.05)] hover:shadow-[0_4px_12px_-2px_rgba(15,23,42,.08),0_2px_6px_-2px_rgba(15,23,42,.04)]',
  // `.obsidian-card` — its gradient over no colour at all, so the white never shows through it.
  'dark:bg-transparent dark:bg-[linear-gradient(180deg,rgba(19,26,43,.82)_0%,rgba(13,18,30,.92)_100%)] dark:backdrop-blur-[12px] dark:hover:shadow-[0_12px_30px_-4px_rgba(0,0,0,.6),0_0_20px_-2px_rgba(16,185,129,.08)]',
);
/** The card itself, without its border colour — a card with an edge of its own adds that. */
export const CARD_SURFACE = cn(
  CARD_BASE,
  'dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,.5),inset_0_1px_0_0_rgba(255,255,255,.04)]',
);
/** Its border, and the border on hover — `#e2e8f0` / `#cbd5e1` light, the design's slate-blue dark. */
export const CARD_BORDER =
  'border-[#e2e8f0] hover:border-[#cbd5e1] dark:border-[rgba(42,58,84,.65)] dark:hover:border-[rgba(59,130,246,.45)]';
export const CARD = cn(CARD_SURFACE, CARD_BORDER);
/**
 * The two table cards («ملخص لكل سيارة», «سجل كل الحركات») — the design's `obsidian-card …
 * shadow-2xl`: the deeper shadow INSTEAD of the card's own, not after it. The classes do not merge
 * (`cn` only joins), and Tailwind writes an arbitrary shadow after `shadow-2xl`, so a card that
 * carried both would keep the shallow one.
 */
export const TABLE_CARD = cn(CARD_BASE, CARD_BORDER, 'rounded-2xl dark:shadow-2xl');

/** A card's title: Cairo, bold, white on the dark card. */
export const TITLE = cn('text-base font-bold text-slate-900 dark:text-white', CAIRO);
/** The line under a title. */
export const NOTE = 'text-xs text-slate-500 dark:text-slate-400';
/** The small chip beside a title — «10 سيارات», «أعلى 7». */
export const TITLE_CHIP =
  'shrink-0 whitespace-nowrap rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:border-emerald-900/40 dark:bg-[#162135] dark:font-normal dark:text-emerald-300';
/** The strip over a table card — «ملخص لكل سيارة», «سجل كل الحركات». */
export const STRIP =
  'flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 p-4 dark:border-[#1c293f] dark:bg-[#0a101b]';
/** The design's thin scrollbars, on the dark theme where the browser's would glare. */
export const SCROLLBAR =
  'dark:[&::-webkit-scrollbar]:h-1.5 dark:[&::-webkit-scrollbar]:w-1.5 dark:[&::-webkit-scrollbar-track]:bg-[#090d16] dark:[&::-webkit-scrollbar-thumb]:rounded dark:[&::-webkit-scrollbar-thumb]:bg-[#1e293b] dark:[&::-webkit-scrollbar-thumb:hover]:bg-[#334155]';

/**
 * «شل أوت / وطنية» — the design's two companies: Chill Out amber, Wataniya emerald. The design
 * writes «شيل أوت»; the screen keeps the fuel cards' own word for it, «شل أوت», so one company
 * never has two names in one system. Chill Out first, as the design lays them out.
 */
export const COMPANY_ORDER: readonly FleetFuelCardCompany[] = ['chillout', 'wataniya'];
export const COMPANY: Record<
  FleetFuelCardCompany,
  {
    box: string;
    title: string;
    dot: string;
    badge: string;
    line: string;
    /**
     * «تفصيل استهلاك الوقود» split by company — the company's own box over its fuel types, as the
     * design drew a company («وطنية (سولار / 92)»): white with the company's 300 edge and the light
     * map's `shadow-xs` (Tailwind 3's `shadow-sm`), `#0e1626` with its 500/30 edge on the dark.
     */
    head: string;
    heading: string;
    pct: string;
    bar: string;
  }
> = {
  chillout: {
    box: 'border-amber-200 bg-amber-50/70 dark:border-amber-500/20 dark:bg-[#090e18]',
    title: 'text-amber-900 dark:text-amber-300',
    dot: 'bg-amber-500 dark:bg-amber-400',
    badge:
      'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
    line: 'text-amber-800 dark:text-amber-300',
    head: 'border-amber-300 bg-white shadow-sm dark:border-amber-500/30 dark:bg-[#0e1626] dark:shadow-none',
    heading: 'text-amber-900 dark:text-amber-300',
    pct: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300',
    bar: 'bg-amber-500 dark:bg-amber-400',
  },
  wataniya: {
    box: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/20 dark:bg-[#090e18]',
    title: 'text-emerald-900 dark:text-emerald-300',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
    badge:
      'border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
    line: 'text-emerald-800 dark:text-emerald-400',
    head: 'border-emerald-300 bg-white shadow-sm dark:border-emerald-500/30 dark:bg-[#0e1626] dark:shadow-none',
    heading: 'text-emerald-800 dark:text-emerald-300',
    pct: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
    bar: 'bg-emerald-600 dark:bg-emerald-400',
  },
};

/**
 * Where a layer over the dashboard is drawn — the dashboard's own dialog, so its focus trap counts
 * the layer as inside it and its scroll lock already holds. `null` outside the dashboard: the
 * layer goes to `document.body`.
 */
export const CustodyDashboardLayer = createContext<HTMLElement | null>(null);

/** The board's filters, as `CustodyPage` builds them — the dashboard asks the same question. */
export interface CustodyDashboardFilters {
  from?: string | undefined;
  to?: string | undefined;
  vehicleCodes?: readonly string[] | undefined;
  source?: readonly string[] | undefined;
  driver?: string | undefined;
}

/** Is any of the board's filters set? */
export const custodyFiltered = (filters: CustodyDashboardFilters): boolean =>
  [filters.from, filters.to, filters.driver].some((value) => value !== undefined && value !== '') ||
  (filters.vehicleCodes ?? []).length > 0 ||
  (filters.source ?? []).length > 0;

/** The filters the dashboard was opened over, written as words — read only, as chips. */
export const custodyFilterChips = (
  filters: CustodyDashboardFilters,
  t: (key: string, params?: Record<string, string | number>) => string,
  locale: Locale,
): string[] => {
  const join = (parts: readonly string[]): string => parts.join(locale === 'ar' ? '، ' : ', ');
  const chips: string[] = [];
  if (filters.from !== undefined && filters.from !== '') {
    chips.push(t('fleet.custody.dashboard.filters.from', { date: ymd(filters.from) }));
  }
  if (filters.to !== undefined && filters.to !== '') {
    chips.push(t('fleet.custody.dashboard.filters.to', { date: ymd(filters.to) }));
  }
  const codes = filters.vehicleCodes ?? [];
  if (codes.length > 0) {
    chips.push(
      codes.length <= 6
        ? t('fleet.custody.dashboard.filters.cars', { codes: join(codes) })
        : t('fleet.custody.dashboard.filters.carCount', { count: COUNT.format(codes.length) }),
    );
  }
  const kinds = filters.source ?? [];
  if (kinds.length > 0) {
    chips.push(
      t('fleet.custody.dashboard.filters.kinds', {
        kinds: join(kinds.map((kind) => t(`fleet.custody.source.${kind}`))),
      }),
    );
  }
  if (filters.driver !== undefined && filters.driver !== '') {
    chips.push(t('fleet.custody.dashboard.filters.driver', { name: filters.driver }));
  }
  return chips.length === 0 ? [t('fleet.custody.dashboard.filters.none')] : chips;
};

/**
 * Where the focus goes so it never leaves the modal (the dashboard, or a car's log over it) —
 * `null` lets Tab move it as usual. On the first stop Shift+Tab rounds to the last, on the last
 * Tab rounds to the first; and focus that reached the page behind anyway (a click on plain text
 * sets Tab's starting point there, past the last stop or before the first) comes back in at the
 * end Tab was heading for.
 */
export const custodyTrapFocus = <T,>(move: {
  back: boolean;
  active: T | null;
  first: T;
  last: T;
  inside: boolean;
}): T | null => {
  if (!move.inside) return move.back ? move.last : move.first;
  if (move.back && move.active === move.first) return move.last;
  if (!move.back && move.active === move.last) return move.first;
  return null;
};

/** «2026/10» or «2026/10/04» — the board's own year-first writing of a period. */
export const custodyPeriod = (key: string): string => key.replace(/-/gu, '/');

/**
 * The value axis of «المصروف عبر الزمن»: round steps (1, 2, 2.5 or 5 of a power of ten), four or
 * so of them, the top one at or over the dearest bar.
 */
export const custodyTicks = (max: number): number[] => {
  if (max <= 0) return [0];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((nice) => nice * power).find((nice) => nice >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let at = 0; at < max + step; at += step) {
    ticks.push(Math.round(at * 100) / 100);
    if (at >= max) break;
  }
  return ticks;
};

/**
 * «8.7%» — «ملخص لكل سيارة» writes its shares with ONE decimal, as the design does; the same two
 * ends as `custodyShare`, so a sliver is never «0.0%» and all-but-all never «100.0%».
 */
export const custodyShare1 = (part: number, whole: number): string => {
  if (whole <= 0) return '—';
  const pct = (part / whole) * 100;
  if (part > 0 && pct < 0.1) return '<0.1%';
  if (part < whole && pct > 99.9) return '>99.9%';
  return `${pct.toFixed(1)}%`;
};

const DAY_MS = 86_400_000;

/** Whole days from a UTC day (`YYYY-MM-DD…`) to today's — 0 on the day itself, never below. */
export const custodyDaysSince = (iso: string, now: number = Date.now()): number => {
  const start = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor(now / DAY_MS) - Math.floor(start / DAY_MS));
};

/**
 * Which form a counted noun takes. Arabic writes «1 حركة», «9 حركات», «15 حركة» (and «0 إيصالات»)
 * — the plural from 2 to 10 and for none, the singular otherwise; English the plural but for one.
 */
export type CustodyCountForm = 'one' | 'few' | 'other';
export const custodyCountForm = (locale: Locale, n: number): CustodyCountForm => {
  if (n === 1) return 'one';
  if (locale !== 'ar') return 'other';
  const tail = n % 100;
  return n === 0 || (tail >= 2 && tail <= 10) ? 'few' : 'other';
};

export type CustodyNoun = 'movement' | 'day' | 'car' | 'privateBill';

/** «9 حركات», «14 سيارة» — a count and its noun; `noun` alone gives the noun for a split figure. */
export const useCount = (): {
  count: (noun: CustodyNoun, n: number) => string;
  noun: (noun: CustodyNoun, n: number) => string;
  phrase: (key: string, n: number) => string;
} => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const noun = (word: CustodyNoun, n: number): string =>
    t(`fleet.custody.dashboard.noun.${word}.${custodyCountForm(locale, n)}`);
  return {
    noun,
    count: (word, n) => `${COUNT.format(n)} ${noun(word, n)}`,
    phrase: (key, n) => t(`${key}.${custodyCountForm(locale, n)}`, { count: COUNT.format(n) }),
  };
};

/** «1,037.10» and «ج.م.» apart, as the board writes money. */
export const useMoney = (): ((value: number) => { figure: string; currency: string }) => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (value) => formatMoneyParts(value, 'EGP', locale);
};

/** The same, as words — for a label read aloud or a tooltip. */
export const useMoneyText = (): ((value: number) => string) => {
  const money = useMoney();
  return (value) => {
    const { figure, currency } = money(value);
    return `${figure} ${currency}`;
  };
};

/** The list separator a label read aloud uses — «، » in Arabic. */
export const useSeparator = (): string =>
  useAppSelector((state): Locale => state.locale.locale) === 'ar' ? '، ' : ', ';

/**
 * The concentric donut's arcs: each part's length along a ring of `circumference`, a small gap
 * between parts (the design's 4 on the outer ring) and its start as a dash offset. Parts of
 * nothing draw nothing; a single part closes the whole ring.
 */
export const custodyArcs = (
  values: readonly number[],
  circumference: number,
  gap: number,
): { length: number; offset: number; value: number }[] => {
  const whole = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const drawn = values.filter((value) => value > 0).length;
  let at = 0;
  return values.map((value) => {
    const span = whole <= 0 || value <= 0 ? 0 : (value / whole) * circumference;
    const arc = {
      length: Math.max(0, Math.round((span - (drawn > 1 ? gap : 0)) * 100) / 100),
      offset: -Math.round(at * 100) / 100,
      value,
    };
    at += span;
    return arc;
  });
};

/** A card's head: the title (Cairo), the line under it, and whatever sits at its end. */
export const CardHead = ({
  id,
  title,
  note,
  end,
  className,
  level = 3,
}: {
  id?: string;
  title: ReactNode;
  note?: ReactNode;
  end?: ReactNode;
  className?: string;
  level?: 2 | 3;
}): JSX.Element => {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cn('mb-3 flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading id={id} className={cn(TITLE, 'flex items-center gap-2')}>
          {title}
        </Heading>
        {note !== undefined && <p className={NOTE}>{note}</p>}
      </div>
      {end}
    </div>
  );
};
