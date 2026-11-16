// «ألوان الأنواع» — the one palette of «لوحة التشغيلة» (Round 24b), as pure rules.
//
// THE OWNER: «عاوز pallett الالوان يكون على عدد الالوان يكون نفس عدد النوع وعاوز فوق خالص جمب الطاقم
// الثابت لما ادوس عليها يفتح كارد زى جدول اقدر ادى كل نوع لون من الالوان وعاوز اللون فى الجدول يكون
// متشبع اكتر من كدا». Then, asked: a row's colour — «تلقائي ويتغيّر يدوي»; two types one colour —
// «أيوه عادي».
//
//   · ONE PALETTE (`OPERATIONS_SHIFT_TYPE_COLOURS`, ordered, twenty): what is SHOWN is N of its
//     colours, N being the number of live types — as many swatches as there are types: EVERY colour
//     a live type wears, then the first colours nobody live wears until there are N, all in the
//     palette's order (`paletteFor`). Never «the first N»: archiving a type early in the list would
//     have pushed a live type's colour off the palette and shown the archived one's, which nobody
//     wears. Past twenty types the whole list is shown (`paletteOverflow` says so).
//   · A ROW'S COLOUR is its own, picked by hand, OVER its type's: `rowColour ?? the type's colour ??
//     none` (`resolveRowColour`). The «اللون» list offers the shown swatches and «لون النوع» (the
//     override taken off). An override no longer among the shown swatches (types archived or
//     recoloured since) still colours the row, and the list shows it as the current one
//     (`rowColourChoices`).
//   · Two types may share a colour: nothing here assumes a colour names one type
//     (`colourWearers` lists every one).
import {
  OPERATIONS_SHIFT_TYPE_COLOURS,
  type OperationsCrewRowColour,
  type OperationsShiftTypeColour,
  type OperationsShiftTypeDto,
} from '@ecms/contracts';

export type PaletteColour = OperationsShiftTypeColour;

/** The palette in full, in its order. */
export const PALETTE: readonly PaletteColour[] = OPERATIONS_SHIFT_TYPE_COLOURS;

/**
 * Where the catalog's read stands. The palette is built from the types, so «no types, no colours» is
 * said only once the list has ANSWERED with none: before that it is loading, and a read that failed
 * with nothing in hand says so and offers another try — never «no active types» while nine exist.
 * A re-read that fails while a list is in hand keeps that list (`ready`).
 */
export type CatalogState = 'loading' | 'failed' | 'ready';

export const catalogStateOf = (read: { data?: unknown; isError: boolean }): CatalogState =>
  read.data !== undefined ? 'ready' : read.isError ? 'failed' : 'loading';

/** The live types — not archived. What the palette's size counts. */
export const liveTypes = (types: readonly OperationsShiftTypeDto[]): OperationsShiftTypeDto[] =>
  types.filter((type) => type.isActive);

/**
 * The swatches shown for this catalog: as many as its live types (plus `adding`, the types a form is
 * about to add — the catalog's form for a new type counts it: N + 1), never more than the palette
 * holds. Which ones: EVERY colour a live type wears — a live type is never off the palette — then
 * the palette's first colours nobody live wears, until there are that many; all in the palette's
 * order. Two types sharing a colour leave room for one more unworn swatch.
 */
export const paletteFor = (
  types: readonly OperationsShiftTypeDto[],
  adding = 0,
): PaletteColour[] => {
  const live = liveTypes(types);
  const count = Math.max(
    0,
    Math.min(live.length + Math.max(0, Math.floor(adding)), PALETTE.length),
  );
  const worn = new Set<PaletteColour>(live.map((type) => type.colour));
  let unworn = Math.max(0, count - worn.size);
  return PALETTE.filter((colour) => {
    if (worn.has(colour)) return true;
    if (unworn === 0) return false;
    unworn -= 1;
    return true;
  });
};

/** More live types than the palette has colours: every colour is shown, and some types share. */
export const paletteOverflow = (types: readonly OperationsShiftTypeDto[]): boolean =>
  liveTypes(types).length > PALETTE.length;

/** A type's colour, by id — an archived type's too (a row may still hold it); null for none. */
export const typeColourOf = (
  types: readonly OperationsShiftTypeDto[],
  shiftTypeId: string | null,
): PaletteColour | null =>
  shiftTypeId === null ? null : (types.find((type) => type.id === shiftTypeId)?.colour ?? null);

/** Where a row's colour comes from: picked by hand on the row, its type's, or none at all. */
export type RowColourSource = 'row' | 'type' | null;

/**
 * The colour a row is drawn in — «تلقائي ويتغيّر يدوي»: the one picked by hand on the row, else its
 * type's, else none.
 */
export const resolveRowColour = (
  rowColour: OperationsCrewRowColour | null,
  typeColour: PaletteColour | null,
): { colour: PaletteColour | null; source: RowColourSource } =>
  rowColour !== null
    ? { colour: rowColour, source: 'row' }
    : typeColour !== null
      ? { colour: typeColour, source: 'type' }
      : { colour: null, source: null };

/**
 * The live types that wear a colour — every one (two may share), in the catalog's order. What a
 * swatch's tooltip names.
 */
export const colourWearers = (
  types: readonly OperationsShiftTypeDto[],
  colour: PaletteColour,
): OperationsShiftTypeDto[] => liveTypes(types).filter((type) => type.colour === colour);

/** One swatch of a row's «اللون» list. */
export interface RowColourChoice {
  colour: PaletteColour;
  /** Not among the swatches shown now — the row's own override, kept and shown as current. */
  outside: boolean;
}

/**
 * What a row's «اللون» list offers: exactly the swatches shown — plus, at the end, the row's own
 * override when it is not among them any more (the type that wore it archived or recoloured): it still
 * colours the row, and the list must be able to say it is the current one.
 */
export const rowColourChoices = (
  palette: readonly PaletteColour[],
  current: OperationsCrewRowColour | null,
): RowColourChoice[] => [
  ...palette.map((colour) => ({ colour, outside: false })),
  ...(current !== null && !palette.includes(current) ? [{ colour: current, outside: true }] : []),
];

/** Is a type's colour among the swatches shown? (The card marks one that is not.) */
export const inPalette = (palette: readonly PaletteColour[], colour: PaletteColour): boolean =>
  palette.includes(colour);

/**
 * The first colour of the shown palette no live type wears yet — a NEW type starts told apart from
 * the others; all worn (or shared), the first of the palette. The palette a new type sees counts it
 * already (N + 1), so it always holds an unworn colour while the palette has one.
 */
export const freeColourFor = (types: readonly OperationsShiftTypeDto[]): PaletteColour => {
  const worn = new Set(liveTypes(types).map((type) => type.colour));
  return paletteFor(types, 1).find((colour) => !worn.has(colour)) ?? PALETTE[0] ?? 'rose';
};

/**
 * What a press on a swatch of «ألوان الأنواع» does:
 *   · `none`   — read only (no `operationsCatalog.manage`), or another type's colour is on its way;
 *   · `save`   — a colour the card does not show the type in: the catalog's PATCH, at the version read;
 *   · `reread` — the colour the card ALREADY shows it in. The card's list may be older than the
 *     server's (another desk recoloured it since): the types are read again rather than nothing
 *     done, and the card says so when the server's colour was another — the next press then saves.
 *     No save is sent: it would change nothing but the version.
 */
export type SwatchPress = 'none' | 'save' | 'reread';

export const swatchPress = (
  shown: PaletteColour,
  pressed: PaletteColour,
  { canEdit, busy }: { canEdit: boolean; busy: boolean },
): SwatchPress => (!canEdit || busy ? 'none' : shown === pressed ? 'reread' : 'save');

/**
 * The arrows in a grid of swatches — where the focus goes from `at` of `count`, `columns` a row:
 * along a line by ←/→ (the reading direction: in Arabic ← is the NEXT swatch), across lines by ↑/↓;
 * Home and End to the ends. Wraps at the ends. Null for a key that does not move it.
 */
export const gridStep = (
  key: string,
  at: number,
  count: number,
  columns: number,
  rtl: boolean,
): number | null => {
  if (count <= 0) return null;
  const wrap = (to: number): number => ((to % count) + count) % count;
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case forward:
      return wrap(at + 1);
    case back:
      return wrap(at - 1);
    case 'ArrowDown':
      return wrap(at + Math.max(1, columns));
    case 'ArrowUp':
      return wrap(at - Math.max(1, columns));
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
};
