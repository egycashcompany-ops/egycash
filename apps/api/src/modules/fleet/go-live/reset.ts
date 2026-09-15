// The go-live reset — the owner's test data cleared off the Fleet screens, once, by the deploy.
//
// THE INSTRUCTION, verbatim, because the list of what is spared is the whole of it:
//
//   «/fleet/odometer · /fleet/maintenance · /fleet/maintenance-alarms · /fleet/roster ·
//    /fleet/fixed-roster · /fleet/accidents · /fleet/violations · /fleet/catalogs —
//    اى داتا فى اى شاشه من دول امسحها خالص ما عدا أنواع المخالفات و السواقيين و وظيفة السائق
//    و تخصص السائق ورخصة السائق و اوعى تيجى جمبهم»
//
// Everything those eight screens show is deleted. Five things are not touched at all: the
// violation TYPES (the catalog rows, as distinct from the violations filed against them), the
// drivers registry, and the three driver catalogs. Two screens the owner did not name are not
// touched either — the vehicles and the vehicle types — because a wipe reaches exactly as far as
// it was told to and not one collection further.
//
// HARD DELETE, not soft. «خالص» means gone, and a soft-deleted row is still a row: it stays in
// the collection, it counts against unique indexes, and some readers still find it. This is the
// removal of test fixtures before real data arrives, not a business mutation with an audit story,
// and the counts are logged so what happened is on record.
//
// ONCE PER DATABASE. It claims a mark through `markOnce` and never runs again — a second boot,
// a redeploy, a scale-up cannot repeat it. It runs at the TOP of the Fleet seed, before a single
// catalog row is ensured, so the vocabulary the seed writes in the same boot lands on a clean
// catalog rather than being wiped by the step behind it. That also makes this the one Fleet
// go-live step that sits on the boot's critical path — deliberately: seven `deleteMany` calls are
// milliseconds, and the vocabulary MUST NOT be seeded before this has run.
//
// The maintenance-alarms board is on the list and has no collection of its own: it is derived
// from visits, readings and settings, all of which this clears. The sweep marks that announce
// alarms and licence expiries are left alone — they are keyed on visit ids and expiry dates, so
// nothing this deletes can make a stale one suppress a real announcement.
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { FleetCatalogItemModel } from '../catalogs/catalog-item.model';
import { FleetOdometerLogModel } from '../odometer/odometer.model';
import { FleetMaintenanceVisitModel } from '../maintenance/maintenance.model';
import { FleetDutyAssignmentModel } from '../roster/duty-assignment.model';
import { FleetFixedCrewModel } from '../fixed-roster/fixed-crew.model';
import { FleetAccidentModel } from '../accidents/accident.model';
import { FleetGrievanceModel, FleetViolationModel } from '../violations/violation.model';
import { FleetSweepMarkModel, markOnce } from '../sweeps/sweep-mark.model';

/** Versioned, like the import's: repeating the reset is a decision, never a side effect. */
export const GO_LIVE_RESET_MARK = 'go-live:reset:v1';

/**
 * The catalog kinds the owner named as untouchable. Spelled out as the ALLOW list rather than
 * deriving a deny list from the enum, because a kind added to the enum later must not be swept
 * up by a reset written before it existed.
 */
export const PROTECTED_CATALOG_KINDS = [
  'violationType',
  'driverJob',
  'driverSpecialization',
  'driverLicenseType',
] as const;

export interface ResetOutcome {
  odometerLogs: number;
  maintenanceVisits: number;
  dutyAssignments: number;
  fixedCrews: number;
  accidents: number;
  violations: number;
  grievances: number;
  catalogItems: number;
}

/**
 * Run the reset, once, and report.
 *
 * Exported so a test can drive it against a real database; the seed calls `startGoLiveReset`,
 * which is this behind the test guard. Returns null when the mark was already taken.
 */
export const runGoLiveReset = async (): Promise<ResetOutcome | null> => {
  // The mark's guarantee is `ux_key`, and `autoIndex` is off in production. The index step runs
  // at the END of the seed, after this; on a brand-new database two processes booting together
  // could both insert the mark before it exists — and two rows under one key would then stop the
  // unique index from ever being built. So the sweep-mark indexes are built here first.
  await FleetSweepMarkModel.createIndexes();
  if (!(await markOnce(GO_LIVE_RESET_MARK))) return null;

  const gone = async (model: { deleteMany: (f: object) => { exec: () => Promise<{ deletedCount?: number }> } }, filter: object = {}) =>
    (await model.deleteMany(filter).exec()).deletedCount ?? 0;

  const outcome: ResetOutcome = {
    odometerLogs: await gone(FleetOdometerLogModel),
    maintenanceVisits: await gone(FleetMaintenanceVisitModel),
    dutyAssignments: await gone(FleetDutyAssignmentModel),
    fixedCrews: await gone(FleetFixedCrewModel),
    accidents: await gone(FleetAccidentModel),
    violations: await gone(FleetViolationModel),
    grievances: await gone(FleetGrievanceModel),
    catalogItems: await gone(FleetCatalogItemModel, {
      kind: { $nin: [...PROTECTED_CATALOG_KINDS] },
    }),
  };
  logger.warn(
    outcome,
    'fleet go-live: the eight screens were cleared — this ran once and will not run again',
  );
  return outcome;
};

/**
 * What the Fleet seed calls, first thing.
 *
 * AWAITED, unlike the vehicle import, and it is the only go-live step that is: it must finish
 * before the vocabulary is seeded, and it is a handful of `deleteMany` calls, not 23MB of scans.
 *
 * Skipped under test, or every integration suite would spend a mark clearing an empty database
 * before its own fixtures — harmless, and still not what a suite is for.
 */
export const startGoLiveReset = async (): Promise<void> => {
  if (isTest) return;
  await runGoLiveReset();
};
