// Operations data migrations — idempotent, boot-time, non-destructive.
//
// The crew slots turned from one person each into a list of up to `CREW_SLOT_CAPACITY`
// (`crew-assignment.model.ts`). This converts what is already in the database, under the same
// three rules `fleet.migration.ts` established:
//
//   1. NOTHING IS DELETED. The pre-capacity `captainEmployeeId` / `specialist1EmployeeId` /
//      `specialist2EmployeeId` columns keep exactly the values they were written with; only the
//      new list columns are filled in. The old value stays as the evidence of what was converted.
//   2. NOTHING IS INVENTED. A row with an empty slot gets an EMPTY LIST, not a placeholder. The
//      distinction between "nobody is assigned" and "one person is assigned" survives the move.
//   3. RE-RUNNING CHANGES NOTHING. Only rows that have no list yet are touched, so a second boot
//      writes nothing — and, crucially, a row an operator has since edited to hold two captains is
//      never revisited and never collapsed back to one.
//
// Rule 3 is what makes this safe to leave in the boot path forever. The query is "has no list
// field", not "the list disagrees with the scalar": the scalar is frozen at its pre-migration
// value, so a disagreement is the NORMAL state of every row edited after the migration ran, and a
// migration that reconciled them would undo real work on every restart.
import { type Types } from 'mongoose';
import { logger } from '../../infrastructure/logging/logger';
import {
  OperationsCrewAssignmentModel,
  type OperationsCrewAssignmentDoc,
} from './crew/crew-assignment.model';

/**
 * A pre-capacity row as it comes back from `lean()`.
 *
 * The three scalars are typed HERE and nowhere else. The document schema no longer maps them —
 * that is what stops the rest of the module reading a column that is frozen — but the values are
 * still in the collection, and `lean()` hands back the raw BSON, so this file can still see what
 * it has to convert. Reading a retired column is exactly this file's job and no one else's.
 */
type PendingCrewRow = {
  _id: unknown;
  captainEmployeeId?: Types.ObjectId | null;
  specialist1EmployeeId?: Types.ObjectId | null;
  specialist2EmployeeId?: Types.ObjectId | null;
} & Partial<
  Pick<
    OperationsCrewAssignmentDoc,
    'captainEmployeeIds' | 'specialist1EmployeeIds' | 'specialist2EmployeeIds'
  >
>;

const SLOTS = [
  ['captainEmployeeIds', 'captainEmployeeId'],
  ['specialist1EmployeeIds', 'specialist1EmployeeId'],
  ['specialist2EmployeeIds', 'specialist2EmployeeId'],
] as const;

/**
 * Back-fill the crew lists from the pre-capacity single-occupant columns.
 *
 * A row is pending when ANY of the three lists is absent — the three are converted independently,
 * so a half-converted row (a crash mid-run, or a field added by a later slice) completes on the
 * next boot instead of being skipped for having one list already.
 */
const BATCH = 500;

export const migrateCrewSlotsToArrays = async (): Promise<{ rowsUpdated: number }> => {
  // A crew row exists per (operating day, vehicle), so the backlog grows with the calendar. Read
  // and write in batches rather than pulling the whole history into memory at boot: this runs
  // before the process accepts its first request (server.ts awaits bootPlatform before listen), so
  // a long unbounded read here is downtime, not background work.
  //
  // The batch loop terminates because every write REMOVES its rows from the pending query — the
  // condition is "has no list field", and each pass writes that field. A row that somehow failed
  // to update would be re-read forever, so the loop also stops when a pass changes nothing.
  const projection = {
    _id: 1,
    captainEmployeeId: 1,
    specialist1EmployeeId: 1,
    specialist2EmployeeId: 1,
    captainEmployeeIds: 1,
    specialist1EmployeeIds: 1,
    specialist2EmployeeIds: 1,
  };
  const pendingFilter = { $or: SLOTS.map(([list]) => ({ [list]: { $exists: false } })) };

  let rowsUpdated = 0;
  // A CURSOR, not a re-query from the start. Without one, every pass re-scans the whole collection
  // — the converted prefix included — so a large backlog is quadratic, and it is quadratic in the
  // one place that cannot afford it: boot, before `app.listen`.
  let after: unknown = null;
  for (;;) {
    // `isDeleted` is deliberately NOT filtered. A soft-deleted crew row is still readable history —
    // the captain report and the audit trail both reach it — and leaving it on the old shape would
    // make it the one row whose crew a widened reader cannot see.
    const pending = await OperationsCrewAssignmentModel.find(
      after === null ? pendingFilter : { $and: [pendingFilter, { _id: { $gt: after } }] },
      projection,
    )
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean<PendingCrewRow[]>()
      .exec();
    if (pending.length === 0) break;
    // Advance unconditionally, on the LAST id read rather than the last id written. A row this
    // pass could not convert must not be read again next pass, or the loop stalls on it forever.
    after = pending[pending.length - 1]?._id ?? after;

    const operations = pending.flatMap((row) => {
      const set: Record<string, unknown[]> = {};
      for (const [list, scalar] of SLOTS) {
        if (row[list] !== undefined) continue; // already converted — rule 3
        const occupant = row[scalar];
        set[list] = occupant === null || occupant === undefined ? [] : [occupant];
      }
      if (Object.keys(set).length === 0) return [];
      return [
        {
          updateOne: {
            // The filter REPEATS the pending condition rather than trusting the read. Between the
            // find and the write, a concurrent plan could have filled this row's lists; without
            // this, the migration would overwrite a live edit with a value derived from a frozen
            // column. `$exists: false` on the very fields being written makes the write a no-op in
            // exactly that case.
            filter: { _id: row._id, ...pendingFilter },
            update: { $set: set },
            // Timestamps OFF. `updatedAt` records when a human last changed this crew; a migration
            // did not change the crew, it changed how the crew is stored. Restamping every
            // historical row would erase the real answer to "when was this last edited" across the
            // entire collection, and nothing would be able to recover it.
            timestamps: false,
          },
        },
      ];
    });
    if (operations.length === 0) break;

    const result = await OperationsCrewAssignmentModel.bulkWrite(operations);
    // A batch that modified NOTHING is not a stall and must not stop the run. Two processes boot
    // together — api and worker — read the same rows, and whichever writes first makes the other's
    // updates no-op against the repeated `$exists: false` guard. Treating that as "no progress"
    // aborted the loser mid-collection and left the rest of the backlog unconverted. The cursor is
    // what makes termination safe without this: it advances whether or not a write landed.
    rowsUpdated += result.modifiedCount;
    if (pending.length < BATCH) break;
  }

  if (rowsUpdated > 0) {
    logger.info(
      { rowsUpdated },
      'operations: crew slots migrated from single occupants to lists',
    );
  }
  return { rowsUpdated };
};

export const runOperationsMigrations = async (): Promise<void> => {
  await migrateCrewSlotsToArrays();
};
