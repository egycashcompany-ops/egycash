// The order the open boards are read in, and the index that reads them in it — ONE definition for
// both operation logs (replenishments and maintenances share one lifecycle and one repository,
// operation-log.repository.ts), so the sort the board asks for and the keys the index holds can
// never drift apart: a sort the index does not hold is an in-memory sort of every open row.

/**
 * The board order: area descending — the legacy `.sort({ area: -1 })` of every board variant
 * (contad_app.js:263 / :1100) — then `_id` descending, the tiebreak the paged list closes the same
 * sort with (`BaseRepository.list`), so the board read and the paged list agree row for row.
 */
export const OPEN_BOARD_ORDER = { area: -1, _id: -1 } as const;

/** The index's name — the boot index step builds by name (atm-indexes.ts). */
export const OPEN_BOARD_INDEX_NAME = 'ix_open_board';

/**
 * The rows the index holds: open and not deleted — exactly the board's predicate (`closedAt: null`
 * from the repository, `isDeleted: false` from `baseFilter`), which is what lets the planner use a
 * partial index for it. A fresh object per call — Mongoose keeps the options it is handed.
 */
export const openBoardIndexFilter = (): Record<string, unknown> => ({
  closedAt: null,
  isDeleted: false,
});

/** The index keys, as a fresh object for `schema.index` — the board order itself. */
export const openBoardIndexKeys = (): Record<string, 1 | -1> => ({ ...OPEN_BOARD_ORDER });

/** The branch callers' index — the same rows and order, led by the branch (boot-built by name). */
export const BRANCH_OPEN_BOARD_INDEX_NAME = 'ix_branch_open_board';

/**
 * The index keys for a branch reader — most ATM staff: `branchId` first, then the board order. A
 * reader of one branch is one range of it, already sorted; a reader of several is one range per
 * branch, merged in order (SORT_MERGE). `ix_branch_open_area` holds the branch and the area but not
 * `_id`, so the board's tiebreak was an in-memory sort of the branch's open rows — and with
 * `ix_open_board` beside it the planner could take the company-wide index and drop every other
 * branch's rows one by one instead.
 */
export const branchOpenBoardIndexKeys = (): Record<string, 1 | -1> => ({
  branchId: 1,
  ...OPEN_BOARD_ORDER,
});
