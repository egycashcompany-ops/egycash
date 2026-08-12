// The pure core of the organize board: what a drag or an arrow press MEANS, expressed as list
// operations over ids. No DOM, no React, no requests — so the part that is easy to get subtly
// wrong (an off-by-one when moving a row down, a move onto itself, a drop into the bucket it came
// from) is the part that is fully unit-testable.
//
// Every operation returns the ids of ONE bucket in their new order. That is exactly the payload
// the reorder endpoints take, and it is why the whole feature needs no `order` field in the UI:
// position in a list is the only thing anybody edits.

/** A bucket is a section's id, or `null` for the rows that hang directly off the module. */
export type BucketId = string | null;

export interface Board {
  /** Ordered ids per bucket, keyed by section id and by `''` for the unsectioned bucket. */
  buckets: Record<string, string[]>;
}

export const bucketKey = (bucket: BucketId): string => bucket ?? '';

/** Move an item within one list. Out-of-range or no-op moves return the list unchanged. */
export const moveWithin = (ids: string[], from: number, to: number): string[] => {
  if (from === to || from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (item === undefined) return ids;
  next.splice(to, 0, item);
  return next;
};

/** Up/Down — the keyboard-and-mouse alternative to dragging, and the accessible one. */
export const moveBy = (ids: string[], id: string, delta: -1 | 1): string[] => {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  return moveWithin(ids, from, from + delta);
};

/**
 * A drop: `id` lands in `target` at `index` (append when index is null or past the end).
 *
 * Returns BOTH affected buckets, because a cross-bucket drop is two writes — the row leaves one
 * list and joins another — and the caller must send both to keep the two ends consistent.
 */
export const dropInto = (
  board: Board,
  id: string,
  source: BucketId,
  target: BucketId,
  index: number | null,
): { source: BucketId; target: BucketId; sourceIds: string[]; targetIds: string[] } => {
  const from = board.buckets[bucketKey(source)] ?? [];
  const to = board.buckets[bucketKey(target)] ?? [];

  if (bucketKey(source) === bucketKey(target)) {
    const at = index === null ? from.length - 1 : Math.min(index, from.length - 1);
    const ids = moveWithin(from, from.indexOf(id), at);
    return { source, target, sourceIds: ids, targetIds: ids };
  }

  const sourceIds = from.filter((x) => x !== id);
  const targetIds = [...to.filter((x) => x !== id)];
  targetIds.splice(index === null ? targetIds.length : Math.min(index, targetIds.length), 0, id);
  return { source, target, sourceIds, targetIds };
};

/** Sections are one flat list; moving one is the same operation without the bucket question. */
export const moveSection = (ids: string[], id: string, delta: -1 | 1): string[] =>
  moveBy(ids, id, delta);

export const dropSection = (ids: string[], id: string, index: number | null): string[] => {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const at = index === null ? ids.length - 1 : Math.min(index, ids.length - 1);
  return moveWithin(ids, from, at);
};
