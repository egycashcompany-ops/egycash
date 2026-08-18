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
export const migrateCrewSlotsToArrays = async (): Promise<{ rowsUpdated: number }> => {
  const pending = await OperationsCrewAssignmentModel.find(
    {
      $or: SLOTS.map(([list]) => ({ [list]: { $exists: false } })),
    },
    {
      _id: 1,
      captainEmployeeId: 1,
      specialist1EmployeeId: 1,
      specialist2EmployeeId: 1,
      captainEmployeeIds: 1,
      specialist1EmployeeIds: 1,
      specialist2EmployeeIds: 1,
    },
  )
    .lean<PendingCrewRow[]>()
    .exec();
  if (pending.length === 0) return { rowsUpdated: 0 };

  // `isDeleted` is deliberately NOT filtered. A soft-deleted crew row is still readable history —
  // the captain report and the audit trail both reach it — and leaving it on the old shape would
  // make it the one row whose crew a widened reader cannot see.
  const operations = pending.flatMap((row) => {
    const set: Record<string, unknown[]> = {};
    for (const [list, scalar] of SLOTS) {
      if (row[list] !== undefined) continue; // already converted — rule 3
      const occupant = row[scalar];
      set[list] = occupant === null || occupant === undefined ? [] : [occupant];
    }
    if (Object.keys(set).length === 0) return [];
    return [{ updateOne: { filter: { _id: row._id }, update: { $set: set } } }];
  });
  if (operations.length === 0) return { rowsUpdated: 0 };

  const result = await OperationsCrewAssignmentModel.bulkWrite(operations);
  const rowsUpdated = result.modifiedCount;
  logger.info(
    { rowsUpdated, pending: pending.length },
    'operations: crew slots migrated from single occupants to lists',
  );
  return { rowsUpdated };
};

export const runOperationsMigrations = async (): Promise<void> => {
  await migrateCrewSlotsToArrays();
};
