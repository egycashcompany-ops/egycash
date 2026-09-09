// A stable colour per driver-violation type.
//
// The board lists «سرعة», «عكس», «حزام», «تليفون» in one column of identical grey text, so telling
// them apart means READING every row. A colour lets a reader see the shape of a day's fines at a
// glance — which is the question this half of the screen is actually asked.
//
// Derived from the type's ID rather than stored on it, deliberately. The types are a catalog an
// admin edits, so a hard-coded map would leave any type added tomorrow uncoloured, and a colour
// column on the catalog would be a schema change for a decoration. Hashing the id gives every type
// a colour that is stable across reloads, machines and readers, and gives a NEW type one for free.
//
// The palette is fixed and small on purpose: eight hues that stay legible on both themes and are
// distinguishable from each other. Beyond eight the colours repeat, which is honest — a colour is
// a hint here, never the identity, and the name is always written beside it.
const PALETTE = [
  'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800',
  'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800',
  'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800',
  'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800',
  'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800',
  'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-200 dark:border-cyan-800',
  'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-800',
  'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800',
] as const;

/** A neutral for "no type" — an unclassified row must not borrow a real type's colour. */
const NONE =
  'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';

/**
 * The Tailwind classes for one violation type.
 *
 * Two ways to ask, and the difference matters:
 *
 *   • WITH an index — its position in the live catalog — every type up to eight gets a DIFFERENT
 *     colour, guaranteed. That is what a board of four types needs: hashing gave «سرعة» and
 *     «تليفون» the same indigo out of eight slots, and two fines that look identical are exactly
 *     what the colour was added to prevent. A caller that holds the catalog (the bar, the cards,
 *     the board) always knows the position.
 *
 *   • WITHOUT one, the id is hashed. Same id → same colour, on a caller that has a violation but
 *     not the list it came from. Distinct colours are not promised there, and cannot be: nothing
 *     in hand says how many types exist or which this is among them.
 */
export const violationTypeColour = (
  violationTypeId: string | null | undefined,
  // An OBJECT, not a bare number, and deliberately: `list.map(violationTypeColour)` hands every
  // callback the array index as its second argument, so a positional parameter here would silently
  // turn every such call into the position form. As an object the stray number is a type error
  // instead — which is exactly how this was caught.
  options?: { index?: number | undefined },
): string => {
  if (violationTypeId === null || violationTypeId === undefined || violationTypeId === '') {
    return NONE;
  }
  const index = options?.index;
  if (index !== undefined && index >= 0) return PALETTE[index % PALETTE.length] as string;
  let hash = 0;
  for (let i = 0; i < violationTypeId.length; i += 1) {
    hash = (hash * 31 + violationTypeId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length] as string;
};
