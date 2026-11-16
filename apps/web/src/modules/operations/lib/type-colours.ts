// «ألوان الأنواع» — the one palette of «لوحة التشغيلة» (Round 24b), as pure rules.
//
// THE OWNER: «عاوز pallett الالوان يكون على عدد الالوان يكون نفس عدد النوع وعاوز فوق خالص جمب الطاقم
// الثابت لما ادوس عليها يفتح كارد زى جدول اقدر ادى كل نوع لون من الالوان وعاوز اللون فى الجدول يكون
// متشبع اكتر من كدا». Then, asked: a row's colour — «تلقائي ويتغيّر يدوي»; two types one colour —
// «أيوه عادي».
//
//   · ONE PALETTE (`OPERATIONS_SHIFT_TYPE_COLOURS`, ordered, twenty): what is SHOWN is its first N,
//     N being the number of live types — as many swatches as there are types. Past twenty types the
//     whole list is shown (`paletteOverflow` says so).
//   · A ROW'S COLOUR is its own, picked by hand, OVER its type's: `rowColour ?? the type's colour ??
//     none` (`resolveRowColour`). The «اللون» list offers the shown swatches and «لون النوع» (the
//     override taken off). An override no longer among the shown swatches (types archived since)
//     still colours the row, and the list shows it as the current one (`rowColourChoices`).
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

/** The live types — not archived. What the palette's size counts. */
export const liveTypes = (types: readonly OperationsShiftTypeDto[]): OperationsShiftTypeDto[] =>
  types.filter((type) => type.isActive);

/**
 * The swatches shown: the palette's first N, N = `count` (the live types) — never fewer than none,
 * never more than the palette holds.
 */
export const shownPalette = (count: number): PaletteColour[] =>
  PALETTE.slice(0, Math.max(0, Math.min(Math.floor(count), PALETTE.length)));

/** The swatches shown for this catalog: as many as its live types. */
export const paletteFor = (types: readonly OperationsShiftTypeDto[]): PaletteColour[] =>
  shownPalette(liveTypes(types).length);

/** More live types than the palette has colours: every colour is shown, and some types share. */
export const paletteOverflow = (types: readonly OperationsShiftTypeDto[]): boolean =>
  liveTypes(types).length > PALETTE.length;

/** A type's colour, by id — an archived type's too (a row may still hold it); null for none. */
export const typeColourOf = (
  types: readonly OperationsShiftTypeDto[],
  shiftTypeId: string | null,
): PaletteColour | null =>
  shiftTypeId === null
    ? null
    : (types.find((type) => type.id === shiftTypeId)?.colour ?? null);

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
 * The types that wear a colour — every one (two may share), in the catalog's order. The live ones,
 * plus an archived one only when asked for (`also`: the types the board still shows).
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
 * override when it is not among them any more (a type archived since shrank the palette): it still
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
 * already (N + 1).
 */
export const freeColourFor = (types: readonly OperationsShiftTypeDto[]): PaletteColour => {
  const worn = new Set(liveTypes(types).map((type) => type.colour));
  const palette = shownPalette(liveTypes(types).length + 1);
  return palette.find((colour) => !worn.has(colour)) ?? PALETTE[0] ?? 'rose';
};
