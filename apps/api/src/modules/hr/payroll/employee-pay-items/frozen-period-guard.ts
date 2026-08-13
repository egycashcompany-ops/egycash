// The freeze guard for backdated pay (PY-9). PURE.
//
// THE HOLE IT CLOSES. A payroll run freezes a period so the figures priced from it cannot move.
// Attendance rows are stamped, leave consumptions are pinned — and then an assignment could be
// created with `effectiveFrom` reaching back INSIDE that month, and the month's calculation would
// answer differently the next time anybody asked. Nothing refused it.
//
// WHY ONLY CREATION. Ending an assignment cannot reach backwards: `remove` closes an in-force row
// as of TODAY and deletes a not-yet-started one outright, so neither touches a period that has
// already ended. There is no update endpoint at all. Creation was the whole hole, and this is the
// whole fix — no other rule about pay items changes.
//
// WHAT IT IS NOT. Not an unfreeze, and not a claim that the past may never be corrected: a
// cancelled run releases its period (PY-6's "recalculate with a new run"), and this guard follows
// that exactly — it blocks on runs that are still frozen, so cancelling one re-opens the month for
// the correction and the new run that will re-pin it.

/** `YYYY-MM` for a date. The same key a run's `period` carries. */
export const periodKeyOf = (date: Date): string =>
  `${String(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * The frozen period this interval would reach into, or null when it reaches none.
 *
 * `YYYY-MM` keys compare lexicographically exactly as they compare chronologically, so the whole
 * test is two string comparisons per period — and an open-ended interval (`to: null`) simply has
 * no upper bound to fail.
 *
 * Returns the EARLIEST one, because that is the month a reader should be told about first when an
 * interval spans several.
 */
export const blockingFrozenPeriod = (
  frozenPeriods: readonly string[],
  from: Date,
  to: Date | null,
): string | null => {
  const start = periodKeyOf(from);
  const end = to === null ? null : periodKeyOf(to);
  const touched = frozenPeriods.filter(
    (period) => period >= start && (end === null || period <= end),
  );
  return touched.length === 0 ? null : [...touched].sort()[0] ?? null;
};
