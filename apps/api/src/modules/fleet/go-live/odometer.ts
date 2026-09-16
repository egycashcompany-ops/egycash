// The go-live ODOMETER import, as a boot step — the legacy `cars_log` book, twenty thousand
// readings on 191 cars, applied by the deploy rather than by a person at a shell.
//
// «ضيف الداتا دى للشاشات fleet/odometer …». The vehicle step's shape (`vehicles.ts` explains each
// of these at length): the same lease, the same refusals-before-the-claim, the same «not on the
// boot's critical path», the same «nothing here can fail a boot». This file explains only what
// is different about a ledger.
//
// IT WAITS FOR THE CARS. Every row names a car by code, and the registry the codes resolve
// against is written by the vehicle step — which the same boot starts a moment before this one,
// and which takes seconds. A run that resolved codes against a registry still being written
// would report most of the book as «unknown cars» and finish, correctly and forever. So the
// vehicles' run must be DONE before this one claims anything; until it is, this refuses with a
// lease that has already lapsed, and the next boot tries again. On a database where the cars
// landed on an earlier deploy — which is where this is going — that is a single query.
//
// IT IS IDEMPOTENT PER ROW, which is what makes the lease's take-over safe here. The cars could
// rely on «update by code»; a reading has no code, so `applyOdometerImport` tells a row it has
// already written by the car, the day and the opening reading, and does not write it twice.
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
import {
  applyOdometerImport,
  parseCarsLog,
  planOdometerImport,
  resolveDrivers,
} from './odometer-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';

/**
 * The run key — versioned like the vehicles', and for the same reason.
 *
 * v1 left out the rows of cars the registry never had, and left the driver empty where HR did
 * not know the spelling. v2 keeps both — the code and the name as text — and, over a database v1
 * already ran on, writes only the rows v1 skipped and fills the names into the rows it wrote.
 */
export const ODOMETER_GO_LIVE_MARK = 'go-live:odometer:v2';

/**
 * The vehicles' lease. Twenty thousand rows in 191 inserts is well under a minute; thirty
 * minutes is «certainly dead», not «probably slow».
 */
export const ODOMETER_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The export, beside `cars.json` — the legacy `cars_log` collection as MongoDB wrote it out. */
export const CARS_LOG_FILE = 'cars-log.json';

/** How many of a long list the row keeps. The count travels whole; the list is a sample. */
const REPORT_CAP = 25;

/**
 * Run the import, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startOdometerGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives: a refusal
 * is the condition somebody fixes and redeploys, and it must leave no lease to wait out.
 */
export const runOdometerGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no reading was imported',
    );
    return;
  }
  const file = join(dir, CARS_LOG_FILE);
  if (!existsSync(file)) {
    logger.error(
      { file },
      'fleet go-live: the odometer book is not in this build — cars-log.json is missing, so no reading was imported',
    );
    return;
  }

  // The cars first — see the header. Checked before the admin so the reason on the row is the
  // one that will actually change between this boot and the next.
  const vehiclesDone = await FleetGoLiveRunModel.exists({ key: VEHICLE_GO_LIVE_MARK, status: 'done' });
  if (vehiclesDone === null) {
    logger.warn(
      'fleet go-live: the vehicle registry has not finished importing — the odometer book waits for the next boot; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ODOMETER_GO_LIVE_MARK, { reason: 'vehicles-not-done' });
    return;
  }

  // The seeding admin authors every row, so an imported reading is attributable exactly like
  // one somebody typed. Looked up BEFORE the claim, so an unseeded deployment can try again.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the odometer book — run the seed first; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ODOMETER_GO_LIVE_MARK, { reason: 'no-admin', email: env.SEED_ADMIN_EMAIL });
    return;
  }

  const parsed = parseCarsLog(JSON.parse(await readFile(file, 'utf8')));
  const drivers = await resolveDrivers(parsed.rows.flatMap((row) => [row.driver, row.driver2]));
  const plan = planOdometerImport(parsed.rows, await fleetVehicleRepository.codeIndex(), drivers.ids);
  const notes = {
    skippedDeleted: parsed.skippedDeleted,
    rejected: parsed.rejected.slice(0, REPORT_CAP),
    unknownCars: plan.unknownCars,
    noOutReading: plan.noOutReading,
    noOutReadingRows: plan.noOutReadingRows.slice(0, REPORT_CAP),
    closedByNext: plan.closedByNext,
    badInReading: plan.badInReading,
    unmatchedDrivers: drivers.unmatched,
    ambiguousDrivers: drivers.ambiguous,
    placeholders: drivers.placeholders,
  };
  if (parsed.rejected.length > 0 || plan.unknownCars.length > 0 || drivers.unmatched.length > 0) {
    logger.warn(
      { rejected: parsed.rejected, unknownCars: plan.unknownCars, unmatchedDrivers: drivers.unmatched, ambiguousDrivers: drivers.ambiguous },
      'fleet go-live: rows of the odometer book that name no car, no employee, or no date — imported without the driver, or skipped, and listed on the run',
    );
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(ODOMETER_GO_LIVE_MARK, ODOMETER_GO_LIVE_LEASE_MS))) return;

  logger.info(
    { vehicles: plan.vehicles.length, rows: plan.vehicles.reduce((sum, v) => sum + v.rows.length, 0) },
    'fleet go-live: importing the odometer book',
  );
  const outcome = await applyOdometerImport(plan, String(admin._id));
  const counts = {
    vehicles: plan.vehicles.length,
    imported: outcome.imported,
    alreadyThere: outcome.alreadyThere,
    namesFilled: outcome.namesFilled,
    closedByExisting: outcome.closedByExisting,
    openConflicts: outcome.openConflicts,
    ...notes,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // skipping every row that already landed. The reasons go on the row as well as the log.
    await recordGoLiveFailure(ODOMETER_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: odometer book finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial odometer import');
    return;
  }
  await finishGoLiveRun(ODOMETER_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: odometer book imported — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startOdometerGoLive = (): void => {
  if (isTest) return;
  void runOdometerGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: odometer import failed — no boot was harmed');
  });
};
