// Giving back the car a carried fine came from, for the fines carried BEFORE anything remembered.
//
// Dropping a driver's fine onto another car moves it there — `vehicleId` becomes 151 and the board
// lists it under 151, which is the point of the gesture. For one release that overwrite kept
// nothing, so pressing «محمولة على» cleared the year and left the fine stranded on a car it was
// never committed on: «لو رجعتها هتكون 150 زى ما كانت» was not true. `homeVehicleId` fixes that
// going forward; this gives the same answer back to the rows already moved.
//
// WHERE THE ANSWER COMES FROM. Every move wrote one audit entry per fine, through the same
// `diffChanges(snapshot, snapshot)` every other write on this collection uses — so the car it
// left is recorded, under `vehicleId`, beside the `filedYear` that carried it. Nothing is
// guessed and nothing is inferred from a code or a name.
//
// HOW THE TRAIL IS READ — forwards, replaying the same rule the server now follows:
//   · a carry (filedYear null → a year) records home, and ONLY if no home is open, so a fine
//     carried 150 → 151 → 152 goes back to 150 rather than to 151;
//   · a return (filedYear a year → null) closes it, because the fine went home and whatever
//     carried it afterwards starts again.
// Whatever is open at the end is where the fine belongs. A carry that did not change the car
// leaves nothing to restore, and the row is left alone.
//
// `platform_audit` IS NOT TOUCHED. It is read and never written: an audit log records what was
// true at the time, and rewriting it to match a later decision is the one thing it must never do.
//
// Read and write are separate on purpose: `inspect` is what `--dry-run` runs and touches nothing.
import { Types } from 'mongoose';
import { AuditLogModel } from '../../../platform/audit/audit.model';
import { FleetViolationModel } from './violation.model';

/** One carried fine and the car the trail says it came from. */
export interface CarriedHomeRestore {
  violationId: string;
  /** The car it sits on now — where a return would leave it if nothing were restored. */
  vehicleId: string;
  /** The car it came from, from the audit trail. */
  homeVehicleId: string;
  filedYear: number;
}

export interface CarriedHomeReport {
  /** Live driver rows currently carried onto another block. */
  carried: number;
  /** …of which already remember where they came from — nothing to do for these. */
  alreadyHome: number;
  /** …and of which a home could NOT be recovered, with why. */
  unrecoverable: { violationId: string; reason: 'no-carry-in-trail' | 'same-car' }[];
  restores: CarriedHomeRestore[];
}

const asId = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return Types.ObjectId.isValid(text) ? text : null;
};

/**
 * Replay one fine's trail and return the car it is currently away from, or `null`.
 *
 * Exported for its own test: this is the whole correctness of the backfill, and it is pure —
 * entries in, a car id or nothing out.
 */
export const homeFromTrail = (
  entries: readonly { changes: readonly { field: string; old: unknown; new: unknown }[] }[],
): string | null => {
  let home: string | null = null;
  for (const entry of entries) {
    const filed = entry.changes.find((change) => change.field === 'filedYear');
    if (filed === undefined) continue;
    const wentHome = filed.new === null || filed.new === undefined;
    if (wentHome) {
      // The fine was returned. Whatever carried it before is settled and closed.
      home = null;
      continue;
    }
    // A carry. Record where it came from — unless a home is already open, because home is where
    // it started and not where it last stopped.
    if (home !== null) continue;
    const car = entry.changes.find((change) => change.field === 'vehicleId');
    if (car === undefined) continue;
    home = asId(car.old);
  }
  return home;
};

/** What the trail can give back — READ ONLY. */
export const inspectCarriedHomes = async (): Promise<CarriedHomeReport> => {
  const carried = await FleetViolationModel.find({
    isDeleted: false,
    kind: 'driver',
    filedYear: { $type: 'number' },
  })
    .lean()
    .exec();

  const report: CarriedHomeReport = {
    carried: carried.length,
    alreadyHome: 0,
    unrecoverable: [],
    restores: [],
  };

  for (const row of carried) {
    const violationId = String(row._id);
    if (row.homeVehicleId !== null && row.homeVehicleId !== undefined) {
      report.alreadyHome += 1;
      continue;
    }
    const entries = await AuditLogModel.find({
      'entityRef.entityType': 'violation',
      'entityRef.entityId': violationId,
    })
      .sort({ at: 1 })
      .lean()
      .exec();
    const home = homeFromTrail(entries);
    const on = row.vehicleId === null ? null : String(row.vehicleId);
    if (home === null) {
      report.unrecoverable.push({ violationId, reason: 'no-carry-in-trail' });
      continue;
    }
    if (on === null || home === on) {
      // It was dropped onto the car it was already on: the move changed the block, not the car,
      // so there is nothing to give back and a return already leaves it in the right place.
      report.unrecoverable.push({ violationId, reason: 'same-car' });
      continue;
    }
    report.restores.push({
      violationId,
      vehicleId: on,
      homeVehicleId: home,
      filedYear: row.filedYear as number,
    });
  }
  return report;
};

/**
 * Write the recovered homes. ONLY `homeVehicleId`, and only where it is still empty.
 *
 * No fine is moved by this: the car each sits on, its date, its driver, its amount and whether
 * the money is in are all left exactly as they are. All this does is make the way back possible.
 */
export const restoreCarriedHomes = async (
  restores: readonly CarriedHomeRestore[],
): Promise<{ modified: number }> => {
  let modified = 0;
  for (const restore of restores) {
    const result = await FleetViolationModel.updateOne(
      { _id: new Types.ObjectId(restore.violationId), homeVehicleId: null },
      { $set: { homeVehicleId: new Types.ObjectId(restore.homeVehicleId) } },
    );
    modified += result.modifiedCount;
  }
  return { modified };
};
