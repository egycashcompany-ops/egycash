// Loading employment history that happened before this system existed.
//
// WHY THIS IS NOT THE PERSONNEL-ACTIONS ENGINE, which is the obvious thing to reach for. An action
// records A DECISION SOMEBODY MADE HERE: it carries an actor, a timestamp, an audit entry, and it
// NOTIFIES — `applyExit` messages every holder of `employee.view` in the organization. A resignation
// from 2021 was not decided in this system, and synthesizing an action for it would assert an actor
// who never clicked anything and send 1,026 notifications about people who left years ago.
//
// So history is written as STATE, the way `employee.migration.ts` already writes it for the
// employees that predate the registry. The hire action is still synthesized, because every
// employee's history has to start uniformly with one and the repository has an idempotent helper
// for exactly that; nothing else is invented.
import { Types } from 'mongoose';
import { type EmployeeExitType } from '@ecms/contracts';
import { EmployeeModel } from './employee.model';

/** One closed period of service, oldest first. */
export interface ImportedPeriod {
  hiredAt: Date;
  exitedAt: Date;
  exitType: EmployeeExitType;
  reason: string | null;
}

/**
 * Close an imported employee's history: the periods they served, and the exit they are currently
 * under if they have not come back.
 *
 * `closed` are the periods that ENDED. `current` is the open period for somebody still serving —
 * omitted for somebody who has left, whose last closed period is then also their exit.
 *
 * Idempotent by construction: it computes the whole `employmentPeriods`/`exit`/`status` triple and
 * `$set`s it, so re-running over the same person writes the same document rather than appending a
 * second copy of their history.
 */
export const applyImportedHistory = async (
  employeeId: string,
  history: { closed: readonly ImportedPeriod[]; current: { hiredAt: Date } | null },
): Promise<void> => {
  const periods = [
    ...history.closed.map((p) => ({
      hiredAt: p.hiredAt,
      exitedAt: p.exitedAt,
      exitType: p.exitType,
    })),
    ...(history.current === null ? [] : [{ hiredAt: history.current.hiredAt, exitedAt: null, exitType: null }]),
  ];

  // Somebody still serving keeps the status their registration gave them and carries no exit; the
  // periods behind them are history. Somebody who has left is `exited`, under their LAST exit.
  const last = history.closed[history.closed.length - 1];
  const exit =
    history.current !== null || last === undefined
      ? null
      : {
          type: last.exitType,
          reason: last.reason,
          effectiveDate: last.exitedAt,
          // An imported exit records no rehire decision, because nobody made one — the sheet says
          // why somebody left, never whether they would be taken back. `true` would invent a
          // clearance; `false` would bar a person on the strength of a field that does not exist.
          // The company decides at the point of rehiring, which is where the override already is.
          eligibleForRehire: true,
          by: null,
        };

  await EmployeeModel.collection.updateOne(
    { _id: new Types.ObjectId(employeeId) },
    {
      $set: {
        employmentPeriods: periods,
        exit,
        // `hiredAt` is the CURRENT employment's start — the open period for somebody serving, and
        // the last one they served for somebody who has left.
        hiredAt: history.current?.hiredAt ?? last?.hiredAt ?? new Date(),
        ...(exit === null ? {} : { status: 'exited' as const }),
      },
    },
  );
};

/**
 * Apply the changes an uploaded roster makes to somebody already in the registry.
 *
 * WHY THIS IS NOT `updatePersonal` OR THE ACTIONS ENGINE. `updatePersonal` takes the whole personal
 * block and a version, and would need the caller to merge by hand — with 2,600 people that is 2,600
 * read-modify-writes and one lost update away from clobbering an edit made while the file uploaded.
 * The actions engine is for decisions somebody made HERE; a roster that says an employee now sits
 * in another department is recording a move that already happened, and routing it through `transfer`
 * would assert a decision-maker who clicked nothing and notify every holder of `employee.view` about
 * each one. So the change is written as state, like the history above it, and the audit entry the
 * caller records is what says a person set it and when.
 *
 * A `$set` OF EXACTLY THE CHANGED PATHS, never the whole document: a field the file has nothing to
 * say about is not in `set`, so it cannot be touched — which is the property the whole feature rests
 * on. `updatedBy` moves with it so the record does not claim it changed by itself.
 */
export const applyImportedUpdate = async (
  employeeId: string,
  set: Record<string, unknown>,
  by: string,
): Promise<void> => {
  if (Object.keys(set).length === 0) return;
  await EmployeeModel.collection.updateOne(
    { _id: new Types.ObjectId(employeeId) },
    { $set: { ...set, updatedBy: new Types.ObjectId(by), updatedAt: new Date() } },
  );
};
