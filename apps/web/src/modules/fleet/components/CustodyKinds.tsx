// «عاوز اغير لون النوع بين كاوتش وبنزين وغسيل» — one colour per kind of custody spend, written ONCE
// and worn wherever the kinds are drawn: the badge in «كل الحركات», the figure's tile, every mark,
// swatch and legend of «لوحة تحكم».
//
// «عاوز دى تكون فى شاشه العهد لما ادوس على لوحة التحكم فى اللايت سيم والدارك سيم»: the owner sent
// the dashboard's design and chose its colours for the WHOLE custody screen — التوكيل blue, وقود
// amber, كاوتش rose, غسيل cyan, the total emerald. That overrides, on this screen only, the house
// rule that kept amber and red for states and purple for what is pressed; the other Fleet boards
// keep it. The shades are the design's: the dark theme draws a kind at 500 (its words at 300/400 on
// a 500/15 tile), the light theme at the 600 (blue, cyan) or 500 (amber, rose) the light map gives,
// its words at 700–900 on a 50 tile. The kind's NAME still rides beside its colour — badge text,
// an icon on the tile, a legend on every chart — so the colour is never the only way to tell them.
//
// Every class is written out whole, `dark:` variant included, so Tailwind sees each one. An accent
// edge names its dark shade and its hover too: a card's own border colour (`CARD_BORDER`) would
// otherwise paint over the left edge in the dark theme and on hover.
import { FLEET_CUSTODY_SOURCES, type FleetCustodySource } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';

export interface CustodyKindLook {
  /** The solid fill: a chart's bar, a legend's swatch, a ranked car's segment. */
  fill: string;
  /** A period with none of the kind: the 2px stub the time chart draws in its place. */
  stub: string;
  /** The kind's words on a card — a table cell, a share, a ranked line (light 700, dark 400). */
  text: string;
  /** The same, a step deeper where the light map asks for it (the donut's legend). */
  deep: string;
  /** The time chart's readout (light 700, dark 300). */
  soft: string;
  /** The label over a figure (light 900 bold, dark 300). */
  label: string;
  /** The icon's box on a figure card. */
  tile: string;
  /** The card's coloured edge — the design's `border-l-4`. */
  accent: string;
  /** The count chip at the foot of a figure card. */
  chip: string;
  /** The pale badge of «كل الحركات» and «سجل كل الحركات», and the dot inside it. */
  badge: string;
  dot: string;
  /** The donut's stroke, the light theme's hex and the dark one's. */
  stroke: string;
  icon: readonly string[];
}

/** «M8 7h12…» — two arrows, the design's dealership icon. */
const ARROWS = ['M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4'];
/** The design's bolt for fuel. */
export const BOLT = ['M13 10V3L4 14h7v7l9-11h-7z'];
/** A tyre: the rubber and the rim. */
const TYRE = ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M12 15a3 3 0 100-6 3 3 0 000 6z'];
/** The design's flask — washing on its card, the litres on theirs. */
export const FLASK = [
  'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
];

export const CUSTODY_KIND: Record<FleetCustodySource, CustodyKindLook> = {
  dealership: {
    fill: 'bg-blue-600 dark:bg-blue-500',
    stub: 'bg-blue-200 dark:bg-blue-500/30',
    text: 'text-blue-700 dark:text-blue-400',
    deep: 'text-blue-700 dark:text-blue-400',
    soft: 'text-blue-700 dark:text-blue-300',
    label: 'font-bold text-blue-900 dark:font-semibold dark:text-blue-300',
    tile: 'border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400 dark:shadow-[0_0_12px_rgba(59,130,246,0.2)]',
    accent:
      'border-l-4 border-l-blue-600 hover:border-l-blue-600 dark:border-l-blue-500 dark:hover:border-l-blue-500',
    chip: 'rounded bg-blue-50 px-1.5 text-[11px] font-bold text-blue-700 dark:bg-transparent dark:px-0 dark:text-xs dark:font-medium dark:text-blue-400',
    badge:
      'border border-blue-300 bg-blue-50 font-bold text-blue-800 dark:border-blue-500/25 dark:bg-blue-500/10 dark:font-semibold dark:text-blue-400',
    dot: 'bg-blue-600 dark:bg-blue-400',
    stroke: 'stroke-[#2563eb] dark:stroke-[#3b82f6]',
    icon: ARROWS,
  },
  fuel: {
    fill: 'bg-amber-500',
    stub: 'bg-amber-200 dark:bg-amber-500/30',
    text: 'text-amber-700 dark:text-amber-400',
    deep: 'text-amber-800 dark:text-amber-400',
    soft: 'text-amber-700 dark:text-amber-300',
    label: 'font-bold text-amber-900 dark:font-semibold dark:text-amber-300',
    tile: 'border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400 dark:shadow-[0_0_12px_rgba(245,158,11,0.2)]',
    accent:
      'border-l-4 border-l-amber-500 hover:border-l-amber-500 dark:border-l-amber-500 dark:hover:border-l-amber-500',
    chip: 'rounded bg-amber-50 px-1.5 text-[11px] font-bold text-amber-700 dark:bg-transparent dark:px-0 dark:text-xs dark:font-medium dark:text-amber-400',
    badge:
      'border border-amber-300 bg-amber-50 font-bold text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:font-semibold dark:text-amber-400',
    dot: 'bg-amber-500 dark:bg-amber-400',
    stroke: 'stroke-[#f59e0b]',
    icon: BOLT,
  },
  tyres: {
    fill: 'bg-rose-500',
    stub: 'bg-rose-200 dark:bg-rose-500/30',
    text: 'text-rose-700 dark:text-rose-400',
    deep: 'text-rose-700 dark:text-rose-400',
    soft: 'text-rose-700 dark:text-rose-300',
    label: 'font-bold text-rose-900 dark:font-semibold dark:text-rose-300',
    tile: 'border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-400 dark:shadow-[0_0_12px_rgba(244,63,94,0.2)]',
    accent:
      'border-l-4 border-l-rose-500 hover:border-l-rose-500 dark:border-l-rose-500 dark:hover:border-l-rose-500',
    chip: 'rounded bg-rose-50 px-1.5 text-[11px] font-bold text-rose-700 dark:bg-transparent dark:px-0 dark:text-xs dark:font-medium dark:text-rose-400',
    badge:
      'border border-rose-300 bg-rose-50 font-bold text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:font-semibold dark:text-rose-400',
    dot: 'bg-rose-500 dark:bg-rose-400',
    stroke: 'stroke-[#e11d48] dark:stroke-[#f43f5e]',
    icon: TYRE,
  },
  wash: {
    fill: 'bg-cyan-600 dark:bg-cyan-500',
    stub: 'bg-cyan-200 dark:bg-cyan-500/30',
    text: 'text-cyan-700 dark:text-cyan-400',
    deep: 'text-cyan-800 dark:text-cyan-400',
    soft: 'text-cyan-700 dark:text-cyan-300',
    label: 'font-bold text-cyan-900 dark:font-semibold dark:text-cyan-300',
    tile: 'border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-400 dark:shadow-[0_0_12px_rgba(6,182,212,0.2)]',
    accent:
      'border-l-4 border-l-cyan-600 hover:border-l-cyan-600 dark:border-l-cyan-500 dark:hover:border-l-cyan-500',
    chip: 'rounded bg-cyan-50 px-1.5 text-[11px] font-bold text-cyan-800 dark:bg-transparent dark:px-0 dark:text-xs dark:font-medium dark:text-cyan-400',
    badge:
      'border border-cyan-300 bg-cyan-50 font-bold text-cyan-800 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:font-semibold dark:text-cyan-400',
    dot: 'bg-cyan-600 dark:bg-cyan-400',
    stroke: 'stroke-[#0891b2] dark:stroke-[#06b6d4]',
    icon: FLASK,
  },
};

/** The kinds in the filter's and the figures' order — the order every chart draws them in. */
export const CUSTODY_KINDS = FLEET_CUSTODY_SOURCES;

/** «إجمالي مصروفات العهدة» is every kind at once: it wears the design's emerald, none of theirs. */
export const CUSTODY_TOTAL_TILE =
  'border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:shadow-[0_0_15px_-2px_rgba(16,185,129,0.35)]';
/** The total's edge on the board's figures, as each kind has its own. */
export const CUSTODY_TOTAL_ACCENT =
  'border-l-4 border-l-emerald-500 hover:border-l-emerald-500 dark:border-l-emerald-500 dark:hover:border-l-emerald-500';

/**
 * The kind in «كل الحركات» — the alarms board's `lg` pill (`Badge`'s own size), in the design's
 * pale badge with its dot. Not `Badge` with a class handed in: `cn` only joins, so a tone's own
 * colours would fight the kind's.
 */
export const CustodyKindBadge = ({ kind }: { kind: FleetCustodySource }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-custody-kind={kind}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[15px] leading-5',
        CUSTODY_KIND[kind].badge,
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', CUSTODY_KIND[kind].dot)} />
      {t(`fleet.custody.source.${kind}`)}
    </span>
  );
};

/** The legend's key — a small square in the kind's fill; the name beside it stays in text ink. */
export const CustodyKindSwatch = ({
  kind,
  className,
}: {
  kind: FleetCustodySource;
  className?: string;
}): JSX.Element => (
  <span
    aria-hidden="true"
    data-custody-swatch={kind}
    className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded', CUSTODY_KIND[kind].fill, className)}
  />
);
