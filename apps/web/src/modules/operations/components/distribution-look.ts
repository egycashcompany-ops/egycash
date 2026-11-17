// The colours of «توزيع المحصنات» and «تسليم المحصنات».
//
// Round 26 — «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى عليها والاعداد
// وكدا». Round 26b — the owner on Round 26's screens: «لا استنى الالوان مش عجبانى بتاعت العربيه», then
// «لون واحد لكل العربيات», «عاوز يبقى فى فرق فى الالوان بين الصندوق و الحقائب و الكراتين» and
// «وافصل الاليطار بتاع القائد عن المحصنة وحسن شكل العربيه بالكامل».
//
// Tailwind only emits the classes it can read in the source, so every class is written out whole.
//
//   · THE VAN — ONE calm look for every van card, whichever van it is (`VAN_LOOK`): slate, the
//     blue-grey ink of the boards. Its code in a solid slate pill (white words), a thin slate stripe
//     at the card's start edge, its head on a very light slate band. Slate is chosen because it is
//     the one family on these screens with almost no colour of its own (CIEDE2000 chroma ≈ 14): the
//     van reads as the card's title, and every colour that MEANS something stays free and far from
//     it — the four counts, the captain's emerald, a proposal's amber, a refusal's rose (each 20 or
//     more apart in CIEDE2000, `distribution-colours.spec.ts`). It is the same pill in both themes.
//   · THE COUNTS — each kind its own hue and icon, a FILLED tinted chip (a real ground of its
//     colour, its icon and figure in it), the same on the van card, the van's card, a chip's card and
//     the page's figures (`COUNT_LOOK`): محصنات blue, كراتين orange (the cardboard), حقائب cyan,
//     صناديق fuchsia — four hues 22 or more apart (CIEDE2000, solid) and 12 or more apart as grounds,
//     none of them the van's slate, the captain's emerald, a proposal's amber or a refusal's rose. A 0
//     keeps its hue, muted: a lighter ground, a lighter figure (3:1 or better), never one grey for all.
//   · THE HEAD: the time and the direction calm and neutral — each a white pill ringed in slate, its
//     own icon (a clock, a route) — so the head is the van's alone (Round 26's sky and violet would
//     now sit beside a cyan and a fuchsia count).
//   · THE CAPTAIN: his own frame, the board's captain green, apart from every count.
//
// Every pair of words and ground is measured in `distribution-colours.spec.ts`, light and dark.
import { type CountKind } from '../lib/van-card';
import { PATH } from '../../fleet/components/FuelCardBoard';
import { SHIPMENT_PATH } from './shipment-icons';

/**
 * The ONE look of every van (Round 26b — «لون واحد لكل العربيات»):
 *   · `stripe` — the thin stripe at the card's start edge;
 *   · `band` — the head's very light band;
 *   · `pill` — the van code's pill: solid slate, its words white (10:1 or better, both themes);
 *   · `ring` — the pill's edge in dark, where the card is nearly as dark as the pill.
 */
export const VAN_LOOK = {
  stripe: 'bg-slate-500 dark:bg-slate-500',
  band: 'bg-slate-100 dark:bg-slate-400/[0.08]',
  pill: 'bg-slate-700 text-white dark:bg-slate-700 dark:text-white',
  ring: 'ring-1 ring-inset ring-slate-800/10 dark:ring-white/15',
} as const;

/**
 * One count's look:
 *   · `icon` — its drawing, the same everywhere;
 *   · `hue` — its Tailwind family (the specs measure it);
 *   · `square` — the figure pill's square on the page's bar (`BoardFigurePill`'s tone);
 *   · `chip` — a count of 1 or more: a FILLED tinted ground, its ring, its words;
 *   · `figure` — its figure on that ground; `mark` — its icon;
 *   · `zero` — a count of 0 (or «…» / «—»): the same hue, muted — a lighter ground and ring;
 *   · `zeroFigure` — its figure then: lighter, 3:1 or better.
 */
export interface CountLook {
  icon: readonly string[];
  hue: 'blue' | 'orange' | 'cyan' | 'fuchsia';
  square: string;
  chip: string;
  figure: string;
  mark: string;
  zero: string;
  zeroFigure: string;
}

/** Each count's colour and icon (Round 26 — «والاعداد»; Round 26b — four hues far apart). */
export const COUNT_LOOK: Record<CountKind, CountLook> = {
  shipments: {
    icon: SHIPMENT_PATH.shipment,
    hue: 'blue',
    square: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    chip: 'bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-500/[0.16] dark:text-blue-200 dark:ring-blue-400/30',
    figure: 'text-blue-900 dark:text-blue-50',
    mark: 'text-blue-600 dark:text-blue-300',
    zero: 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/[0.06] dark:text-blue-300 dark:ring-blue-400/15',
    zeroFigure: 'text-blue-600 dark:text-blue-400',
  },
  cartons: {
    icon: PATH.box,
    hue: 'orange',
    square: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    chip: 'bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-500/[0.16] dark:text-orange-200 dark:ring-orange-400/30',
    figure: 'text-orange-900 dark:text-orange-50',
    mark: 'text-orange-600 dark:text-orange-300',
    zero: 'bg-orange-50 text-orange-700 ring-orange-100 dark:bg-orange-500/[0.06] dark:text-orange-300 dark:ring-orange-400/15',
    zeroFigure: 'text-orange-600 dark:text-orange-400',
  },
  bags: {
    icon: SHIPMENT_PATH.bag,
    hue: 'cyan',
    square: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
    chip: 'bg-cyan-100 text-cyan-800 ring-cyan-200 dark:bg-cyan-500/[0.16] dark:text-cyan-200 dark:ring-cyan-400/30',
    figure: 'text-cyan-900 dark:text-cyan-50',
    mark: 'text-cyan-600 dark:text-cyan-300',
    zero: 'bg-cyan-50 text-cyan-700 ring-cyan-100 dark:bg-cyan-500/[0.06] dark:text-cyan-300 dark:ring-cyan-400/15',
    zeroFigure: 'text-cyan-600 dark:text-cyan-400',
  },
  boxes: {
    icon: SHIPMENT_PATH.cube,
    hue: 'fuchsia',
    square: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
    chip: 'bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200 dark:bg-fuchsia-500/[0.16] dark:text-fuchsia-200 dark:ring-fuchsia-400/30',
    figure: 'text-fuchsia-900 dark:text-fuchsia-50',
    mark: 'text-fuchsia-600 dark:text-fuchsia-300',
    zero: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100 dark:bg-fuchsia-500/[0.06] dark:text-fuchsia-300 dark:ring-fuchsia-400/15',
    zeroFigure: 'text-fuchsia-600 dark:text-fuchsia-400',
  },
};

/**
 * The head's two facts after the code — calm and neutral (Round 26b): a white pill ringed in slate,
 * each with its own icon (a clock, a route), so the van's code stays the head's one solid colour; a
 * van with no direction says «بلا اتجاه», quieter.
 */
export const HEAD_PILL = {
  time: 'bg-white text-slate-800 ring-slate-300 dark:bg-[#0b1226] dark:text-slate-100 dark:ring-slate-600',
  direction:
    'bg-white text-slate-900 ring-slate-300 dark:bg-[#0b1226] dark:text-white dark:ring-slate-600',
  none: 'bg-white text-slate-500 ring-slate-200 dark:bg-[#0b1226] dark:text-slate-400 dark:ring-slate-700',
} as const;

/** The captain's mark in his frame — «قائد», solid green with white words (5.5:1; emerald-600 was 3.8:1). */
export const CAPTAIN_MARK = 'bg-emerald-700 text-white dark:bg-emerald-700 dark:text-white';

/**
 * The captain's own frame (Round 26b — «وافصل الاليطار بتاع القائد عن المحصنة»): the board's captain
 * green, holding his mark and his name only — no count shares it; a van with none, the refusal's rose.
 */
export const CAPTAIN_FRAME = {
  some: 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30',
  none: 'bg-rose-50 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/30',
} as const;

/**
 * The van's load — a bounded place of its own under the counts, the chips on it plain as on the
 * left: `area` its ground and edge; `empty` the words of an empty load; `refuse` the place of a van
 * that takes nothing (no captain, or a row of another type).
 */
export const LOAD_LOOK = {
  area: 'border-slate-200 bg-slate-50 dark:border-slate-700/60 dark:bg-[#0b1226]',
  empty: 'text-slate-500 dark:text-slate-400',
  refuse:
    'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/[0.06] dark:text-rose-300',
} as const;

/** The page's «السيارات» figure — the van's own slate. */
export const VANS_FIGURE = 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
