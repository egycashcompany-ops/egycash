// How a type of «أنواع التشغيل» looks — on «لوحة التشغيلة» (its row's box, its list, the strip of
// counts) and on the reference screen's tab that keeps the catalog.
//
// THE COLOUR IS A NAME FROM THE CONTRACT, THE LOOK IS THE SCREEN'S. A type carries one of a small
// fixed palette (`OPERATIONS_SHIFT_TYPE_COLOURS`) — never a hex value somebody typed — so a type
// added on the reference screen reads as a coloured tag on the board in light and in dark without
// anybody choosing a shade. Each name maps here to whole class names, written out, because Tailwind
// only emits the classes it can read in the source.
import {
  type Locale,
  type OperationsShiftTypeColour,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';
import { cn } from '../../../shared/lib/cn';

/**
 * A palette colour's looks — Round 24b, ONE PALETTE for the types and the crew rows
 * (`OPERATIONS_SHIFT_TYPE_COLOURS`, twenty names, ordered):
 *   · `tag` — a type as a tag (tint, text, ring);
 *   · `dot` — the colour alone, solid: a type's dot, and every swatch it is picked by (on the board's
 *     «اللون» list, in «ألوان الأنواع», on the reference tab). In dark, the deep ones (navy, plum, …)
 *     a step lighter, so a swatch never vanishes into the panel;
 *   · `row` — a crew row drawn in the colour on «لوحة التشغيلة»: «وعاوز اللون فى الجدول يكون متشبع
 *     اكتر من كدا». The colour itself at 30% on light and 35% on dark (Round 20 drew a 100-level
 *     wash, about 15%, and 14% on dark), on the CELLS — the table paints a hovered ROW itself, which
 *     would wash the colour out exactly while the pointer is on it — and `--row-bar`, the solid
 *     colour of the bar at the row's start edge (`ROW_BAR`). The text stays the table's, and stays
 *     legible: slate-800 on every light tint is 8.4:1 or better (plum the lowest), slate-200 on
 *     every dark one 6.6:1 or better (lime the lowest) — AA asks 4.5:1.
 */
export const SHIFT_TYPE_TONE: Record<
  OperationsShiftTypeColour,
  { tag: string; dot: string; row: string }
> = {
  rose: {
    tag: 'bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-300',
    dot: 'bg-rose-500',
    row: '[&>td]:!bg-rose-500/30 dark:[&>td]:!bg-rose-500/35 [--row-bar:theme(colors.rose.500)]',
  },
  emerald: {
    tag: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    row: '[&>td]:!bg-emerald-500/30 dark:[&>td]:!bg-emerald-500/35 [--row-bar:theme(colors.emerald.500)]',
  },
  indigo: {
    tag: 'bg-indigo-500/15 text-indigo-700 ring-indigo-500/30 dark:text-indigo-300',
    dot: 'bg-indigo-500',
    row: '[&>td]:!bg-indigo-500/30 dark:[&>td]:!bg-indigo-500/35 [--row-bar:theme(colors.indigo.500)]',
  },
  amber: {
    tag: 'bg-amber-600/15 text-amber-800 ring-amber-600/30 dark:text-amber-300',
    dot: 'bg-amber-600',
    row: '[&>td]:!bg-amber-500/30 dark:[&>td]:!bg-amber-500/35 [--row-bar:theme(colors.amber.600)]',
  },
  violet: {
    tag: 'bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300',
    dot: 'bg-violet-500',
    row: '[&>td]:!bg-violet-500/30 dark:[&>td]:!bg-violet-500/35 [--row-bar:theme(colors.violet.500)]',
  },
  teal: {
    tag: 'bg-teal-500/15 text-teal-700 ring-teal-500/30 dark:text-teal-300',
    dot: 'bg-teal-500',
    row: '[&>td]:!bg-teal-500/30 dark:[&>td]:!bg-teal-500/35 [--row-bar:theme(colors.teal.500)]',
  },
  orange: {
    tag: 'bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300',
    dot: 'bg-orange-500',
    row: '[&>td]:!bg-orange-500/30 dark:[&>td]:!bg-orange-500/35 [--row-bar:theme(colors.orange.500)]',
  },
  fuchsia: {
    tag: 'bg-fuchsia-500/15 text-fuchsia-700 ring-fuchsia-500/30 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500',
    row: '[&>td]:!bg-fuchsia-500/30 dark:[&>td]:!bg-fuchsia-500/35 [--row-bar:theme(colors.fuchsia.500)]',
  },
  slate: {
    tag: 'bg-slate-700/15 text-slate-800 ring-slate-500/40 dark:bg-slate-400/15 dark:text-slate-200',
    dot: 'bg-slate-700 dark:bg-slate-300',
    row: '[&>td]:!bg-slate-500/30 dark:[&>td]:!bg-slate-400/35 [--row-bar:theme(colors.slate.700)] dark:[--row-bar:theme(colors.slate.300)]',
  },
  lime: {
    tag: 'bg-lime-500/20 text-lime-800 ring-lime-600/30 dark:text-lime-300',
    dot: 'bg-lime-500',
    row: '[&>td]:!bg-lime-500/30 dark:[&>td]:!bg-lime-500/35 [--row-bar:theme(colors.lime.500)]',
  },
  sky: {
    tag: 'bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300',
    dot: 'bg-sky-500',
    row: '[&>td]:!bg-sky-500/30 dark:[&>td]:!bg-sky-500/35 [--row-bar:theme(colors.sky.500)]',
  },
  crimson: {
    tag: 'bg-red-700/15 text-red-800 ring-red-700/35 dark:bg-red-500/20 dark:text-red-300',
    dot: 'bg-red-700 dark:bg-red-600',
    row: '[&>td]:!bg-red-700/30 dark:[&>td]:!bg-red-600/35 [--row-bar:theme(colors.red.700)] dark:[--row-bar:theme(colors.red.600)]',
  },
  navy: {
    tag: 'bg-blue-800/15 text-blue-900 ring-blue-800/35 dark:bg-blue-500/20 dark:text-blue-300',
    dot: 'bg-blue-800 dark:bg-blue-600',
    row: '[&>td]:!bg-blue-800/30 dark:[&>td]:!bg-blue-600/35 [--row-bar:theme(colors.blue.800)] dark:[--row-bar:theme(colors.blue.600)]',
  },
  forest: {
    tag: 'bg-green-700/15 text-green-800 ring-green-700/35 dark:bg-green-500/20 dark:text-green-300',
    dot: 'bg-green-700 dark:bg-green-600',
    row: '[&>td]:!bg-green-700/30 dark:[&>td]:!bg-green-600/35 [--row-bar:theme(colors.green.700)] dark:[--row-bar:theme(colors.green.600)]',
  },
  gold: {
    tag: 'bg-yellow-400/25 text-yellow-800 ring-yellow-500/40 dark:bg-yellow-400/20 dark:text-yellow-200',
    dot: 'bg-yellow-400',
    row: '[&>td]:!bg-yellow-400/40 dark:[&>td]:!bg-yellow-400/30 [--row-bar:theme(colors.yellow.400)]',
  },
  plum: {
    tag: 'bg-purple-800/15 text-purple-900 ring-purple-800/35 dark:bg-purple-500/20 dark:text-purple-300',
    dot: 'bg-purple-800 dark:bg-purple-600',
    row: '[&>td]:!bg-purple-800/30 dark:[&>td]:!bg-purple-600/35 [--row-bar:theme(colors.purple.800)] dark:[--row-bar:theme(colors.purple.600)]',
  },
  brown: {
    tag: 'bg-amber-800/15 text-amber-900 ring-amber-800/35 dark:bg-amber-700/25 dark:text-orange-200',
    dot: 'bg-amber-800 dark:bg-amber-700',
    row: '[&>td]:!bg-amber-800/30 dark:[&>td]:!bg-amber-700/40 [--row-bar:theme(colors.amber.800)] dark:[--row-bar:theme(colors.amber.700)]',
  },
  cyan: {
    tag: 'bg-cyan-500/15 text-cyan-800 ring-cyan-500/35 dark:text-cyan-300',
    dot: 'bg-cyan-400',
    row: '[&>td]:!bg-cyan-400/35 dark:[&>td]:!bg-cyan-400/30 [--row-bar:theme(colors.cyan.400)]',
  },
  pink: {
    tag: 'bg-pink-400/20 text-pink-700 ring-pink-400/40 dark:text-pink-300',
    dot: 'bg-pink-400',
    row: '[&>td]:!bg-pink-400/35 dark:[&>td]:!bg-pink-400/30 [--row-bar:theme(colors.pink.400)]',
  },
  olive: {
    tag: 'bg-lime-700/15 text-lime-900 ring-lime-700/35 dark:bg-lime-600/20 dark:text-lime-200',
    dot: 'bg-lime-700 dark:bg-lime-600',
    row: '[&>td]:!bg-lime-700/30 dark:[&>td]:!bg-lime-600/35 [--row-bar:theme(colors.lime.700)] dark:[--row-bar:theme(colors.lime.600)]',
  },
};

/**
 * The solid bar at a coloured row's START edge — the right in Arabic, the left in English — in the
 * row's `--row-bar` (`SHIFT_TYPE_TONE[c].row`): an inset shadow on the first cell, drawn over its
 * tint and taking no width from the table.
 */
export const ROW_BAR =
  'ltr:[&>td:first-child]:[box-shadow:inset_5px_0_0_0_var(--row-bar)] rtl:[&>td:first-child]:[box-shadow:inset_-5px_0_0_0_var(--row-bar)]';

/**
 * The marks drawn straight on a row's cells, legible on every tint (Round 24b — a typed row is tinted
 * by itself now, so most rows are): on a coloured row each stands on the page's own colour, opaque,
 * as a marked chip does (its halo), so the tint under it never decides its contrast.
 *   · `short` — «ينقصها…», the crew short of its minimum: the board's ONLY sign of it (the server
 *     never refuses a short crew). amber-600 — 3.2:1 on white, a graphic's 3:1 — where amber-500 was
 *     2.2:1 on white and 1.4:1 on a rose row; amber-400 in dark. On a coloured row a disc of the
 *     page's colour, with a hair of it around;
 *   · `pick` — an empty slot's «+ اختيار …»: quiet slate-400 on a plain row, as since Round 22; on a
 *     coloured row the page's colour under slate-600 (7.6:1; slate-400 fell to 1.7:1 on a rose row,
 *     1.5:1 on a navy one), slate-300 in dark.
 * The spec measures every one against the twenty tints (`type-colours.spec.tsx`).
 */
export const ON_TINT = {
  short: {
    plain: 'text-amber-600 dark:text-amber-400',
    tinted:
      'rounded-full bg-white text-amber-600 shadow-[0_0_0_2px_#fff] dark:bg-[#0b1226] dark:text-amber-400 dark:shadow-[0_0_0_2px_#0b1226]',
  },
  pick: {
    plain: 'text-slate-400 hover:bg-brand-500/10 dark:text-slate-500',
    tinted: 'bg-white text-slate-600 hover:bg-brand-50 dark:bg-[#0b1226] dark:text-slate-300 dark:hover:bg-[#16203a]',
  },
} as const;

/** A crew row drawn in a palette colour: its tint, and the bar at its start. */
export const rowTint = (colour: OperationsShiftTypeColour): string =>
  cn(SHIFT_TYPE_TONE[colour].row, ROW_BAR);

/**
 * A type's name in the reader's language. The catalog's Arabic name is the type's name; the
 * English one is optional (the areas' rule), so an English reader reads the Arabic name where
 * none was given rather than a blank.
 */
export const shiftTypeName = (type: OperationsShiftTypeDto, locale: Locale): string =>
  locale === 'en' && type.nameEn !== null ? type.nameEn : type.name;

/**
 * The type's dot — the colour alone, beside a name written in the box's own text colour. Its size
 * is a prop, not a class a caller adds: `cn` is a plain joiner, so a second `h-*` would land beside
 * this one and Tailwind's emission order would pick.
 */
export const ShiftTypeDot = ({
  colour,
  size = 'md',
}: {
  colour: OperationsShiftTypeColour;
  size?: 'sm' | 'md';
}): JSX.Element => (
  <span
    aria-hidden
    data-type-dot={colour}
    className={cn(
      'shrink-0 rounded-full',
      size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5',
      SHIFT_TYPE_TONE[colour].dot,
    )}
  />
);

/**
 * A type as a tag — in a list (`sm`), and on the reference screen (`md`, a size up). The size is a
 * prop for the dot's reason: one font size ever reaches the element.
 */
export const ShiftTypeTag = ({
  type,
  locale,
  size = 'sm',
  className,
}: {
  type: OperationsShiftTypeDto;
  locale: Locale;
  size?: 'sm' | 'md';
  /** Layout only — how the tag sits where it is put (`max-w-full`), never its look. */
  className?: string;
}): JSX.Element => (
  <span
    className={cn(
      'inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-black ring-1 ring-inset',
      size === 'md' ? 'text-[13px]' : 'text-[11.5px]',
      SHIFT_TYPE_TONE[type.colour].tag,
      className,
    )}
  >
    <span
      aria-hidden
      className={cn('h-2 w-2 shrink-0 rounded-full', SHIFT_TYPE_TONE[type.colour].dot)}
    />
    <span className="min-w-0 truncate">{shiftTypeName(type, locale)}</span>
  </span>
);
