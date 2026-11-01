// «لوحة تحكم الحركة» — the shared look of every tab (the owner-approved v2 sample in the system's own
// colours, scratchpad fleetdash/v2/system-palette.md). Every tab draws with these pieces ONLY, so the
// ten tabs read as one screen: a tab that needs another shape adds a local helper in its own file,
// drawn from these tokens.
//
// THE SYSTEM'S PALETTE, in short:
//   card      the custody dashboard's CARD (white / navy glass, #e2e8f0 / slate-blue hairline)
//   accent    the KPI tiles' 4-px coloured EDGE (`border-l-4`), not a strip on the top
//   title     TITLE — Cairo, bold; the section dot emerald
//   figures   Cairo black for a card's big figure, Azeret Mono (`NUM`) for every other figure
//   hues      emerald ok · amber warn · red danger · sky info · slate neutral · brand (indigo) action;
//             blue / teal / violet / rose as the custody kinds and operations draw them
//   buttons   brand filled · brand tint · slate secondary — no black and no bright-blue button
//   links     the dashboard's emerald «عرض … ←»
//
// A FIGURE IS A LINK. Every figure that opens the screen behind it is a real `<Link>` carrying
// `data-metric="<section>.<field>"`, built by `lib/fleet-dashboard-links.ts` and nothing else. A
// figure the builder gives no link (a named exception, unified.md §8.2) is plain text.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { type DashLink } from '../../lib/fleet-dashboard-links';
import { BoardIcon, NUM, PATH } from '../FuelCardBoard';
import { CAIRO, CARD, COMPANY, NOTE, TITLE, TITLE_CHIP } from '../custody-dashboard-parts';

export { cn, NUM, CAIRO, CARD, COMPANY, NOTE, TITLE, TITLE_CHIP };

// ── Icons (24-grid stroke paths) ──────────────────────────────────────────────────────────────

export const I = {
  truck: PATH.truck,
  warn: PATH.warn,
  calendar: PATH.calendar,
  card: PATH.card,
  trend: PATH.trend,
  check: ['M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'],
  cog: [
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  wrench: [
    'M11.42 15.17l-5.1 5.1a2.12 2.12 0 01-3-3l5.1-5.1m3 3a6 6 0 007.6-7.6l-3.18 3.18-2.83-.71-.71-2.83 3.18-3.18a6 6 0 00-7.6 7.6m3 3l-3-3',
  ],
  userX: ['M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6'],
  user: ['M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'],
  users: [
    'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  ],
  calendarX: [
    'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    'M10 14l4 4m0-4l-4 4',
  ],
  clock: ['M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z'],
  refresh: [
    'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  ],
  cash: [
    'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  ],
  pin: [
    'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
    'M15 11a3 3 0 11-6 0 3 3 0 016 0z',
  ],
  bell: [
    'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  ],
  filter: [
    'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z',
  ],
  chevron: ['M19 9l-7 7-7-7'],
  building: [
    'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  ],
  briefcase: [
    'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  ],
  receipt: [
    'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z',
  ],
  clipboard: [
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
  ],
  clipboardCheck: [
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  ],
  arrow: ['M10 19l-7-7m0 0l7-7m-7 7h18'],
  wallet: [
    'M19 7V4a1 1 0 00-1-1H5a2 2 0 000 4h15a1 1 0 011 1v4h-3a2 2 0 000 4h3a1 1 0 001-1v-2a1 1 0 00-1-1',
    'M3 5v14a2 2 0 002 2h15a1 1 0 001-1v-4',
  ],
  fuel: [
    'M3 22V5a2 2 0 012-2h7a2 2 0 012 2v17M3 22h11M6 8h5M14 11h2a2 2 0 012 2v4a1.5 1.5 0 003 0V9.5L18 6',
  ],
  doc: [
    'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  ],
  shield: [
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  ],
  tick: ['M5 13l4 4L19 7'],
  grid: [
    'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z',
  ],
  bars: [
    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  ],
  rank: ['M4 6h16M4 12h11M4 18h6'],
  scale: ['M12 3v18M5 21h14M7 7h10M7 7l-3 7a3 3 0 006 0L7 7zm10 0l-3 7a3 3 0 006 0l-3-7'],
  bolt: ['M13 10V3L4 14h7v7l9-11h-7z'],
  eye: [
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  ],
  link: [
    'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  ],
  map: [
    'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  ],
  paperclip: [
    'M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13',
  ],
  gauge: ['M12 14l3-3m-3 3a2 2 0 100-4 2 2 0 000 4zM3.34 17a10 10 0 1117.32 0'],
  info: ['M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'],
  layers: ['M12 3l9 5-9 5-9-5 9-5zm-9 9l9 5 9-5m-18 4l9 5 9-5'],
} as const;
export type IconPath = readonly string[];

export const Icon = ({ d, className = 'h-4 w-4' }: { d: IconPath; className?: string }): JSX.Element => (
  <BoardIcon d={d} className={className} />
);

// ── Words and numbers ─────────────────────────────────────────────────────────────────────────

/** A number, laid out left to right in the app's figure font (Azeret Mono, tabular). */
export const N = ({ children, className }: { children: ReactNode; className?: string }): JSX.Element => (
  <span dir="ltr" className={cn(NUM, className)}>
    {children}
  </span>
);

/** A figure that opens the screen behind it (dotted underline, as in the approved samples). */
export const LINKED =
  'cursor-pointer underline decoration-dotted decoration-[1.5px] underline-offset-[5px] decoration-slate-400 hover:decoration-solid dark:decoration-slate-500';
/** LINKED inside a small chip: the dotted line stays inside the chip's border. */
export const LINKED_TIGHT =
  'cursor-pointer underline decoration-dotted decoration-[1.5px] underline-offset-[3px] decoration-slate-400 hover:decoration-solid dark:decoration-slate-500';
export const RED = 'text-red-600 dark:text-red-400';
export const AMBER = 'text-amber-700 dark:text-amber-400';
export const MUTED = 'text-slate-500 dark:text-slate-400';
export const STRONG = 'text-slate-900 dark:text-white';
/** «ج.م.» beside a figure — the dashboard tiles' currency. */
export const UNIT = 'text-xs font-semibold text-slate-500 dark:font-medium dark:text-slate-400';
/** The big figure of a card (Cairo, black, tight), at the v2 size. */
export const BIG = cn('text-[34px] font-black leading-none tracking-tight text-slate-900 dark:text-white', CAIRO);
/** A share («33%») as the fund card writes it: a small slate box, the figure face, bold. */
export const PCT = cn(
  'whitespace-nowrap rounded-md bg-slate-100 px-1.5 py-px text-[11px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  NUM,
);
/** The keyboard ring of everything that opens a list or a record. */
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';

// ── Tones (one family per meaning) ────────────────────────────────────────────────────────────
//
// `tile` the icon's box, `soft` the bordered chip / tinted box, `text` its words, `bar` / `top` its
// fill, `dot` its dot, `accent` the card's coloured edge. There is no orange in the system: `orange`
// draws the warning amber.

const AMBER_TONE = {
  top: 'bg-amber-500 dark:bg-amber-400',
  tile: 'border border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400',
  soft: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  text: 'text-amber-700 dark:text-amber-400',
  bar: 'bg-amber-500 dark:bg-amber-400',
  dot: 'bg-amber-500 dark:bg-amber-400',
  accent: 'border-l-4 border-l-amber-500 hover:border-l-amber-500 dark:border-l-amber-500 dark:hover:border-l-amber-500',
} as const;

export const TONE = {
  emerald: {
    top: 'bg-emerald-500 dark:bg-emerald-400',
    tile: 'border border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400',
    soft: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    text: 'text-emerald-700 dark:text-emerald-400',
    bar: 'bg-emerald-500 dark:bg-emerald-400',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
    accent: 'border-l-4 border-l-emerald-500 hover:border-l-emerald-500 dark:border-l-emerald-500 dark:hover:border-l-emerald-500',
  },
  blue: {
    top: 'bg-blue-600 dark:bg-blue-500',
    tile: 'border border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400',
    soft: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400',
    text: 'text-blue-700 dark:text-blue-400',
    bar: 'bg-blue-600 dark:bg-blue-500',
    dot: 'bg-blue-600 dark:bg-blue-400',
    accent: 'border-l-4 border-l-blue-600 hover:border-l-blue-600 dark:border-l-blue-500 dark:hover:border-l-blue-500',
  },
  amber: AMBER_TONE,
  orange: AMBER_TONE,
  red: {
    top: 'bg-red-600 dark:bg-red-500',
    tile: 'border border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-400',
    soft: 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
    text: 'text-red-600 dark:text-red-400',
    bar: 'bg-red-600 dark:bg-red-500',
    dot: 'bg-red-500 dark:bg-red-400',
    accent: 'border-l-4 border-l-red-500 hover:border-l-red-500 dark:border-l-red-500 dark:hover:border-l-red-500',
  },
  teal: {
    top: 'bg-teal-500 dark:bg-teal-400',
    tile: 'border border-teal-200 bg-teal-50 text-teal-600 dark:border-teal-500/30 dark:bg-teal-500/15 dark:text-teal-400',
    soft: 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300',
    text: 'text-teal-700 dark:text-teal-400',
    bar: 'bg-teal-500 dark:bg-teal-400',
    dot: 'bg-teal-500 dark:bg-teal-400',
    accent: 'border-l-4 border-l-teal-500 hover:border-l-teal-500 dark:border-l-teal-500 dark:hover:border-l-teal-500',
  },
  violet: {
    top: 'bg-violet-500 dark:bg-violet-400',
    tile: 'border border-violet-200 bg-violet-50 text-violet-600 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-400',
    soft: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
    text: 'text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500 dark:bg-violet-400',
    dot: 'bg-violet-500 dark:bg-violet-400',
    accent: 'border-l-4 border-l-violet-500 hover:border-l-violet-500 dark:border-l-violet-500 dark:hover:border-l-violet-500',
  },
  slate: {
    top: 'bg-slate-600 dark:bg-slate-400',
    tile: 'border border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-400/30 dark:bg-slate-400/15 dark:text-slate-300',
    soft: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700/70 dark:bg-[#142135] dark:text-slate-300',
    text: 'text-slate-700 dark:text-slate-300',
    bar: 'bg-slate-600 dark:bg-slate-400',
    dot: 'bg-slate-400 dark:bg-slate-500',
    accent: 'border-l-4 border-l-slate-600 hover:border-l-slate-600 dark:border-l-slate-400 dark:hover:border-l-slate-400',
  },
  sky: {
    top: 'bg-sky-500 dark:bg-sky-400',
    tile: 'border border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-400',
    soft: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
    text: 'text-sky-700 dark:text-sky-400',
    bar: 'bg-sky-500 dark:bg-sky-400',
    dot: 'bg-sky-500 dark:bg-sky-400',
    accent: 'border-l-4 border-l-sky-500 hover:border-l-sky-500 dark:border-l-sky-500 dark:hover:border-l-sky-500',
  },
  rose: {
    top: 'bg-rose-500 dark:bg-rose-400',
    tile: 'border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-400',
    soft: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400',
    text: 'text-rose-700 dark:text-rose-400',
    bar: 'bg-rose-500 dark:bg-rose-400',
    dot: 'bg-rose-500 dark:bg-rose-400',
    accent: 'border-l-4 border-l-rose-500 hover:border-l-rose-500 dark:border-l-rose-500 dark:hover:border-l-rose-500',
  },
  brand: {
    top: 'bg-brand-600 dark:bg-brand-500',
    tile: 'border border-brand-200 bg-brand-50 text-brand-600 dark:border-brand-500/30 dark:bg-brand-500/15 dark:text-brand-300',
    soft: 'border-brand-500/50 bg-brand-500/15 text-brand-700 dark:text-brand-200',
    text: 'text-brand-700 dark:text-brand-300',
    bar: 'bg-brand-600 dark:bg-brand-500',
    dot: 'bg-brand-500 dark:bg-brand-400',
    accent: 'border-l-4 border-l-brand-600 hover:border-l-brand-600 dark:border-l-brand-500 dark:hover:border-l-brand-500',
  },
} as const;
export type Tone = keyof typeof TONE;

// ── Surfaces ──────────────────────────────────────────────────────────────────────────────────

export const SURFACE = cn(CARD, 'rounded-2xl');
export const WELL =
  'rounded-xl border border-slate-200 bg-slate-50/60 dark:border-[#1e2a3f] dark:bg-[#0a101b]/70';
export const BAND = 'border-t border-slate-200 bg-slate-50/80 dark:border-[#1c293f] dark:bg-[#0a101b]';
export const BOX = 'rounded-xl border border-slate-200 bg-white dark:border-[#1e2a3f] dark:bg-[#0a101b]/70';
/** A BOX that opens a list, under the pointer: the card's own hover edge. */
export const BOX_HOVER = 'transition-colors hover:border-[#cbd5e1] dark:hover:border-[rgba(59,130,246,.45)]';
export const RULE = 'border-slate-100 dark:border-[#1c273b]';
export const DIVIDE = 'divide-y divide-slate-100 dark:divide-[#1a2538]';
export const ROW_HOVER = 'transition hover:bg-white dark:hover:bg-slate-800/40';
export const TH_ROW = 'bg-slate-100 dark:bg-[#0c121e]';
export const TH = 'text-[13px] font-bold text-slate-500 dark:text-slate-400';

/** A card; `accent` draws the system's 4-px coloured EDGE (the KPI tiles' `border-l-4`). */
export const Card = ({
  accent,
  className,
  children,
  ...rest
}: {
  accent?: Tone | undefined;
  className?: string | undefined;
  children: ReactNode;
  [data: `data-${string}`]: string | undefined;
}): JSX.Element => (
  <div
    {...rest}
    className={cn(
      SURFACE,
      'relative flex min-w-0 flex-col overflow-hidden',
      accent !== undefined && TONE[accent].accent,
      className,
    )}
  >
    {children}
  </div>
);

/** A card's heading: the section dot, the title (TITLE), an optional line under it, an end piece. */
export const CardHead = ({
  title,
  sub,
  dot = 'emerald',
  end,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  dot?: Tone | null;
  end?: ReactNode;
  className?: string;
}): JSX.Element => (
  <div className={cn('flex items-start justify-between gap-3', className)}>
    <div className="min-w-0">
      <h3 className={cn(TITLE, 'flex flex-wrap items-center gap-2')}>
        {dot !== null && (
          <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE[dot].dot)} />
        )}
        {title}
      </h3>
      {sub !== undefined && <p className={cn('mt-0.5', NOTE)}>{sub}</p>}
    </div>
    {end !== undefined && <div className="flex shrink-0 flex-wrap items-center gap-2">{end}</div>}
  </div>
);

/** The square icon tile at a card's corner. */
export const IconTile = ({
  d,
  tone,
  size = 'md',
}: {
  d: IconPath;
  tone: Tone;
  size?: 'sm' | 'md' | 'lg';
}): JSX.Element => (
  <span
    aria-hidden="true"
    className={cn(
      'grid shrink-0 place-items-center rounded-xl border',
      TONE[tone].tile,
      size === 'sm' ? 'h-8 w-8 rounded-lg' : size === 'md' ? 'h-11 w-11' : 'h-14 w-14 rounded-2xl',
    )}
  >
    <Icon d={d} className={size === 'sm' ? 'h-4 w-4' : size === 'md' ? 'h-5 w-5' : 'h-6 w-6'} />
  </span>
);

// ── The tab's own heading row ─────────────────────────────────────────────────────────────────

/** The scope chip of a section heading — slate, round. */
export const CHIP =
  'whitespace-nowrap rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:border-[#223048] dark:bg-[#0a0e17] dark:font-medium dark:text-slate-300';
export const HEAD_CHIP = TITLE_CHIP;

/** «لقطة الآن، ولا تتأثر بالفلاتر» — the scope chip with the section's live emerald dot. */
export const LiveChip = (): JSX.Element => {
  const t = useT();
  return (
    <span data-live-chip="true" className={cn(CHIP, 'inline-flex items-center gap-1.5 py-1')}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
      </span>
      {t('fleet.dash.common.liveChip')}
    </span>
  );
};

/** A tab's heading: the icon tile, the big title, the live chip (the «الآن» tabs), chips, the tools. */
export const TabHead = ({
  icon,
  tone = 'slate',
  title,
  sub,
  live = true,
  chips,
  end,
}: {
  icon: IconPath;
  tone?: Tone;
  title: string;
  sub?: ReactNode;
  /** The «الآن» tabs wear the live chip; the period tabs carry their range instead. */
  live?: boolean;
  chips?: ReactNode;
  end?: ReactNode;
}): JSX.Element => (
  <div data-tab-head="true" className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="flex min-w-0 items-center gap-3">
      <IconTile d={icon} tone={tone} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className={cn('whitespace-nowrap text-[22px] font-bold text-slate-900 dark:text-white', CAIRO)}>
            {title}
          </h2>
          {live && <LiveChip />}
          {chips}
        </div>
        {sub !== undefined && <p className={cn('mt-0.5 text-[13px]', MUTED)}>{sub}</p>}
      </div>
    </div>
    {end !== undefined && <div className="flex flex-wrap items-center gap-2">{end}</div>}
  </div>
);

// ── Links ─────────────────────────────────────────────────────────────────────────────────────

/** A figure (or any piece) that opens its screen when the builder gave it a link; plain otherwise. */
export const Fig = ({
  link,
  className,
  linkedClassName = LINKED,
  title,
  children,
}: {
  link: DashLink | null;
  className?: string | undefined;
  /** The underline a linked figure wears (LINKED by default; '' for a whole box that is the link). */
  linkedClassName?: string;
  title?: string | undefined;
  children: ReactNode;
}): JSX.Element =>
  link === null ? (
    <span className={className} title={title}>
      {children}
    </span>
  ) : (
    <Link to={link.to} data-metric={link.metric} title={title} className={cn(className, linkedClassName, FOCUS)}>
      {children}
    </Link>
  );

// ── Buttons, chips, tags ──────────────────────────────────────────────────────────────────────

const BTN_BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border text-[13px] font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50';
export const BTN = {
  /** The main step of a card: the site's indigo as a tinted button with its edge. */
  dark: cn(BTN_BASE, 'border-brand-500/50 bg-brand-500/15 px-4 py-2 text-brand-700 hover:bg-brand-500/25 dark:text-brand-200'),
  /** The filled button: the shared Button's `primary`. */
  primary: cn(BTN_BASE, 'border-transparent bg-brand-600 px-4 py-2 text-white shadow-md shadow-brand-700/30 hover:bg-brand-700'),
  /** The outlined button: the shared Button's `secondary`. */
  outline: cn(
    BTN_BASE,
    'border-slate-300 bg-white px-3.5 py-2 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
  ),
  /** The «فتح …» link-button of the alert rows: the brand tint, a step less padding. */
  soft: cn(BTN_BASE, 'border-brand-500/50 bg-brand-500/15 px-3 py-1.5 text-brand-700 hover:bg-brand-500/25 dark:text-brand-200'),
} as const;

/** A button that opens an existing screen (a real link), its icon after the words (the arrow by default). */
export const Btn = ({
  link,
  kind = 'soft',
  icon = I.arrow,
  lead,
  children,
  className,
}: {
  link: DashLink;
  kind?: keyof typeof BTN;
  icon?: IconPath | null;
  /** An icon before the words. */
  lead?: IconPath;
  children: ReactNode;
  className?: string;
}): JSX.Element => (
  <Link to={link.to} data-metric={link.metric} className={cn(BTN[kind], className)}>
    {lead !== undefined && <Icon d={lead} className="h-4 w-4" />}
    {children}
    {icon !== null && <Icon d={icon} className="h-3.5 w-3.5" />}
  </Link>
);

/** A small round tag («صيانة السيارات», «منتهٍ»); tones from TONE. */
export const Tag = ({
  tone = 'slate',
  children,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
}): JSX.Element => (
  <span
    className={cn(
      'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-bold leading-4 dark:font-semibold',
      TONE[tone].soft,
    )}
  >
    {dot === true && <span className={cn('h-1.5 w-1.5 rounded-full', TONE[tone].dot)} />}
    {children}
  </span>
);

/** «الشركة كلها» — a company-wide part while a branch is chosen (fuel, custody, notices, drivers). */
export const CompanyWide = ({ show }: { show: boolean }): JSX.Element | null => {
  const t = useT();
  if (!show) return null;
  return (
    <span data-company-wide="true">
      <Tag tone="sky">{t('fleet.dash.common.companyWide')}</Tag>
    </span>
  );
};

const COUNT_TONE: Partial<Record<Tone, string>> = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  red: 'bg-red-600 text-white ring-1 ring-inset ring-red-700/60 dark:ring-red-400/40',
  amber: 'bg-amber-400 text-amber-950 ring-1 ring-inset ring-amber-500/70 dark:ring-amber-300/50',
  orange: 'bg-amber-400 text-amber-950 ring-1 ring-inset ring-amber-500/70 dark:ring-amber-300/50',
};
/** A round count bubble beside a section title. */
export const Count = ({ n, tone = 'slate' }: { n: ReactNode; tone?: Tone }): JSX.Element => (
  <span
    className={cn(
      'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none',
      NUM,
      COUNT_TONE[tone] ?? cn('border', TONE[tone].soft),
    )}
  >
    {n}
  </span>
);

/** A vehicle's code with the little car glyph — the boards' code chip; a link when given one. */
export const CarChip = ({ code, link = null }: { code: string; link?: DashLink | null }): JSX.Element => (
  <Fig
    link={link}
    linkedClassName=""
    className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-1.5 py-px align-middle text-xs font-bold text-slate-900 shadow-sm transition-colors hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:hover:border-slate-500"
  >
    <Icon d={I.truck} className="h-3 w-3 text-slate-400" />
    <N>{code}</N>
  </Fig>
);

/** A thin progress bar; `parts` share the track (percentages of the whole). */
export const Meter = ({
  parts,
  className,
  height = 'h-2',
}: {
  parts: readonly { pct: number; tone: Tone }[];
  className?: string;
  height?: string;
}): JSX.Element => (
  <div className={cn('flex overflow-hidden rounded-full bg-slate-100 dark:bg-[#162135]', height, className)}>
    {parts.map((part, i) => (
      <div
        key={i}
        className={cn('h-full first:rounded-s-full last:rounded-e-full', TONE[part.tone].bar)}
        style={{ width: `${Math.max(0, Math.min(100, part.pct))}%` }}
      />
    ))}
  </div>
);

/** A footer link of a card («عرض السيارات ←») — the dashboard's emerald link. */
export const FootLink = ({ link, children }: { link: DashLink; children: ReactNode }): JSX.Element => (
  <Link
    to={link.to}
    data-metric={link.metric}
    className={cn(
      'inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-bold text-emerald-700 transition hover:underline dark:font-medium dark:text-emerald-400 dark:hover:text-emerald-300',
      FOCUS,
    )}
  >
    {children}
    <Icon d={I.arrow} className="h-3.5 w-3.5" />
  </Link>
);

/** A segmented switch / filter chips: the custody tabs' tray, the pressed one in the site's indigo. */
export const SEG = {
  tray: 'inline-flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-[rgba(42,58,84,.65)] dark:bg-[#0d1424] dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,.5)]',
  on: 'bg-brand-600 text-white shadow-md shadow-brand-700/30',
  off: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60 dark:hover:text-white',
  countOn: 'bg-white/20 text-white',
  countOff: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
} as const;

/** A section title outside the cards: the emerald dot, the card title, the note at the far end. */
export const SectionHead = ({ title, sub }: { title: string; sub?: string }): JSX.Element => (
  <div className="mb-3 mt-7 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-200 pb-2.5 dark:border-[#1c263b]">
    <h3 className={cn(TITLE, 'flex items-center gap-2')}>
      <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', TONE.emerald.dot)} />
      {title}
    </h3>
    {sub !== undefined && <span className={cn('text-xs font-semibold', MUTED)}>{sub}</span>}
  </div>
);
