// Dragging a reference-data list into order — «اعملى فى شاشة البيانات المرجعية ان اقدر اعدل زى شاشة
// الحركة بالظبط» (the currencies tab). The same rules Fleet's catalogs page applies inline
// (fleet/pages/CatalogsPage.tsx `move` / `step`), as pure functions so they are asserted directly.
//
// NOT SHARED WITH FLEET'S PAGE: there the rules live inside the component, and lifting them out
// would change a screen the owner has signed off for a list this one only copies. Same behaviour,
// one more caller: if a third list needs it, that is the time to move both onto this file.

/**
 * The order after dragging `fromId` onto `toId`, or null when nothing moves (dropped on itself, or
 * an id the list does not hold). Fleet's rule: dropped ON a row, it takes that row's place — above
 * it when moving up, below it when moving down — so the row lands exactly where it was dropped.
 */
export const moveInOrder = (
  ids: readonly string[],
  fromId: string,
  toId: string,
): string[] | null => {
  if (fromId === toId) return null;
  const from = ids.indexOf(fromId);
  const target = ids.indexOf(toId);
  if (from === -1 || target === -1) return null;
  const next = ids.filter((id) => id !== fromId);
  const at = next.indexOf(toId);
  next.splice(from < target ? at + 1 : at, 0, fromId);
  return next;
};

/**
 * One step up (-1) or down (+1) — the arrow buttons, which are how a keyboard (or a hand that
 * cannot drag) moves a row: the row it passes takes its old place. Null at either end.
 */
export const stepInOrder = (ids: readonly string[], id: string, by: -1 | 1): string[] | null => {
  const at = ids.indexOf(id);
  const neighbour = ids[at + by];
  return at === -1 || neighbour === undefined ? null : moveInOrder(ids, id, neighbour);
};

/**
 * The rows as the screen shows them while a dropped order is being saved: in `pending`'s order at
 * once, before the server answers — then the server's own order once `pending` is let go of. A row
 * the pending order does not name (one added from another screen meanwhile) is KEPT, after the
 * named ones in its own order — never dropped from the list for the moment the save takes.
 */
export const inPendingOrder = <T extends { id: string }>(
  items: readonly T[],
  pending: readonly string[] | null,
): T[] => {
  if (pending === null) return [...items];
  const byId = new Map(items.map((item) => [item.id, item]));
  const named = pending.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
  const placed = new Set(pending);
  return [...named, ...items.filter((item) => !placed.has(item.id))];
};
