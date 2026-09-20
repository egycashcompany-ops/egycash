// The go-live WORKSHOP import, as a boot step — the legacy `car_maintenance` book, 1,800 visits,
// applied by the deploy rather than by a person at a shell.
//
// «ضيف الداتا دى للشاشات … fleet/maintenance و /fleet/maintenance-alarms». The odometer step's
// shape (`odometer.ts`, and `vehicles.ts` at length): the same lease, the same refusals before
// the claim, the same «not on the boot's critical path», the same «nothing here can fail a
// boot», the same idempotence per row. What is different about a workshop visit is in
// `maintenance-import.ts`.
//
// IT WAITS FOR THE CARS AND FOR THE ODOMETER BOOK. Every visit names a car by code, and a third
// of them have no counter of their own and take it from the car's readings — so both earlier
// steps must be DONE before this one claims anything, or it would file the visits under «unknown
// car» and «no counter», correctly and forever. Until they are, it refuses with a lease that has
// already lapsed, and the next boot tries again.
//
// The alarms board has no data of its own: it is derived from the visits this writes and the
// readings the step before it wrote, so «ضيف الداتا للإنذارات» is this step and that one.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import {
  applyMaintenanceImport,
  isNobodyInWorkshop,
  parseVisits,
  planMaintenanceImport,
} from './maintenance-import';
import { ODOMETER_GO_LIVE_MARK } from './odometer';
import { resolveDrivers } from './odometer-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';

/**
 * The run key — versioned like the vehicles', and for the same reason. v2 keeps the visits of
 * cars the registry never had and the drivers' names HR does not know, as the odometer's v2 does.
 * v3 leaves NOTHING out — «المهم تضيف كل الداتا ومتسبش داتا فاضيه»: the 133 visits the old system
 * had deleted, which arrive deleted; the ones that left before they arrived; the ones with no
 * counter anywhere, written as 0; and the ones whose dates it could not read.
 */
export const MAINTENANCE_GO_LIVE_MARK = 'go-live:maintenance:v3';

/** The vehicles' lease. 1,800 visits with a counter look-up apiece is well under a minute. */
export const MAINTENANCE_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The export, beside `cars.json` — the legacy `car_maintenance` collection as MongoDB wrote it out. */
export const CAR_MAINTENANCE_FILE = 'car-maintenance.json';

/** How many of a long list the row keeps. The count travels whole; the list is a sample. */
const REPORT_CAP = 25;

/**
 * Run the import, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startMaintenanceGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives.
 */
export const runMaintenanceGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no visit was imported',
    );
    return;
  }
  const file = join(dir, CAR_MAINTENANCE_FILE);
  if (!existsSync(file)) {
    logger.error(
      { file },
      'fleet go-live: the workshop book is not in this build — car-maintenance.json is missing, so no visit was imported',
    );
    return;
  }

  // The cars and the readings first — see the header.
  if (!(await waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK, ODOMETER_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the vehicle registry or the odometer book has not finished importing — the workshop book waits for the next boot; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(MAINTENANCE_GO_LIVE_MARK, { reason: 'prior-steps-not-done' });
    return;
  }

  // The seeding admin authors every visit and every catalog row it adds. Looked up BEFORE the
  // claim, so an unseeded deployment can try again.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the workshop book — run the seed first; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(MAINTENANCE_GO_LIVE_MARK, { reason: 'no-admin', email: env.SEED_ADMIN_EMAIL });
    return;
  }

  const parsed = parseVisits(JSON.parse(await readFile(file, 'utf8')));
  const drivers = await resolveDrivers(
    parsed.visits.flatMap((visit) => [visit.driver, visit.driver2]),
    isNobodyInWorkshop,
  );
  const plan = planMaintenanceImport(parsed.visits, await fleetVehicleRepository.codeIndex(), drivers.ids);
  const notes = {
    keptDeleted: parsed.keptDeleted,
    unreadable: parsed.unreadable.slice(0, REPORT_CAP),
    rejected: parsed.rejected.slice(0, REPORT_CAP),
    deletedRows: plan.deleted,
    unknownCars: plan.unknownCars,
    outBeforeIn: plan.outBeforeIn,
    unmatchedDrivers: drivers.unmatched,
    ambiguousDrivers: drivers.ambiguous,
    placeholders: drivers.placeholders,
  };
  if (parsed.unreadable.length > 0 || plan.unknownCars.length > 0 || plan.outBeforeIn.length > 0 || drivers.unmatched.length > 0) {
    logger.warn(
      { unreadable: parsed.unreadable, unknownCars: plan.unknownCars, outBeforeIn: plan.outBeforeIn, unmatchedDrivers: drivers.unmatched, ambiguousDrivers: drivers.ambiguous },
      'fleet go-live: rows of the workshop book that name no car, no employee, or no readable date — every one of them imported, the unreadable ones written deleted with the book’s own words in their notes, and all of them listed on the run',
    );
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(MAINTENANCE_GO_LIVE_MARK, MAINTENANCE_GO_LIVE_LEASE_MS))) return;

  logger.info(
    { vehicles: plan.vehicles.length, visits: plan.vehicles.reduce((sum, v) => sum + v.visits.length, 0) },
    'fleet go-live: importing the workshop book',
  );
  const outcome = await applyMaintenanceImport(plan, String(admin._id));
  const counts = {
    vehicles: plan.vehicles.length,
    imported: outcome.imported,
    alreadyThere: outcome.alreadyThere,
    namesFilled: outcome.namesFilled,
    counterFromOdometer: outcome.counterFromOdometer,
    noCounter: outcome.noCounter,
    counterUnknown: outcome.counterUnknown,
    openConflicts: outcome.openConflicts,
    catalogCreated: outcome.catalogCreated,
    ...notes,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // skipping every visit that already landed. The reasons go on the row as well as the log.
    await recordGoLiveFailure(MAINTENANCE_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: workshop book finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial workshop import');
    return;
  }
  await finishGoLiveRun(MAINTENANCE_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: workshop book imported — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startMaintenanceGoLive = (): void => {
  if (isTest) return;
  void runMaintenanceGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: workshop import failed — no boot was harmed');
  });
};
