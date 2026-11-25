// The order the done pages read a day range in, and the indexes that hold it — ONE definition for
// both operation logs (replenishments and maintenances share one repository), so the sort the
// done read asks for and the keys the index holds cannot drift apart.
//
// Why it exists (the hang of 2026-11-25): the done read sorts by close time and then `_id` — the
// tiebreak every paged list closes its sort with — but the only close-time index was
// `{ branchId: 1, closedAt: -1 }`. It finds the range, but not in that order, so every read SORTED
// THE WHOLE RANGE IN MEMORY before skipping to its page: 29,500 rows read and sorted for each page
// of a branch's month. With the order in the index, a read walks the range already sorted and
// stops at its limit.

/** Close time ascending, then `_id` — the done pages' order (`listDone`, `listDoneBoard`). */
export const DONE_ORDER = { closedAt: 1, _id: 1 } as const;

/** A company-wide reader's index: no branch filter, the range in the done order. */
export const DONE_RANGE_INDEX_NAME = 'ix_done_range';

/** A branch reader's index — most ATM staff: one sorted range per branch in scope. */
export const BRANCH_DONE_RANGE_INDEX_NAME = 'ix_branch_done_range';

/**
 * The rows the indexes hold: the live ones (`isDeleted: false` comes from `baseFilter`, which is
 * what lets the planner use a partial index for the read). Open rows (`closedAt: null`) sort first
 * and fall outside any range. A fresh object per call — Mongoose keeps the options it is handed.
 */
export const doneRangeIndexFilter = (): Record<string, unknown> => ({ isDeleted: false });

/** The company-wide index keys: the done order itself. */
export const doneRangeIndexKeys = (): Record<string, 1 | -1> => ({ ...DONE_ORDER });

/** The branch index keys: `branchId` first, then the done order. */
export const branchDoneRangeIndexKeys = (): Record<string, 1 | -1> => ({
  branchId: 1,
  ...DONE_ORDER,
});
