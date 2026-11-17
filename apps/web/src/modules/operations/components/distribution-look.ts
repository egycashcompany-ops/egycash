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
// small chips — and only its COLOURS are his.
//
// Round 27d — the owner on Round 27's screens: «اعملى نسخة واحدة بس من الشاشة بس تكون بالوان اهدى».
// The same hues in the same roles, CALMER: no coloured glow or halo anywhere (a neutral soft shadow
// at most); every edge a breath of its hue (by day x-200/300, by night x-400 at a third or so); the
// grounds the faintest tint; the words neutral slate — the hue only in an icon, a figure or a dot:
//
//   · THE VAN — one look for every van (`VAN_LOOK`): its code on a soft blue tint, its number slate
//     (near-white by night), a faint blue edge, its truck blue; the card white by day, the deep navy by
//     night, a subtle edge and a neutral soft shadow (`VAN_CARD`). The time and the direction neutral
//     pills — the direction's arrow blue (`HEAD_PILL`).
//   · THE STATES on the card's edge (`VAN_CARD`): a van «بلا قائد» a quiet rose edge, a row of another
//     type kept for what it carries a quiet dashed amber one — 1px each, no ring and no glow, still
//     3:1 against the column (they are the card's state at a glance); its stripe the same hue,
//     lighter. Each state also says itself in words — colour is never its only sign.
//   · THE COUNTS (`COUNT_LOOK`): a soft tile — the faintest tint of its hue, a faint edge of it — its
//     icon and figure in a muted tone of the hue, its word neutral slate: محصنات cyan, كراتين amber,
//     حقائب blue, صناديق purple. A 0 is neutral grey throughout — ground, edge, figure, word — only
//     its icon keeps a faint hue (`zeroMark`), so a 0 sits back and a count stands out.
//   · THE CHIPS (`CHIP_LOOK`, `CHIP_DOT`, `CHIP_WORDS`): on a van a neutral row with a small cyan dot
//     (a محصنة, the محصنات' colour); a proposal a lighter dashed amber; one on NO van («بلا سيارة») a
//     faint rose ground, a light dashed rose edge, a small rose dot, its words neutral — and its
//     column's head a rose icon with a neutral count (`COLUMN_WARN`).
//   · THE CAPTAIN: his own green frame as Round 26b drew it — unchanged; with none, a lighter rose.
//
// Every pair of words and ground, every icon and dot, and every state's edge against what it stands
// on, is measured in `distribution-colours.spec.ts`, light and dark. The printed sheet stays black on
// white.
//
// Tailwind only emits the classes it can read in the source, so every class is written out whole.
import { type CountKind } from '../lib/van-card';
import { PATH } from '../../fleet/components/FuelCardBoard';
import { SHIPMENT_PATH } from './shipment-icons';

/**
 * The ONE look of every van (Round 26b — «لون واحد لكل العربيات»; Round 27 — the owner's blue; Round
 * 27d — calmer):
 *   · `stripe` — the thin stripe at the card's start edge, a light blue (a state's colour on a card
 *     that wears one — `VAN_STATE_STRIPE`);
 *   · `band` — the head's ground: barely a wash, the head stands on the card itself, ruled off by a
 *     thin line;
 *   · `pill` — the van code's pill: a soft blue tint, its number slate (near-white by night);
 *   · `ring` — the pill's faint blue edge — no glow (Round 27d); the tint and the number draw it;
 *   · `icon` — the truck in it.
 */
export const VAN_LOOK = {
  stripe: 'bg-blue-200 dark:bg-blue-400/30',
  band: 'bg-slate-50 dark:bg-slate-400/[0.03]',
  pill: 'bg-blue-50 text-slate-900 dark:bg-blue-400/10 dark:text-slate-100',
  ring: 'ring-1 ring-inset ring-blue-200 dark:ring-blue-400/30',
  icon: 'text-blue-600 dark:text-blue-300',
} as const;

/**
 * The van card's own edge, ground and shadow — ONE of each at a time (R26b verify: `cn` does not
 * merge, and the board's CSS writes `border-slate-200` / `bg-white` AFTER the brand, amber and rose
 * utilities, so a plain colour beside a state's would win):
 *   · `rest` — white by day, the deep navy by night, a subtle edge, a neutral soft shadow;
 *   · `noCaptain` — «بلا قائد»: a quiet 1px rose edge on the card's own ground and shadow — no ring,
 *     no glow (Round 27d);
 *   · `kept` — a row of another type kept for what it carries: its dashed edge (Round 25's shape), a
 *     quiet amber — no ring, no glow (Round 27d);
 *   · `armed`, `place`, `refuse` — a drag on the page (Round 25's), unchanged: «takes it» dashed
 *     brand, «here» brand, «no» rose.
 * Each state's edge still reads at 3:1 or better against the column it stands on — it is the card's
 * state at a glance.
 */
export const VAN_CARD = {
  rest: 'border-slate-200 bg-white shadow-sm shadow-slate-900/[0.06] dark:border-slate-700/60 dark:bg-[#111a2e] dark:shadow-lg dark:shadow-black/40',
  noCaptain:
    'border-rose-500 bg-white shadow-sm shadow-slate-900/[0.06] dark:border-rose-400/60 dark:bg-[#111a2e] dark:shadow-lg dark:shadow-black/40',
  kept: 'border-dashed border-amber-600 bg-white shadow-sm shadow-slate-900/[0.06] dark:border-amber-400/50 dark:bg-[#111a2e] dark:shadow-lg dark:shadow-black/40',
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
 * The stripe of a card that wears a state (Round 27): its edge's hue — rose «بلا قائد», amber a kept
 * row — lighter, as the van's own (Round 27d). Every other van: the van's one stripe
 * (`VAN_LOOK.stripe`).
 */
export const VAN_STATE_STRIPE = {
  noCaptain: 'bg-rose-300 dark:bg-rose-400/50',
  kept: 'bg-amber-300 dark:bg-amber-400/50',
} as const;

/**
 * One count's look (Round 27d — calmer: a soft tile, the hue in its icon and figure only):
 *   · `icon` — its drawing, the same everywhere;
 *   · `hue` — its Tailwind family (the specs measure it);
 *   · `square` — the figure pill's small square on the page's bar (`BoardFigurePill`'s tone);
 *   · `chip` — a count of 1 or more: the faintest tint of its hue (by day x-50, by night x-400 at
 *     /[0.08]), a faint edge of it (the tile draws it as an inset ring — by day x-300, by night
 *     x-400/35), its word neutral slate; no glow;
 *   · `figure` — its figure on that ground, a muted tone of the hue; `mark` — its icon, likewise;
 *   · `zero` — a count of 0 (or «…» / «—»): neutral grey throughout — ground, edge and word slate;
 *   · `zeroFigure` — its figure then: slate, still 4.5:1 (it is text — R26b verify);
 *   · `zeroMark` — its icon then: the only part that keeps the hue, fainter than a count's, 3:1.
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
  zeroMark: string;
}

/** A 0's tile — the same neutral grey for every kind; only its icon says which (`zeroMark`). */
const ZERO_TILE =
  'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-400/[0.03] dark:text-slate-400 dark:ring-slate-500/25';
/** A 0's figure — slate, quieter than any count's. */
const ZERO_FIGURE = 'text-slate-500 dark:text-slate-400';

/**
 * Each count's colour and icon (Round 26 — «والاعداد»; Round 27 — «والوان الكراتين والحقائب والصناديق
 * زي الديزاين الجديد ده»; Round 27d — «بالوان اهدى»): محصنات cyan, كراتين amber, حقائب blue, صناديق
 * purple.
 */
export const COUNT_LOOK: Record<CountKind, CountLook> = {
  shipments: {
    icon: SHIPMENT_PATH.shipment,
    hue: 'cyan',
    square: 'bg-cyan-500/10 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300',
    chip: 'bg-cyan-50 text-slate-600 ring-cyan-300 dark:bg-cyan-400/[0.08] dark:text-slate-300 dark:ring-cyan-400/35',
    figure: 'text-cyan-800 dark:text-cyan-200',
    mark: 'text-cyan-700 dark:text-cyan-300',
    zero: ZERO_TILE,
    zeroFigure: ZERO_FIGURE,
    zeroMark: 'text-cyan-600 dark:text-cyan-600',
  },
  cartons: {
    icon: PATH.box,
    hue: 'amber',
    square: 'bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
    chip: 'bg-amber-50 text-slate-600 ring-amber-300 dark:bg-amber-400/[0.08] dark:text-slate-300 dark:ring-amber-400/35',
    figure: 'text-amber-800 dark:text-amber-200',
    mark: 'text-amber-700 dark:text-amber-400',
    zero: ZERO_TILE,
    zeroFigure: ZERO_FIGURE,
    zeroMark: 'text-amber-600 dark:text-amber-600',
  },
  bags: {
    icon: SHIPMENT_PATH.bag,
    hue: 'blue',
    square: 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    chip: 'bg-blue-50 text-slate-600 ring-blue-300 dark:bg-blue-400/[0.08] dark:text-slate-300 dark:ring-blue-400/35',
    figure: 'text-blue-800 dark:text-blue-200',
    mark: 'text-blue-800 dark:text-blue-400',
    zero: ZERO_TILE,
    zeroFigure: ZERO_FIGURE,
    zeroMark: 'text-blue-500 dark:text-blue-500',
  },
  boxes: {
    icon: SHIPMENT_PATH.cube,
    hue: 'purple',
    square: 'bg-purple-500/10 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
    chip: 'bg-purple-50 text-slate-600 ring-purple-300 dark:bg-purple-400/[0.08] dark:text-slate-300 dark:ring-purple-400/35',
    figure: 'text-purple-800 dark:text-purple-200',
    mark: 'text-purple-500 dark:text-purple-400',
    zero: ZERO_TILE,
    zeroFigure: ZERO_FIGURE,
    zeroMark: 'text-purple-500 dark:text-purple-500',
  },
};

/**
 * The head's two facts after the code (Round 27d — calmer): the time and the direction the same
 * neutral pill, the direction's arrow blue; a van with no direction says «بلا اتجاه», quieter. Each
 * on a ground of its own (opaque), its words 4.5:1 or better, its icon 3:1.
 */
export const HEAD_PILL = {
  time: 'bg-white text-slate-700 ring-slate-200 dark:bg-[#141e33] dark:text-slate-200 dark:ring-slate-700',
  direction:
    'bg-white text-slate-800 ring-slate-200 dark:bg-[#141e33] dark:text-slate-100 dark:ring-slate-700',
  none: 'bg-white text-slate-500 ring-slate-200 dark:bg-[#111a2e] dark:text-slate-400 dark:ring-slate-700',
  timeIcon: 'text-slate-500 dark:text-slate-400',
  directionIcon: 'text-blue-600 dark:text-blue-400',
} as const;

/** The captain's mark in his frame — «قائد», solid green with white words (5.5:1; emerald-600 was 3.8:1). */
export const CAPTAIN_MARK = 'bg-emerald-700 text-white dark:bg-emerald-700 dark:text-white';

/**
 * The captain's own frame (Round 26b — «وافصل الاليطار بتاع القائد عن المحصنة»): the board's captain
 * green, holding his mark and his name only — no count shares it. Round 27 — «والكارت بتاع القائد
 * خليه زي ما انت ما كنت عامله كده»: unchanged. A van with none: the refusal's rose, as light as the
 * rest of the card (Round 27d).
 */
export const CAPTAIN_FRAME = {
  some: 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10 dark:ring-emerald-500/30',
  none: 'bg-rose-50 ring-rose-200 dark:bg-rose-500/[0.08] dark:ring-rose-400/30',
} as const;

/**
 * The van's load — a bounded place of its own under the counts: `area` its ground and edge (a shade
 * deeper than the card by night, so the chips on it read as rows); `empty` the words of an empty
 * load; `refuse` the place of a van that takes nothing (no captain, or a row of another type) — a
 * faint rose — and `refuseWords` its words; `place` — a dragged محصنة lands here. ONE of them at a
 * time (R26b verify): the board's CSS writes `border-slate-200` and `bg-slate-50` after the brand
 * utilities, so `area` beside `place` hid the drop's edge and ground by day.
 */
export const LOAD_LOOK = {
  area: 'border-slate-200 bg-slate-50 dark:border-slate-700/50 dark:bg-[#0c1424]',
  place: 'border-brand-400 bg-brand-50/70 dark:border-brand-400/70 dark:bg-brand-500/10',
  empty: 'text-slate-500 dark:text-slate-400',
  refuse:
    'border-rose-200 bg-rose-50/60 text-rose-800 dark:border-rose-400/25 dark:bg-rose-500/[0.06] dark:text-rose-200',
  refuseWords: 'text-rose-700 dark:text-rose-200',
} as const;

/**
 * A row of another type kept for what it carries — its notice under the head (Round 25), a faint
 * amber strip (Round 27d) and its warning icon.
 */
export const KEPT_NOTICE = {
  strip:
    'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/[0.06] dark:text-amber-100',
  icon: 'text-amber-600 dark:text-amber-400',
} as const;

/** Where a chip stands, and its state — which of the chip's looks it wears. */
export type ChipTone = 'van' | 'unplaced' | 'proposed' | 'moved' | 'refused';

/**
 * A محصنة's chip — its ground and edge, ONE of each (R26b verify):
 *   · `van` — on a van: a neutral row with a subtle edge, white by day;
 *   · `unplaced` — on no van («بلا سيارة»): a faint rose ground, a light dashed rose edge (Round 27d);
 *   · `proposed` — «مقترحة»: a lighter dashed amber on a faint amber ground;
 *   · `moved` — an unsaved move: brand; `refused` — the save refused it: a firm rose edge and ring.
 */
export const CHIP_LOOK: Record<ChipTone, string> = {
  van: 'bg-white dark:bg-[#152038] border-slate-200 dark:border-slate-700/70',
  unplaced:
    'bg-rose-50/60 dark:bg-rose-500/[0.05] border-dashed border-rose-300 dark:border-rose-400/35',
  proposed:
    'bg-amber-50/70 dark:bg-amber-400/[0.05] border-dashed border-amber-400 dark:border-amber-400/45',
  moved: 'bg-brand-50/60 dark:bg-brand-500/[0.08] border-brand-400 dark:border-brand-400/60',
  refused:
    'bg-white dark:bg-[#152038] border-rose-500 ring-1 ring-rose-500 dark:border-rose-400 dark:ring-rose-400',
};

/**
 * The small dot at a chip's start (Round 27): cyan on a van (a محصنة, the محصنات' own colour), rose
 * on no van, amber for a proposal, brand for an unsaved move, rose for a refusal. It only echoes what
 * the chip's edge and marks already say — it is drawn, not read. Round 27d: the chip's one spot of
 * colour.
 */
export const CHIP_DOT: Record<ChipTone, string> = {
  van: 'bg-cyan-600 dark:bg-cyan-400',
  unplaced: 'bg-rose-500 dark:bg-rose-400',
  proposed: 'bg-amber-600 dark:bg-amber-400',
  moved: 'bg-brand-600 dark:bg-brand-400',
  refused: 'bg-rose-600 dark:bg-rose-400',
};

/**
 * A chip's words — the bank, the « · » between, the branch: neutral slate everywhere (Round 27d — on
 * no van too: the rose is its ground, edge and dot, not its words).
 */
export const CHIP_WORDS = {
  plain: {
    bank: 'text-slate-900 dark:text-white',
    dot: 'text-slate-400 dark:text-slate-500',
    branch: 'text-slate-600 dark:text-slate-300',
  },
  unplaced: {
    bank: 'text-slate-900 dark:text-slate-50',
    dot: 'text-slate-400 dark:text-slate-500',
    branch: 'text-slate-600 dark:text-slate-300',
  },
} as const;

/**
 * The head of a column that holds work still to do (Round 27 — the design's «رحلات بلا سيارة»): the
 * محصنات on no van. Round 27d — its icon rose, on a faint rose square, no ring; its count a NEUTRAL
 * pill; `glyph` — the warning that moves into the count where the icon gives way (1280–1440), still
 * rose. `figure` — the same number on the page's bar (R27 critic — one number, one colour): the
 * «بلا سيارة» figure's square in the same rose, its icon the same warning, while any wait.
 */
export const COLUMN_WARN = {
  figure: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  icon: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  count:
    'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
  glyph: 'text-rose-600 dark:text-rose-300',
} as const;

/** The page's «السيارات» figure — neutral slate, so the bar's only blue is the bags' figure. */
export const VANS_FIGURE = 'bg-slate-500/15 text-slate-700 dark:text-slate-300';
