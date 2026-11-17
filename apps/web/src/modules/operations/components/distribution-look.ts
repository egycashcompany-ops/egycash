// The colours of «توزيع المحصنات» and «تسليم المحصنات».
//
// Round 26 — «عاوزك تضيف الوان عشان حاسس ان مش اقدر اميز اوى العربيه والمحصنات اللى عليها والاعداد
// وكدا». Round 26b — the owner on Round 26's screens: «لا استنى الالوان مش عجبانى بتاعت العربيه», then
// «لون واحد لكل العربيات», «عاوز يبقى فى فرق فى الالوان بين الصندوق و الحقائب و الكراتين» and
// «وافصل الاليطار بتاع القائد عن المحصنة وحسن شكل العربيه بالكامل».
//
// Round 27 — the owner's colours. He sent a design (dark) and said: «يعني انا عايز ناخد الالوان
// نطبقها على الديزاين الموجود، ما نعملش شبه الديزاين ده». Round 26b's card stays as it is — its head,
// the محصنات before the captain, the captain's own frame, the packages under it, the bounded load, the
// small chips — and only its COLOURS are his:
//
//   · THE VAN — one look for every van (`VAN_LOOK`): its code in a blue-outlined pill on a soft blue
//     tint, its number white by night (a deep navy by day), its truck drawn in sky; the card a deep
//     navy surface by night, white by day, a subtle edge and a soft shadow (`VAN_CARD`). The time a
//     neutral outlined pill, the direction a sky-outlined one with its arrow (`HEAD_PILL`).
//   · THE STATES on the card's edge (`VAN_CARD`): a van «بلا قائد» wears a rose edge with a soft rose
//     glow, its «بلا قائد» frame and its refusal rose-tinted; a row of another type kept for what it
//     carries keeps its dashed edge, in amber with an amber glow, its notice strip amber
//     (`KEPT_NOTICE`). Each state also says itself in words — colour is never its only sign.
//   · THE COUNTS — «والوان الكراتين والحقائب والصناديق زي الديزاين الجديد ده»: each an OUTLINED tile —
//     a 1px edge of its colour on a tinted ground of the same colour, its icon, figure and word in it
//     (`COUNT_LOOK`): محصنات cyan (the design's teal-cyan, kept on the cyan side so it is never taken
//     for the captain's emerald frame beside it), كراتين amber, حقائب blue, صناديق purple. A 0 keeps
//     its colour and its edge, PLAINLY quieter (R27 critic) — a thinner ground, quieter words and
//     figure, and by night a fainter edge than a count's firm one. The same on the van card, the
//     van's card, a chip's card, the page's figures and «تسليم»'s confirmation.
//   · THE CHIPS (`CHIP_LOOK`, `CHIP_DOT`, `CHIP_WORDS`): the same small chip as before; on a van a
//     dark row with a subtle edge and a small cyan dot (a محصنة, the محصنات' colour) at its start; a
//     proposal keeps its dashed amber (the design's «in progress» row); one on NO van («بلا سيارة»,
//     the design's «رحلات بلا سيارة») a rose-tinted ground, a dashed rose edge, a rose dot — and its
//     column's head a rose warning icon and a rose count (`COLUMN_WARN`).
//   · THE CAPTAIN: his own frame as Round 26b drew it, the board's captain green — unchanged.
//
// By day (the design is dark only) every role keeps its hue: a light tint of it, an edge of it,
// dark words. Every pair of words and ground, and every coloured edge against what it stands on, is
// measured in `distribution-colours.spec.ts`, light and dark. The printed sheet stays black on white.
//
// Tailwind only emits the classes it can read in the source, so every class is written out whole.
import { type CountKind } from '../lib/van-card';
import { PATH } from '../../fleet/components/FuelCardBoard';
import { SHIPMENT_PATH } from './shipment-icons';

/**
 * The ONE look of every van (Round 26b — «لون واحد لكل العربيات»; Round 27 — the owner's blue):
 *   · `stripe` — the thin stripe at the card's start edge, the van's blue (a state's colour on a
 *     card that wears one — `VAN_CARD.stripe`);
 *   · `band` — the head's ground: barely a wash, the head stands on the card itself, ruled off by a
 *     thin line (the design's head);
 *   · `pill` — the van code's pill: a soft blue tint, its number white by night (navy by day);
 *   · `ring` — the pill's blue edge (3:1 or better on the band, both themes) and its soft glow;
 *   · `icon` — the truck in it.
 */
export const VAN_LOOK = {
  stripe: 'bg-blue-500/70 dark:bg-blue-500/60',
  band: 'bg-slate-50 dark:bg-slate-400/[0.03]',
  pill: 'bg-blue-50 text-blue-950 dark:bg-blue-500/20 dark:text-white',
  ring: 'ring-1 ring-inset ring-blue-500 dark:ring-blue-400/60 shadow-sm shadow-blue-500/20 dark:shadow-[0_0_16px_-5px_rgba(59,130,246,0.6)]',
  icon: 'text-blue-600 dark:text-sky-300',
} as const;

/**
 * The van card's own edge, ground and shadow — ONE of each at a time (R26b verify: `cn` does not
 * merge, and the board's CSS writes `border-slate-200` / `bg-white` AFTER the brand, amber and rose
 * utilities, so a plain colour beside a state's would win):
 *   · `rest` — the design's deep navy card by night (white by day), a subtle edge, a soft shadow;
 *   · `noCaptain` — «بلا قائد»: a rose edge with a soft rose glow, the ground a breath of rose;
 *   · `kept` — a row of another type kept for what it carries: its dashed edge (Round 25's shape), in
 *     amber, with an amber glow;
 *   · `armed`, `place`, `refuse` — a drag on the page (Round 25's), unchanged: «takes it» dashed
 *     brand, «here» brand, «no» rose.
 * Each state's edge reads at 3:1 or better against the column it stands on.
 */
export const VAN_CARD = {
  rest: 'border-slate-200 bg-white shadow-sm shadow-slate-900/[0.06] dark:border-slate-700/60 dark:bg-[#111a2e] dark:shadow-lg dark:shadow-black/40',
  noCaptain:
    'border-rose-500 bg-white shadow-[0_0_0_3px_rgba(244,63,94,0.12)] dark:border-rose-500/80 dark:bg-[#18152a] dark:shadow-[0_0_22px_-6px_rgba(244,63,94,0.55)]',
  kept: 'border-dashed border-amber-600 bg-white shadow-[0_0_0_3px_rgba(245,158,11,0.14)] dark:border-amber-500/70 dark:bg-[#111a2e] dark:shadow-[0_0_22px_-6px_rgba(245,158,11,0.45)]',
  armed:
    'border-dashed border-brand-300 bg-white shadow-sm shadow-slate-900/[0.06] dark:border-brand-500/50 dark:bg-[#111a2e] dark:shadow-black/40',
  place:
    'border-brand-500 bg-brand-50 shadow-lg shadow-brand-500/20 ring-2 ring-brand-500 dark:border-brand-400 dark:bg-brand-500/10 dark:ring-brand-400',
  refuse:
    'border-rose-500 bg-rose-50 ring-2 ring-rose-500 dark:border-rose-400 dark:bg-rose-500/10 dark:ring-rose-400',
  /**
   * R27 critic — a kept row that ALSO has no captain: the «بلا قائد» rose wins the colour (it takes
   * nothing at all), and the kept row keeps Round 25's dashed shape — a line style, not a colour, so
   * the card still wears ONE edge colour.
   */
  keptShape: 'border-dashed',
} as const;

/**
 * The stripe of a card that wears a state (Round 27): its edge's colour — rose «بلا قائد», amber a
 * kept row — where the van's blue would sit inside a rose or amber edge. Every other van: the van's
 * one stripe (`VAN_LOOK.stripe`).
 */
export const VAN_STATE_STRIPE = {
  noCaptain: 'bg-rose-500 dark:bg-rose-500/80',
  kept: 'bg-amber-500 dark:bg-amber-500/80',
} as const;

/**
 * One count's look:
 *   · `icon` — its drawing, the same everywhere;
 *   · `hue` — its Tailwind family (the specs measure it);
 *   · `square` — the figure pill's square on the page's bar (`BoardFigurePill`'s tone);
 *   · `chip` — a count of 1 or more: OUTLINED (Round 27) — its tinted ground, its 1px coloured edge
 *     (the tile draws it as an inset ring), its words; the محصنات' tile glows softly by night, as in
 *     the owner's design;
 *   · `figure` — its figure on that ground; `mark` — its icon;
 *   · `zero` — a count of 0 (or «…» / «—»): the same colour and edge, PLAINLY quieter (R27 critic —
 *     by night a 0 read as loud as a count): a thinner ground, quieter words, and by night a fainter
 *     edge than a count's (/50–60 against /80, still 3:1); by day the same edge — the lightest of
 *     its hue that still draws the tile at 3:1 on white;
 *   · `zeroFigure` — its figure then: 2.5:1 or more under a count's, still 4.5:1 (it is text — R26b
 *     verify).
 */
export interface CountLook {
  icon: readonly string[];
  hue: 'cyan' | 'amber' | 'blue' | 'purple';
  square: string;
  chip: string;
  figure: string;
  mark: string;
  zero: string;
  zeroFigure: string;
}

/**
 * Each count's colour and icon (Round 26 — «والاعداد»; Round 27 — «والوان الكراتين والحقائب والصناديق
 * زي الديزاين الجديد ده»): محصنات cyan, كراتين amber, حقائب blue, صناديق purple.
 */
export const COUNT_LOOK: Record<CountKind, CountLook> = {
  shipments: {
    icon: SHIPMENT_PATH.shipment,
    hue: 'cyan',
    square: 'bg-cyan-500/15 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
    chip: 'bg-cyan-100 text-cyan-900 ring-cyan-600 dark:bg-cyan-400/[0.16] dark:text-cyan-100 dark:ring-cyan-400/80 dark:shadow-[0_0_14px_-5px_rgba(34,211,238,0.55)]',
    figure: 'text-cyan-950 dark:text-cyan-200',
    mark: 'text-cyan-700 dark:text-cyan-300',
    zero: 'bg-cyan-50 text-cyan-800 ring-cyan-600 dark:bg-cyan-400/[0.05] dark:text-cyan-300 dark:ring-cyan-400/50',
    zeroFigure: 'text-cyan-700 dark:text-cyan-500',
  },
  cartons: {
    icon: PATH.box,
    hue: 'amber',
    square: 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
    chip: 'bg-amber-100 text-amber-900 ring-amber-600 dark:bg-amber-400/[0.12] dark:text-amber-100 dark:ring-amber-500/80',
    figure: 'text-amber-950 dark:text-amber-200',
    mark: 'text-amber-700 dark:text-amber-400',
    zero: 'bg-amber-50 text-amber-800 ring-amber-600 dark:bg-amber-400/[0.04] dark:text-amber-300 dark:ring-amber-500/50',
    zeroFigure: 'text-amber-700 dark:text-amber-500',
  },
  bags: {
    icon: SHIPMENT_PATH.bag,
    hue: 'blue',
    square: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
    chip: 'bg-blue-100 text-blue-900 ring-blue-500 dark:bg-blue-500/[0.22] dark:text-blue-100 dark:ring-blue-400/80',
    figure: 'text-blue-950 dark:text-blue-200',
    mark: 'text-blue-800 dark:text-blue-400',
    zero: 'bg-blue-50 text-blue-800 ring-blue-500 dark:bg-blue-500/[0.06] dark:text-blue-300 dark:ring-blue-400/55',
    zeroFigure: 'text-blue-600 dark:text-blue-400',
  },
  boxes: {
    icon: SHIPMENT_PATH.cube,
    hue: 'purple',
    square: 'bg-purple-500/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
    chip: 'bg-purple-100 text-purple-900 ring-purple-500 dark:bg-purple-500/[0.24] dark:text-purple-100 dark:ring-purple-400/80',
    figure: 'text-purple-950 dark:text-purple-200',
    mark: 'text-purple-500 dark:text-purple-400',
    zero: 'bg-purple-50 text-purple-800 ring-purple-500 dark:bg-purple-500/[0.07] dark:text-purple-300 dark:ring-purple-400/60',
    zeroFigure: 'text-purple-800 dark:text-purple-400',
  },
};

/**
 * The head's two facts after the code (Round 27 — the owner's design): the time a neutral outlined
 * pill; the direction a sky-outlined one, its arrow in sky; a van with no direction says «بلا اتجاه»,
 * quieter and neutral. Each on a ground of its own (opaque), its words 4.5:1 or better.
 */
export const HEAD_PILL = {
  time: 'bg-slate-50 text-slate-700 ring-slate-300 dark:bg-[#172033] dark:text-slate-200 dark:ring-slate-600',
  direction:
    'bg-sky-50 text-sky-950 ring-sky-600 dark:bg-[#0c2238] dark:text-sky-100 dark:ring-sky-500/60',
  none: 'bg-white text-slate-500 ring-slate-200 dark:bg-[#111a2e] dark:text-slate-400 dark:ring-slate-700',
  timeIcon: 'text-slate-500 dark:text-slate-400',
  directionIcon: 'text-sky-600 dark:text-sky-300',
} as const;

/** The captain's mark in his frame — «قائد», solid green with white words (5.5:1; emerald-600 was 3.8:1). */
export const CAPTAIN_MARK = 'bg-emerald-700 text-white dark:bg-emerald-700 dark:text-white';

/**
 * The captain's own frame (Round 26b — «وافصل الاليطار بتاع القائد عن المحصنة»): the board's captain
 * green, holding his mark and his name only — no count shares it. Round 27 — «والكارت بتاع القائد
 * خليه زي ما انت ما كنت عامله كده»: unchanged. A van with none: the refusal's rose, a little firmer
 * (the design's «بلا قائد» box).
 */
export const CAPTAIN_FRAME = {
  some: 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30',
  none: 'bg-rose-50 ring-rose-300 dark:bg-rose-500/[0.12] dark:ring-rose-500/50',
} as const;

/**
 * The van's load — a bounded place of its own under the counts: `area` its ground and edge (a shade
 * deeper than the card by night, so the chips on it read as rows); `empty` the words of an empty
 * load; `refuse` the place of a van that takes nothing (no captain, or a row of another type) — the
 * design's rose bar — and `refuseWords` its words; `place` — a dragged محصنة lands here. ONE of them
 * at a time (R26b verify): the board's CSS writes `border-slate-200` and `bg-slate-50` after the
 * brand utilities, so `area` beside `place` hid the drop's edge and ground by day.
 */
export const LOAD_LOOK = {
  area: 'border-slate-200 bg-slate-50 dark:border-slate-700/50 dark:bg-[#0c1424]',
  place: 'border-brand-400 bg-brand-50/70 dark:border-brand-400/70 dark:bg-brand-500/10',
  empty: 'text-slate-500 dark:text-slate-400',
  refuse:
    'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/45 dark:bg-rose-500/[0.10] dark:text-rose-200',
  refuseWords: 'text-rose-700 dark:text-rose-200',
} as const;

/**
 * A row of another type kept for what it carries — its notice under the head (Round 25), amber as in
 * the owner's design: the strip, and its warning icon.
 */
export const KEPT_NOTICE = {
  strip:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/[0.10] dark:text-amber-100',
  icon: 'text-amber-600 dark:text-amber-400',
} as const;

/** Where a chip stands, and its state — which of the chip's looks it wears. */
export type ChipTone = 'van' | 'unplaced' | 'proposed' | 'moved' | 'refused';

/**
 * A محصنة's chip — its ground and edge, ONE of each (R26b verify):
 *   · `van` — on a van: a dark row with a subtle edge (the design's rows), white by day;
 *   · `unplaced` — on no van («بلا سيارة», Round 27): a rose-tinted ground, a dashed rose edge;
 *   · `proposed` — «مقترحة»: dashed amber on its own amber ground (the design's «in progress» row);
 *   · `moved` — an unsaved move: brand; `refused` — the save refused it: a firm rose edge and ring.
 */
export const CHIP_LOOK: Record<ChipTone, string> = {
  van: 'bg-white dark:bg-[#152038] border-slate-200 dark:border-slate-600/50',
  unplaced:
    'bg-rose-50 dark:bg-rose-500/[0.08] border-dashed border-rose-500 dark:border-rose-400/60',
  proposed:
    'bg-amber-50 dark:bg-amber-400/[0.06] border-dashed border-amber-500 dark:border-amber-400/60',
  moved: 'bg-brand-50/60 dark:bg-brand-500/[0.08] border-brand-400 dark:border-brand-400/60',
  refused:
    'bg-white dark:bg-[#152038] border-rose-500 ring-1 ring-rose-500 dark:border-rose-400 dark:ring-rose-400',
};

/**
 * The small dot at a chip's start (Round 27 — the design's rows): cyan on a van (a محصنة, the
 * محصنات' own colour), rose on no van, amber for a proposal, brand for an unsaved move, rose for a
 * refusal. It only echoes what the chip's edge and marks already say — it is drawn, not read.
 */
export const CHIP_DOT: Record<ChipTone, string> = {
  van: 'bg-cyan-600 dark:bg-cyan-400',
  unplaced: 'bg-rose-600 dark:bg-rose-400',
  proposed: 'bg-amber-600 dark:bg-amber-400',
  moved: 'bg-brand-600 dark:bg-brand-400',
  refused: 'bg-rose-600 dark:bg-rose-400',
};

/**
 * A chip's words — the bank, the « · » between, the branch: slate on a van (and on any state's own
 * ground); on no van, rose-tinted as the design writes its waiting rows.
 */
export const CHIP_WORDS = {
  plain: {
    bank: 'text-slate-900 dark:text-white',
    dot: 'text-slate-400 dark:text-slate-500',
    branch: 'text-slate-600 dark:text-slate-300',
  },
  unplaced: {
    bank: 'text-rose-950 dark:text-rose-50',
    dot: 'text-rose-400 dark:text-rose-300/70',
    branch: 'text-rose-800 dark:text-rose-200',
  },
} as const;

/**
 * The head of a column that holds work still to do (Round 27 — the design's «رحلات بلا سيارة»): the
 * محصنات on no van — its icon a rose warning, its count a rose pill (with a soft rose glow by night).
 * `figure` — the same number on the page's bar (R27 critic — one number, one colour): the «بلا سيارة»
 * figure's square in the same rose, its icon the same warning, while any wait.
 */
export const COLUMN_WARN = {
  figure: 'bg-rose-500/15 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  icon: 'bg-rose-500/15 text-rose-600 ring-1 ring-inset ring-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/40',
  count:
    'bg-rose-100 text-rose-800 ring-1 ring-inset ring-rose-300 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-400/50 dark:shadow-[0_0_12px_-4px_rgba(244,63,94,0.6)]',
} as const;

/** The page's «السيارات» figure — neutral slate, so the bar's only blue is the bags' figure. */
export const VANS_FIGURE = 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
