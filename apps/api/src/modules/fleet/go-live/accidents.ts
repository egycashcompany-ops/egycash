// The go-live ACCIDENTS import, as a boot step — the legacy `fleet_accident` book, 184 files,
// applied by the deploy.
//
// «ضيف الداتا دى للشاشات … fleet/accidents». The odometer step's shape (`odometer.ts`, and
// `vehicles.ts` at length): the same lease, the same refusals before the claim, the same «not on
// the boot's critical path», the same «nothing here can fail a boot», idempotent per file. What
// is different about an accident is in `accidents-import.ts`.
//
// IT WAITS FOR THE CARS, as every book does: each file names a car by code.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import {
  applyAccidentsImport,
  isNobodyCulprit,
  parseAccidents,
  planAccidentsImport,
} from './accidents-import';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  FleetGoLiveRunModel,
  recordGoLiveFailure,
  recordGoLiveRefusal,
} from './go-live-run.model';
import { resolveDrivers } from './odometer-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';

/** The run key — versioned like the vehicles', and for the same reason. */
export const ACCIDENTS_GO_LIVE_MARK = 'go-live:accidents:v1';

/** The vehicles' lease. Two hundred files is seconds. */
export const ACCIDENTS_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The export, beside `cars.json` — the legacy `fleet_accident` collection as MongoDB wrote it out. */
export const FLEET_ACCIDENT_FILE = 'fleet-accident.json';

const REPORT_CAP = 25;

/**
 * Run the import, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startAccidentsGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives.
 */
export const runAccidentsGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no accident was imported',
    );
    return;
  }
  const file = join(dir, FLEET_ACCIDENT_FILE);
  if (!existsSync(file)) {
    logger.error(
      { file },
      'fleet go-live: the accidents book is not in this build — fleet-accident.json is missing, so no accident was imported',
    );
    return;
  }

  const vehiclesDone = await FleetGoLiveRunModel.exists({ key: VEHICLE_GO_LIVE_MARK, status: 'done' });
  if (vehiclesDone === null) {
    logger.warn(
      'fleet go-live: the vehicle registry has not finished importing — the accidents book waits for the next boot; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ACCIDENTS_GO_LIVE_MARK, { reason: 'vehicles-not-done' });
    return;
  }

  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the accidents book — run the seed first; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ACCIDENTS_GO_LIVE_MARK, { reason: 'no-admin', email: env.SEED_ADMIN_EMAIL });
    return;
  }

  const parsed = parseAccidents(JSON.parse(await readFile(file, 'utf8')));
  // The culprit's NAME is asked of the directory like a driver's; the name itself travels as
  // written whatever the answer, so «unmatched» here is a note, not a gap in the file.
  const culprits = await resolveDrivers(parsed.accidents.map((row) => row.culprit), isNobodyCulprit);
  const plan = planAccidentsImport(parsed.accidents, await fleetVehicleRepository.codeIndex(), culprits.ids);
  const notes = {
    skippedDeleted: parsed.skippedDeleted,
    rejected: parsed.rejected.slice(0, REPORT_CAP),
    unknownCars: plan.unknownCars,
    noDate: plan.noDate,
    statementFilled: plan.statementFilled,
    blankAmounts: plan.blankAmounts,
    amountNotes: plan.amountNotes,
    unmatchedCulprits: culprits.unmatched,
    ambiguousCulprits: culprits.ambiguous,
  };
  if (parsed.rejected.length > 0 || plan.unknownCars.length > 0 || plan.noDate.length > 0) {
    logger.warn(
      { rejected: parsed.rejected, unknownCars: plan.unknownCars, noDate: plan.noDate },
      'fleet go-live: files of the accidents book that name no car or no date — skipped, and listed on the run',
    );
  }

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(ACCIDENTS_GO_LIVE_MARK, ACCIDENTS_GO_LIVE_LEASE_MS))) return;

  logger.info(
    { vehicles: plan.vehicles.length, files: plan.vehicles.reduce((sum, v) => sum + v.rows.length, 0) },
    'fleet go-live: importing the accidents book',
  );
  const outcome = await applyAccidentsImport(plan, String(admin._id));
  const counts = {
    vehicles: plan.vehicles.length,
    imported: outcome.imported,
    alreadyThere: outcome.alreadyThere,
    ...notes,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // skipping every file that already landed. The reasons go on the row as well as the log.
    await recordGoLiveFailure(ACCIDENTS_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: accidents book finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial accidents import');
    return;
  }
  await finishGoLiveRun(ACCIDENTS_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: accidents book imported — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startAccidentsGoLive = (): void => {
  if (isTest) return;
  void runAccidentsGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: accidents import failed — no boot was harmed');
  });
};
