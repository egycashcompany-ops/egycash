// The colours of «توزيع المحصنات» and «تسليم المحصنات» (Round 26) — «عاوزك تضيف الوان عشان حاسس ان مش
// اقدر اميز اوى العربيه والمحصنات اللى عليها والاعداد وكدا».
//
// Which van wears which colour is `lib/van-accent.ts`'s; here is how each colour LOOKS. Tailwind only
// emits the classes it can read in the source, so every class is written out whole.
//
//   · A VAN'S ACCENT — one of «لوحة التشغيلة»'s twenty palette colours, in their own shades: the stripe
//     at the card's start edge and the swatch are the palette's own dot (`SHIFT_TYPE_TONE[c].dot`);
//     the head's band and a chip's ground are that colour, thin; the code's pill is that colour, solid,
//     its words white or near-black — whichever reads at 4.5:1 or better on it (`VAN_ACCENT_LOOK`).
//   · THE COUNTS — each kind its own colour, with its icon, the same on the van card, the van's card,
//     a chip's card and the page's figures (`COUNT_LOOK`): محصنات indigo, كراتين amber, حقائب teal,
//     صناديق fuchsia. A 0 is written, in grey (`COUNT_ZERO`). R26 critic: a count is drawn as a
//     COUNT — a light ground of its own (white; the dark card's navy), ringed in its colour, its icon
//     and its figure in it — never as a van, whose colour is solid (its code) or a wash (its band,
//     its chips): the محصنات badge was solid indigo-600, the very pill of an indigo van's code.
//   · THE HEAD: the time in sky, the direction in violet (`HEAD_PILL`) — each on a ground of its own,
//     so the van's band under them never decides how they read; the captain's line stays the
//     captain's green.
//
// Every pair of words and ground is measured in `distribution-colours.spec.ts`, light and dark.
import { type OperationsShiftTypeColour } from '@ecms/contracts';
import { type CountKind } from '../lib/van-accent';
import { PATH } from '../../fleet/components/FuelCardBoard';
import { SHIPMENT_PATH } from './shipment-icons';
import { SHIFT_TYPE_TONE } from './shift-type-look';

/**
 * A van's accent, drawn:
 *   · `bar` — the stripe at the card's start edge, and the swatch beside its name on a card: the
 *     palette's own dot (`SHIFT_TYPE_TONE`), a step lighter in dark for the deep colours;
 *   · `band` — the head's band (the colour at 12%, 22% in dark);
 *   · `chip` — the ground of a محصنة on that van (7%, 14% in dark);
 *   · `pill` — the van code's pill: solid, with its words in the colour that reads on it.
 */
export interface VanAccentLook {
  bar: string;
  band: string;
  chip: string;
  pill: string;
}

const look = (
  colour: OperationsShiftTypeColour,
  band: string,
  chip: string,
  pill: string,
): VanAccentLook => ({ bar: SHIFT_TYPE_TONE[colour].dot, band, chip, pill });

export const VAN_ACCENT_LOOK: Record<OperationsShiftTypeColour, VanAccentLook> = {
  rose: look(
    'rose',
    'bg-rose-500/[0.12] dark:bg-rose-500/[0.22]',
    'bg-rose-500/[0.07] dark:bg-rose-500/[0.14]',
    'bg-rose-600 text-white dark:bg-rose-600 dark:text-white',
  ),
  emerald: look(
    'emerald',
    'bg-emerald-500/[0.12] dark:bg-emerald-500/[0.22]',
    'bg-emerald-500/[0.07] dark:bg-emerald-500/[0.14]',
    'bg-emerald-500 text-slate-950 dark:bg-emerald-500 dark:text-slate-950',
  ),
  indigo: look(
    'indigo',
    'bg-indigo-500/[0.12] dark:bg-indigo-500/[0.22]',
    'bg-indigo-500/[0.07] dark:bg-indigo-500/[0.14]',
    'bg-indigo-600 text-white dark:bg-indigo-600 dark:text-white',
  ),
  amber: look(
    'amber',
    'bg-amber-600/[0.12] dark:bg-amber-600/[0.22]',
    'bg-amber-600/[0.07] dark:bg-amber-600/[0.14]',
    'bg-amber-500 text-slate-950 dark:bg-amber-500 dark:text-slate-950',
  ),
  violet: look(
    'violet',
    'bg-violet-500/[0.12] dark:bg-violet-500/[0.22]',
    'bg-violet-500/[0.07] dark:bg-violet-500/[0.14]',
    'bg-violet-600 text-white dark:bg-violet-600 dark:text-white',
  ),
  teal: look(
    'teal',
    'bg-teal-500/[0.12] dark:bg-teal-500/[0.22]',
    'bg-teal-500/[0.07] dark:bg-teal-500/[0.14]',
    'bg-teal-500 text-slate-950 dark:bg-teal-500 dark:text-slate-950',
  ),
  orange: look(
    'orange',
    'bg-orange-500/[0.12] dark:bg-orange-500/[0.22]',
    'bg-orange-500/[0.07] dark:bg-orange-500/[0.14]',
    'bg-orange-500 text-slate-950 dark:bg-orange-500 dark:text-slate-950',
  ),
  fuchsia: look(
    'fuchsia',
    'bg-fuchsia-500/[0.12] dark:bg-fuchsia-500/[0.22]',
    'bg-fuchsia-500/[0.07] dark:bg-fuchsia-500/[0.14]',
    'bg-fuchsia-600 text-white dark:bg-fuchsia-600 dark:text-white',
  ),
  slate: look(
    'slate',
    'bg-slate-700/[0.12] dark:bg-slate-300/[0.16]',
    'bg-slate-700/[0.06] dark:bg-slate-300/[0.10]',
    'bg-slate-700 text-white dark:bg-slate-300 dark:text-slate-950',
  ),
  lime: look(
    'lime',
    'bg-lime-500/[0.14] dark:bg-lime-500/[0.22]',
    'bg-lime-500/[0.08] dark:bg-lime-500/[0.14]',
    'bg-lime-500 text-slate-950 dark:bg-lime-500 dark:text-slate-950',
  ),
  sky: look(
    'sky',
    'bg-sky-500/[0.12] dark:bg-sky-500/[0.22]',
    'bg-sky-500/[0.07] dark:bg-sky-500/[0.14]',
    'bg-sky-500 text-slate-950 dark:bg-sky-500 dark:text-slate-950',
  ),
  crimson: look(
    'crimson',
    'bg-red-700/[0.12] dark:bg-red-600/[0.24]',
    'bg-red-700/[0.07] dark:bg-red-600/[0.15]',
    'bg-red-700 text-white dark:bg-red-600 dark:text-white',
  ),
  navy: look(
    'navy',
    'bg-blue-800/[0.12] dark:bg-blue-600/[0.26]',
    'bg-blue-800/[0.07] dark:bg-blue-600/[0.16]',
    'bg-blue-800 text-white dark:bg-blue-600 dark:text-white',
  ),
  forest: look(
    'forest',
    'bg-green-700/[0.12] dark:bg-green-600/[0.24]',
    'bg-green-700/[0.07] dark:bg-green-600/[0.15]',
    'bg-green-700 text-white dark:bg-green-600 dark:text-slate-950',
  ),
  gold: look(
    'gold',
    'bg-yellow-400/[0.22] dark:bg-yellow-400/[0.20]',
    'bg-yellow-400/[0.12] dark:bg-yellow-400/[0.12]',
    'bg-yellow-400 text-slate-950 dark:bg-yellow-400 dark:text-slate-950',
  ),
  plum: look(
    'plum',
    'bg-purple-800/[0.12] dark:bg-purple-600/[0.26]',
    'bg-purple-800/[0.07] dark:bg-purple-600/[0.16]',
    'bg-purple-800 text-white dark:bg-purple-600 dark:text-white',
  ),
  brown: look(
    'brown',
    'bg-amber-800/[0.12] dark:bg-amber-700/[0.28]',
    'bg-amber-800/[0.07] dark:bg-amber-700/[0.16]',
    'bg-amber-800 text-white dark:bg-amber-700 dark:text-white',
  ),
  cyan: look(
    'cyan',
    'bg-cyan-400/[0.16] dark:bg-cyan-400/[0.20]',
    'bg-cyan-400/[0.09] dark:bg-cyan-400/[0.12]',
    'bg-cyan-400 text-slate-950 dark:bg-cyan-400 dark:text-slate-950',
  ),
  pink: look(
    'pink',
    'bg-pink-400/[0.15] dark:bg-pink-400/[0.20]',
    'bg-pink-400/[0.08] dark:bg-pink-400/[0.12]',
    'bg-pink-400 text-slate-950 dark:bg-pink-400 dark:text-slate-950',
  ),
  olive: look(
    'olive',
    'bg-lime-700/[0.13] dark:bg-lime-600/[0.24]',
    'bg-lime-700/[0.07] dark:bg-lime-600/[0.15]',
    'bg-lime-700 text-white dark:bg-lime-600 dark:text-slate-950',
  ),
};

/**
 * Each count's colour and icon (Round 26 — «والاعداد»):
 *   · `icon` — its drawing, the same everywhere;
 *   · `square` — the figure pill's square on the page's bar (`BoardFigurePill`'s tone);
 *   · `chip` — a count written on a card: its ground (light, neutral — R26 critic), its ring (its
 *     colour) and its words;
 *   · `figure` — its figure's colour on that chip;
 *   · `mark` — its icon's colour on that chip.
 * محصنات is the van card's count badge as well (`SHIPMENTS_BADGE`).
 */
export const COUNT_LOOK: Record<
  CountKind,
  { icon: readonly string[]; square: string; chip: string; figure: string; mark: string }
> = {
  shipments: {
    icon: SHIPMENT_PATH.shipment,
    square: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
    chip: 'bg-white text-slate-700 ring-indigo-300 dark:bg-[#0b1226] dark:text-slate-200 dark:ring-indigo-400/50',
    figure: 'text-indigo-700 dark:text-indigo-300',
    mark: 'text-indigo-600 dark:text-indigo-300',
  },
  cartons: {
    icon: PATH.box,
    square: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    chip: 'bg-white text-slate-700 ring-amber-400 dark:bg-[#0b1226] dark:text-slate-200 dark:ring-amber-400/50',
    figure: 'text-amber-700 dark:text-amber-300',
    mark: 'text-amber-600 dark:text-amber-300',
  },
  bags: {
    icon: SHIPMENT_PATH.bag,
    square: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
    chip: 'bg-white text-slate-700 ring-teal-400 dark:bg-[#0b1226] dark:text-slate-200 dark:ring-teal-400/50',
    figure: 'text-teal-700 dark:text-teal-300',
    mark: 'text-teal-600 dark:text-teal-300',
  },
  boxes: {
    icon: SHIPMENT_PATH.cube,
    square: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
    chip: 'bg-white text-slate-700 ring-fuchsia-300 dark:bg-[#0b1226] dark:text-slate-200 dark:ring-fuchsia-400/50',
    figure: 'text-fuchsia-700 dark:text-fuchsia-300',
    mark: 'text-fuchsia-600 dark:text-fuchsia-300',
  },
};

/** A count of 0 (or one not read yet, «…» / «—»): written, muted — the icon keeps its colour, dimmer. */
export const COUNT_ZERO =
  'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-white/[0.04] dark:text-slate-400 dark:ring-slate-700/60';

/**
 * The van card's count of محصنات, before the captain — a count, drawn as the counts are (R26 critic:
 * it was solid indigo-600, an indigo van's own code pill): a white ground (the dark card's navy),
 * ringed in indigo, its icon indigo, its words dark; 0 muted, as every 0 (`COUNT_ZERO`).
 */
export const SHIPMENTS_BADGE = {
  some: 'bg-white text-slate-900 ring-indigo-400 dark:bg-[#0b1226] dark:text-white dark:ring-indigo-400/60',
  zero: COUNT_ZERO,
} as const;

/**
 * The head's two facts after the code — each its own calm colour on a ground of its own, so the
 * van's band under them never decides how they read: the time sky, the direction violet; a van with
 * no direction says «بلا اتجاه» in grey.
 */
export const HEAD_PILL = {
  time: 'bg-white text-sky-800 ring-sky-300 dark:bg-[#0b1226] dark:text-sky-200 dark:ring-sky-400/40',
  direction:
    'bg-white text-violet-800 ring-violet-300 dark:bg-[#0b1226] dark:text-violet-200 dark:ring-violet-400/40',
  none: 'bg-white text-slate-600 ring-slate-300 dark:bg-[#0b1226] dark:text-slate-400 dark:ring-slate-600/60',
} as const;

/** The captain's mark on his line — «قائد», solid green with white words (5.5:1; emerald-600 was 3.8:1). */
export const CAPTAIN_MARK = 'bg-emerald-700 text-white dark:bg-emerald-700 dark:text-white';

/** The captain's line — the board's captain green, whatever the van's colour. */
export const CAPTAIN_BAND = {
  some: 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30',
  none: 'bg-rose-50 ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/30',
} as const;

/** The page's «السيارات» figure — grey: the vans' own colours are each van's, not the count's. */
export const VANS_FIGURE = 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
