// Cars 150 and 153 — the two odometer readings typed on ECMS that the old book says otherwise, and
// the two last readings the odometer sync had to write deleted because of them.
//
// The sync (`odometer-sync.ts`) keeps what a person typed on ECMS over what the old book says, and
// listed the two places it did so: the reading that closed 16 September was typed as 154,898,652
// on car 150 (a slip — the book's next day opens at 165,095) and as 145,000 on car 153 (the book
// says 145,011). Asked, the owner chose the book: «خد قراءة السيستم القديم». So each is set to
// the book's figure, and its kilometres with it — but only where the row still holds exactly the
// typed figure the sync reported, so a correction made since is not overwritten.
//
// THE 29 SEPTEMBER READINGS. The book leaves each car open on the 29th (150 at 165,764, 153 at
// 145,800). The sync found another reading already open on each car and wrote the book's DELETED
// rather than open two periods on one car (`ux_open_period`). Each is brought back:
//   · open, when the car has no open reading any more;
//   · closed against the car's open reading, when that one was recorded on the same day or later
//     at the same figure or higher — the import's own rule for its last row (`closedByExisting`);
//   · otherwise left as it is, and the car's readings from the 16th on are listed on the run, so
//     whoever looks can see which of the two is right.
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { FleetOdometerLogModel, type FleetOdometerLogDoc } from '../odometer/odometer.model';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { ODOMETER_SYNC_GO_LIVE_MARK } from './odometer-sync';

/**
 * v1 set the two closing readings and found each 29 September reading still blocked — by the
 * reading typed on ECMS with the same slip: car 150 opened on 24 September at 154,898,652, car
 * 153 on 23 September at 145,000, both still open and both below or far above the book's chain
 * around them. v2 takes those two typed rows off (softly — «تبقى فى الداتا بيز فقط»), which is
 * the owner's «خد قراءة السيستم القديم» applied to the rest of the same slip, and then brings the
 * book's 29 September readings back.
 */
export const ODOMETER_FIX_GO_LIVE_MARK = 'go-live:odometer-fix:v2';
export const ODOMETER_FIX_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The two readings the sync kept, and the book's figure for each — from its own report. */
export const TYPED_READINGS = [
  { code: '150', day: '2026-09-16', typed: 154898652, book: 165095 },
  { code: '153', day: '2026-09-16', typed: 145000, book: 145011 },
] as const;

/** The two last readings the sync wrote deleted — the book's own figures. */
export const PARKED_READINGS = [
  { code: '150', day: '2026-09-29', out: 165764 },
  { code: '153', day: '2026-09-29', out: 145800 },
] as const;

/**
 * The two OPEN readings typed on ECMS with the slip — the figures the v1 run listed. Only a live,
 * open row at exactly this opening figure is taken off: the book never wrote either figure.
 */
export const TYPED_OPEN_READINGS = [
  { code: '150', out: 154898652 },
  { code: '153', out: 145000 },
] as const;

/** Where the car's readings are listed from, when a parked one cannot come back on its own. */
const LIST_FROM = new Date('2026-09-16T00:00:00.000Z');

const dayRange = (day: string): { $gte: Date; $lt: Date } => {
  const start = new Date(`${day}T00:00:00.000Z`);
  return { $gte: start, $lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};

const describe = (row: Pick<FleetOdometerLogDoc, 'date' | 'outReading' | 'inReading'>): string =>
  `${row.date.toISOString().slice(0, 10)}: ${row.outReading ?? '—'} → ${row.inReading ?? '—'}`;

export interface OdometerFixOutcome {
  /** «code day: typed → book» for each reading set to the book's figure. */
  corrected: string[];
  /** Readings that no longer hold the typed figure — left as they are now. */
  correctedAlready: string[];
  /** «code day» — parked readings brought back open. */
  reopened: string[];
  /** «code day → closing figure» — parked readings brought back closed against the open one. */
  closedAgainstOpen: string[];
  /** Cars whose parked reading could not come back: their readings from the 16th on. */
  stillParked: string[];
  /** Cars the registry does not have — nothing to do. */
  notInRegistry: string[];
  /** «code: figure» — the open readings typed with the slip, taken off (kept in the database). */
  typedRemoved: string[];
}

export const applyOdometerFix = async (): Promise<OdometerFixOutcome> => {
  const outcome: OdometerFixOutcome = {
    corrected: [],
    correctedAlready: [],
    reopened: [],
    closedAgainstOpen: [],
    stillParked: [],
    notInRegistry: [],
    typedRemoved: [],
  };

  for (const fix of TYPED_READINGS) {
    const vehicle = await fleetVehicleRepository.findByCode(fix.code);
    if (vehicle === null) {
      outcome.notInRegistry.push(fix.code);
      continue;
    }
    const row = await FleetOdometerLogModel.findOne({
      vehicleId: vehicle._id,
      isDeleted: false,
      date: dayRange(fix.day),
      inReading: fix.typed,
    })
      .lean<FleetOdometerLogDoc>()
      .exec();
    if (row === null) {
      outcome.correctedAlready.push(`${fix.code} ${fix.day}`);
      continue;
    }
    const written = await FleetOdometerLogModel.updateOne(
      { _id: row._id, isDeleted: false, inReading: fix.typed },
      {
        $set: {
          inReading: fix.book,
          km: row.outReading === null ? null : fix.book - row.outReading,
        },
        $inc: { __v: 1 },
      },
    ).exec();
    if (written.modifiedCount === 1)
      outcome.corrected.push(`${fix.code} ${fix.day}: ${fix.typed} → ${fix.book}`);
    else outcome.correctedAlready.push(`${fix.code} ${fix.day}`);
  }

  for (const typed of TYPED_OPEN_READINGS) {
    const vehicle = await fleetVehicleRepository.findByCode(typed.code);
    if (vehicle === null) continue;
    const written = await FleetOdometerLogModel.updateOne(
      { vehicleId: vehicle._id, isDeleted: false, outReading: typed.out, inReading: null },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: null }, $inc: { __v: 1 } },
    ).exec();
    if (written.modifiedCount === 1) outcome.typedRemoved.push(`${typed.code}: ${typed.out}`);
  }

  for (const parked of PARKED_READINGS) {
    const vehicle = await fleetVehicleRepository.findByCode(parked.code);
    if (vehicle === null) {
      if (!outcome.notInRegistry.includes(parked.code)) outcome.notInRegistry.push(parked.code);
      continue;
    }
    const row = await FleetOdometerLogModel.findOne({
      vehicleId: vehicle._id,
      date: dayRange(parked.day),
      outReading: parked.out,
      inReading: null,
      isDeleted: true,
      deletedBy: null,
    })
      .lean<FleetOdometerLogDoc>()
      .exec();
    if (row === null) continue; // already back, or never parked — nothing to do
    const open = await FleetOdometerLogModel.findOne({
      vehicleId: vehicle._id,
      isDeleted: false,
      inReading: null,
      outReading: { $ne: null },
    })
      .lean<FleetOdometerLogDoc>()
      .exec();
    const back = { isDeleted: false, deletedAt: null, deletedBy: null };
    if (open === null) {
      const written = await FleetOdometerLogModel.updateOne(
        { _id: row._id, isDeleted: true },
        { $set: back, $inc: { __v: 1 } },
      ).exec();
      if (written.modifiedCount === 1) outcome.reopened.push(`${parked.code} ${parked.day}`);
      continue;
    }
    const joins = open.date >= row.date && (open.outReading as number) >= parked.out;
    if (joins) {
      const closing = open.outReading as number;
      const written = await FleetOdometerLogModel.updateOne(
        { _id: row._id, isDeleted: true },
        { $set: { ...back, inReading: closing, km: closing - parked.out }, $inc: { __v: 1 } },
      ).exec();
      if (written.modifiedCount === 1) {
        outcome.closedAgainstOpen.push(`${parked.code} ${parked.day} → ${closing}`);
      }
      continue;
    }
    const readings = await FleetOdometerLogModel.find({
      vehicleId: vehicle._id,
      isDeleted: false,
      date: { $gte: LIST_FROM },
    })
      .sort({ date: 1, outReading: 1 })
      .lean<FleetOdometerLogDoc[]>()
      .exec();
    outcome.stillParked.push(
      `${parked.code} (${parked.day}: ${parked.out}) — ${readings.map(describe).join(' · ')}`,
    );
  }
  return outcome;
};

/** Run the step, once. Exported so a test can await it; the boot uses the starter below. */
export const runOdometerFixGoLive = async (): Promise<void> => {
  if (!(await waitForGoLiveRuns([ODOMETER_SYNC_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the odometer sync has not finished — cars 150 and 153 wait for the next boot; nothing was written and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ODOMETER_FIX_GO_LIVE_MARK, { reason: 'odometer-sync-not-done' });
    return;
  }
  if (!(await claimGoLiveRun(ODOMETER_FIX_GO_LIVE_MARK, ODOMETER_FIX_GO_LIVE_LEASE_MS))) return;
  try {
    const outcome = await applyOdometerFix();
    await finishGoLiveRun(ODOMETER_FIX_GO_LIVE_MARK, { ...outcome });
    logger.info(
      outcome,
      'fleet go-live: cars 150 and 153 set to the old book — done, and never again',
    );
  } catch (error) {
    await recordGoLiveFailure(ODOMETER_FIX_GO_LIVE_MARK, {
      stage: 'fix',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/** What the long-running processes call. Not awaited, cannot reject, skipped under test. */
export const startOdometerFixGoLive = (): void => {
  if (isTest) return;
  void runOdometerFixGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'fleet go-live: the odometer fix for cars 150 and 153 failed — no boot was harmed',
    );
  });
};
