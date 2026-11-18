// The quarantine's WRITE side, kept apart from its service on purpose.
//
// The import writes quarantined rows; the retry reads them and hands them back to the import. If
// both lived in one module the import would have to import the thing that imports it. So the write
// is here, depends on nothing but the model, and the service above it owns the reading, the retry
// and the report.
import {
  normalizeDeviceCode,
  normalizeEnrollmentNo,
  type AttendancePunchDirection,
  type ImportPunchRow,
} from '@ecms/contracts';
import { logger } from '../../../../infrastructure/logging/logger';
import { AttendanceQuarantineModel } from './attendance-quarantine.model';

export interface HeldRow {
  row: ImportPunchRow;
  reason: string;
}

/**
 * Store (or refresh) the rows one import could not place — ONE round trip for the whole batch.
 *
 * Upserted on the row's own identity, so a branch re-sending its file every night leaves one row
 * per unplaceable scan with today's reason on it, not one row per night. `retries` and
 * `firstSeenAt` are `$setOnInsert`: the first sighting is a fact about the row, and a re-send is
 * not a retry — only `retryQuarantine` counts those.
 *
 * It never throws into the import's face: a batch that placed 4,000 rows must not be reported as
 * failed because the note about the other 12 could not be written. The reason is still returned in
 * the response either way, which is the §13 behaviour this adds to rather than replaces.
 */
export const holdQuarantinedRows = async (
  batchId: string,
  held: readonly HeldRow[],
): Promise<void> => {
  const storable = held.filter(({ row }) => !Number.isNaN(row.at.getTime()));
  if (storable.length === 0) return;
  const now = new Date();
  try {
    await AttendanceQuarantineModel.bulkWrite(
      storable.map(({ row, reason }) => ({
        updateOne: {
          filter: {
            // NORMALIZED THE WAY THE REGISTRY NORMALIZES, not as the row happened to spell it. A
            // device code is the name of a wall, so `q-3` and `Q-3` are one device — the import
            // already resolves them to the same registered machine. Keeping the row's own spelling
            // here split one wall into two in the unmatched report, and left the retry (which looks
            // the device up by its registered code) matching nothing at all.
            deviceId: normalizeDeviceCode(row.deviceId),
            at: row.at,
            enrollmentNo:
              row.enrollmentNo === undefined ? null : normalizeEnrollmentNo(row.enrollmentNo),
            employeeNumber: row.employeeNumber ?? null,
            status: 'pending' as const,
          },
          update: {
            $set: { reason, direction: row.direction as AttendancePunchDirection },
            $setOnInsert: {
              batchId,
              status: 'pending' as const,
              retries: 0,
              firstSeenAt: now,
              lastTriedAt: null,
              resolvedAt: null,
              schemaVersion: 1,
              isDeleted: false,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (error) {
    logger.error(
      { err: error, batchId, rows: storable.length },
      'attendance: quarantined rows not held',
    );
  }
};

/** One machine id nobody is linked to, and how many of this date's scans it is holding. */
export interface UnlinkedScanGroup {
  deviceCode: string;
  enrollmentNo: string | null;
  rows: number;
}

/**
 * THE SCANS A DAY'S SHEET CANNOT SHOW — grouped by the machine id that produced them.
 *
 * The sheet is a page of EMPLOYEES, so a scan whose machine id maps to nobody has no line to sit on
 * and no bucket to be counted in. That is correct, and on its own it is also how thirty-nine people
 * at the door became five rows on screen with nothing on the page to say the other thirty-four had
 * happened. This is read beside the counts so the screen can say it out loud.
 *
 * Read from the quarantine rather than the punches on purpose: a quarantined row is precisely a
 * scan that could not become a punch, which is the thing being reported.
 *
 * Still a READ — nothing is linked, discarded or guessed here.
 */
export const unlinkedScansOn = async (from: Date, to: Date): Promise<UnlinkedScanGroup[]> => {
  const groups = await AttendanceQuarantineModel.aggregate<{
    _id: { deviceId: string; enrollmentNo: string | null };
    rows: number;
  }>([
    { $match: { status: 'pending', at: { $gte: from, $lt: to } } },
    { $group: { _id: { deviceId: '$deviceId', enrollmentNo: '$enrollmentNo' }, rows: { $sum: 1 } } },
    { $sort: { rows: -1 } },
  ]).exec();
  return groups.map((g) => ({
    deviceCode: g._id.deviceId,
    enrollmentNo: g._id.enrollmentNo,
    rows: g.rows,
  }));
};
