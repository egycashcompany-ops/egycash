// A stable colour per VEHICLE, so a hundred rows of near-identical numbers can be told apart.
//
// The board is scanned, not read. Codes like 150 / 151 / 152 differ by one glyph, and a
// dispatcher looking for one car runs their eye down a column of them. A colour attached to the
// car is something the eye can land on before it has finished reading the digits.
//
// DERIVED FROM THE VEHICLE'S OWN ID, never from its position. The row order changes constantly —
// the board is filtered by a search box and by mission — and a colour that came from an array
// index would repaint the whole fleet every time somebody typed a letter, which is worse than no
// colour at all: it would look like the data had changed. Hashing the id means a car's colour is
// a property OF THE CAR: the same on every render, in every filter, on every screen that chooses
// to use it, and unaffected by adding, removing or reordering any other vehicle.
//
// The palette is the project's own Tailwind scale, in the pairing the rest of the app uses for
// tinted chips: a 100-level fill with 800-level text in light mode, and a 900/40 fill with
// 200-level text in dark. Both directions are chosen for CONTRAST rather than vividness — this
// is a label behind a vehicle code, and the code has to stay the most legible thing in the cell.

/**
 * The palette. Ten hues that stay distinguishable side by side, and — deliberately — none of the
 * semantic ones this module already spends elsewhere: no red (an alarm), no emerald (a driver
 * chip, a healthy state), no amber (unsaved changes). A vehicle's colour identifies it; it must
 * never be read as a verdict about it.
 */
export const VEHICLE_COLOURS = [
  'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200',
  'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200',
  'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
] as const;

/**
 * FNV-1a, 32-bit. A hash rather than `charCodeAt` summed, because a sum collides on anagrams —
 * and ObjectIds differing only in the order of two hex digits are exactly that. Written out
 * rather than pulled in: it is six lines and this is the only thing in the app that needs one.
 *
 * `>>> 0` after each step keeps it in unsigned 32-bit range; without it the multiply drifts into
 * the float range where the low bits — the only ones that survive the modulo — stop being
 * reliable.
 */
const hash = (value: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/**
 * The Tailwind classes for one vehicle's colour chip.
 *
 * Deterministic: the same id always answers the same way, in this process and the next. More
 * vehicles than colours is expected and handled by cycling — with 105 cars and ten hues, roughly
 * ten share each, which is still enough to break up a column at a glance. Cycling by hash rather
 * than by position also means adding a vehicle does not shift anybody else's colour.
 *
 * An empty id answers with the last (neutral) entry rather than throwing: a colour is decoration,
 * and a missing id is not worth failing a render over.
 */
export const vehicleColour = (vehicleId: string): string => {
  if (vehicleId === '') return VEHICLE_COLOURS[VEHICLE_COLOURS.length - 1] as string;
  return VEHICLE_COLOURS[hash(vehicleId) % VEHICLE_COLOURS.length] as string;
};
