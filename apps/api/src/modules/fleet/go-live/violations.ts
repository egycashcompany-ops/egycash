// The go-live VIOLATIONS import, as a boot step — the legacy `car_violations` book, 937 rows
// across the company's statement and the drivers' fines, applied by the deploy.
//
// «ضيف الداتا دى للشاشات … fleet/violations». The odometer step's shape (`odometer.ts`, and
// `vehicles.ts` at length): the same lease, the same refusals before the claim, the same «not on
// the boot's critical path», the same «nothing here can fail a boot», idempotent per row. What
// is different about a fine is in `violations-import.ts`.
//
// IT WAITS FOR THE CARS, as every book does: each row names a car by code.
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
  FleetGoLiveRunModel,
  recordGoLiveFailure,
  recordGoLiveRefusal,
} from './go-live-run.model';
import { resolveDrivers } from './odometer-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';
import {
  applyViolationsImport,
  loadViolationTypes,
  parseViolations,
  planViolationsImport,
} from './violations-import';

/**
 * The run key — versioned like the vehicles', and for the same reason. v2 keeps the rows of cars
 * the registry never had and the drivers' names HR does not know, as the odometer's v2 does.
 */
export const VIOLATIONS_GO_LIVE_MARK = 'go-live:violations:v2';

/** The vehicles' lease. A thousand rows in a hundred inserts is seconds. */
export const VIOLATIONS_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The export, beside `cars.json` — the legacy `car_violations` collection as MongoDB wrote it out. */
export const CAR_VIOLATIONS_FILE = 'car-violations.json';

const REPORT_CAP = 25;

/**
 * Run the import, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startViolationsGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives.
 */
export const runViolationsGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no violation was imported',
    );
    return;
  }
  const file = join(dir, CAR_VIOLATIONS_FILE);
  if (!existsSync(file)) {
    logger.error(
      { file },
      'fleet go-live: the violations book is not in this build — car-violations.json is missing, so no violation was imported',
    );
    return;
  }

  const vehiclesDone = await FleetGoLiveRunModel.exists({ key: VEHICLE_GO_LIVE_MARK, status: 'done' });
  if (vehiclesDone === null) {
    logger.warn(
      'fleet go-live: the vehicle registry has not finished importing — the violations book waits for the next boot; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(VIOLATIONS_GO_LIVE_MARK, { reason: 'vehicles-not-done' });
    return;
  }

  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the violations book — run the seed first; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(VIOLATIONS_GO_LIVE_MARK, { reason: 'no-admin', email: env.SEED_ADMIN_EMAIL });
    return;
  }

  const parsed = parseViolations(JSON.parse(await readFile(file, 'utf8')));
  const drivers = await resolveDrivers(parsed.driver.map((row) => row.driver));
  const plan = planViolationsImport(
    parsed,
    await fleetVehicleRepository.codeIndex(),
    await loadViolationTypes(),
    drivers.ids,
  );
  const notes = {
    skippedDeleted: parsed.skippedDeleted,
    rejected: parsed.rejected.slice(0, REPORT_CAP),
    unknownCars: plan.unknownCars,
    grievancesUnplaced: plan.grievancesUnplaced,
    zeroCount: plan.zeroCount,
    unknownTypes: plan.unknownTypes,
    grievanceConflicts: plan.grievanceConflicts,
    unmatchedDrivers: drivers.unmatched,
    ambiguousDrivers: drivers.ambiguous,
    placeholders: drivers.placeholders,
  };
  if (parsed.rejected.length > 0 || plan.unknownCars.length > 0 || plan.unknownTypes.length > 0 || drivers.unmatched.length > 0) {
    logger.warn(
      { rejected: parsed.rejected, unknownCars: plan.unknownCars, unknownTypes: plan.unknownTypes, unmatchedDrivers: drivers.unmatched, ambiguousDrivers: drivers.ambiguous },
      'fleet go-live: rows of the violations book that name no car, no type on that side, or no employee — imported without the driver, or skipped, and listed on the run',
    );
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(VIOLATIONS_GO_LIVE_MARK, VIOLATIONS_GO_LIVE_LEASE_MS))) return;

  logger.info(
    { vehicles: plan.vehicles.length, rows: plan.vehicles.reduce((sum, v) => sum + v.rows.length, 0), grievances: plan.grievances.length },
    'fleet go-live: importing the violations book',
  );
  const outcome = await applyViolationsImport(plan, String(admin._id));
  const counts = {
    vehicles: plan.vehicles.length,
    imported: outcome.imported,
    alreadyThere: outcome.alreadyThere,
    namesFilled: outcome.namesFilled,
    grievancesWritten: outcome.grievancesWritten,
    grievancesKept: outcome.grievancesKept,
    ...notes,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // skipping every row that already landed. The reasons go on the row as well as the log.
    await recordGoLiveFailure(VIOLATIONS_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: violations book finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial violations import');
    return;
  }
  await finishGoLiveRun(VIOLATIONS_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: violations book imported — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startViolationsGoLive = (): void => {
  if (isTest) return;
  void runViolationsGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: violations import failed — no boot was harmed');
  });
};
