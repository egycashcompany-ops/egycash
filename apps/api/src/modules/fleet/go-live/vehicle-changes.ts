// The go-live VEHICLE CHANGES, as a boot step — the owner's second cars export, applied to the
// registry the first one filled, by the deploy rather than by a person at a shell.
//
// «عاوزك تضيف التغيرات اللى هنا تحطها على ecms». The vehicle step's shape (`vehicles.ts` explains
// each of these at length): the same lease, the same refusals before the claim, the same «not on
// the boot's critical path», the same «nothing here can fail a boot». What is different about a
// SECOND export — that it is a difference, applied by the three-way rule, and never a re-import —
// is in `vehicle-changes-import.ts`.
//
// BOTH EXPORTS SHIP WITH THE BUILD. `cars.json` stays exactly as it is: it is what
// `go-live:vehicles:v3` imported, and so it is the OLD side of every comparison — the only record
// of what the import wrote, and therefore of whether a field on ECMS is still untouched. The new
// export sits beside it under its own date, byte for byte as the owner sent it.
//
// AND A LATER VEHICLE RUN MUST NOT GO BACK TO `cars.json`. This run is done once and never
// repeats, while `applyImport` writes every field of every car it finds by code — so a
// `go-live:vehicles:v4` over the old file would put the old class, the old expiry and the old
// branch back on every car this step moved on, and nothing would move them forward again. Any
// re-import after this one reads the newest export, never the first.
//
// IT WAITS FOR THE CARS. Every change names a car by code, and the rule compares against what the
// vehicle import wrote — so that run must be DONE before this one decides anything. On a fresh
// database the same boot runs both, and this one waits; on production, where the cars landed
// weeks ago, the wait is one query.
//
// IT IS IDEMPOTENT PER FIELD, which is what makes the lease's take-over safe here. A field this
// run already wrote reads as «already new» to the next run, and is counted rather than written;
// a scan already attached is its own file name on the car, and is counted the same way.
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { type AuthContext } from '../../../shared/types';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { applyVehicleChanges, findBlockers, planVehicleChanges } from './vehicle-changes-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';
import { parseCars } from './vehicles-import';

/**
 * The run key — versioned like the vehicles', and for the same reason: a third export is applied
 * by moving the mark, which is a deliberate, reviewable act, never something a redeploy does.
 */
export const VEHICLE_CHANGES_GO_LIVE_MARK = 'go-live:vehicle-changes:v1';

/** The vehicles' lease. A few dozen updates take seconds; thirty minutes is «certainly dead». */
export const VEHICLE_CHANGES_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The OLD export — what `go-live:vehicles:v3` imported. Never edited: it is the rule's old side. */
export const VEHICLE_CHANGES_OLD_FILE = 'cars.json';

/** The NEW export, as the owner sent it on 2026-09-29, beside the old one. */
export const VEHICLE_CHANGES_NEW_FILE = 'cars-2026-09-29.json';

/** How many of a long list the row keeps. The count travels whole; the list is a sample. */
const REPORT_CAP = 25;

/**
 * The privileged context the step acts as — the vehicle step's grants, for the vehicle step's
 * reason: `fleetVehicle.edit` is both the grant every update here is made under and the one the
 * Files service's authorizer re-asks Fleet about before it will plant a scan on a car. Its own
 * session name, so the audit trail says which step made the change.
 */
const goLiveContext = (adminId: string): AuthContext => ({
  userId: adminId,
  sessionId: 'go-live:vehicle-changes',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: {
    'fleetVehicle.view': 'organization',
    'fleetVehicle.create': 'organization',
    'fleetVehicle.edit': 'organization',
    'fleetCatalog.manage': 'organization',
    'file.view': 'organization',
    'file.download': 'organization',
  },
  permissionVersion: 0,
  isPrivileged: true,
});

/**
 * Run the step, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startVehicleChangesGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives: a refusal
 * is the condition somebody fixes and redeploys, and it must leave no lease to wait out.
 */
export const runVehicleChangesGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no vehicle change was applied',
    );
    return;
  }
  const oldFile = join(dir, VEHICLE_CHANGES_OLD_FILE);
  const newFile = join(dir, VEHICLE_CHANGES_NEW_FILE);
  if (!existsSync(oldFile) || !existsSync(newFile)) {
    logger.error(
      { oldFile, newFile },
      'fleet go-live: one of the two cars exports is not in this build, so no vehicle change was applied',
    );
    return;
  }

  // The cars first — see the header. Checked before the admin so the reason on the row is the
  // one that will actually change between this boot and the next.
  if (!(await waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the vehicle registry has not finished importing — the vehicle changes wait for the next boot; nothing was applied and the run is NOT claimed',
    );
    await recordGoLiveRefusal(VEHICLE_CHANGES_GO_LIVE_MARK, { reason: 'vehicles-not-done' });
    return;
  }

  // Both files through the vehicle import's own reader — the same trimming, the same required
  // fields, the same «a deleted row is test data». A row either cannot read is a refusal, as it
  // is for the import: a car the diff cannot see is a change it would silently leave out.
  const parsedOld = parseCars(JSON.parse(await readFile(oldFile, 'utf8')));
  const parsedNew = parseCars(JSON.parse(await readFile(newFile, 'utf8')));
  const rejected = [
    ...parsedOld.rejected.map((row) => ({ file: VEHICLE_CHANGES_OLD_FILE, ...row })),
    ...parsedNew.rejected.map((row) => ({ file: VEHICLE_CHANGES_NEW_FILE, ...row })),
  ];
  if (rejected.length > 0) {
    logger.error(
      { rows: rejected },
      'fleet go-live: rows of the cars exports that cannot be read — no vehicle change was applied and the run is NOT claimed, so a corrected build will apply them',
    );
    await recordGoLiveRefusal(VEHICLE_CHANGES_GO_LIVE_MARK, {
      reason: 'rejected-rows',
      rows: rejected.slice(0, REPORT_CAP),
    });
    return;
  }

  // The seeding admin authors every change, exactly as the import authored every car. Looked up
  // BEFORE the claim, so an unseeded deployment can try again once seeded.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the vehicle changes — run the seed first; nothing was applied and the run is NOT claimed',
    );
    await recordGoLiveRefusal(VEHICLE_CHANGES_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  const plan = planVehicleChanges(parsedOld.cars, parsedNew.cars);
  const blockers = await findBlockers(plan);
  if (
    blockers.missingBranches.length > 0 ||
    blockers.inactiveBranches.length > 0 ||
    blockers.identifierClashes.length > 0
  ) {
    logger.error(
      blockers,
      'fleet go-live: vehicle changes refused — add the missing branches in /system, re-activate the deactivated ones, or resolve the plate/chassis/motor numbers another vehicle already holds. Nothing was applied and the run is NOT claimed, so the next boot after the fix will apply them',
    );
    await recordGoLiveRefusal(VEHICLE_CHANGES_GO_LIVE_MARK, {
      reason: 'plan',
      missingBranches: blockers.missingBranches,
      inactiveBranches: blockers.inactiveBranches,
      identifierClashes: blockers.identifierClashes.slice(0, REPORT_CAP),
    });
    return;
  }

  const photoDir = join(dir, 'license-photos');
  const photoNames = new Set(existsSync(photoDir) ? await readdir(photoDir) : []);

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(VEHICLE_CHANGES_GO_LIVE_MARK, VEHICLE_CHANGES_GO_LIVE_LEASE_MS))) {
    return;
  }

  logger.info(
    { cars: plan.cars, carsWithChanges: plan.changes.length, inExport: plan.inExport },
    'fleet go-live: applying the changes of the new cars export',
  );
  let outcome;
  try {
    outcome = await applyVehicleChanges(
      plan,
      photoDir,
      photoNames,
      goLiveContext(String(admin._id)),
    );
  } catch (error) {
    // Thrown OUTSIDE the per-car loop — the branch resolution before it. Written to the row for
    // the vehicle step's reason, then rethrown so the boot's own catch logs it; the lease expires
    // and the next boot retries.
    await recordGoLiveFailure(VEHICLE_CHANGES_GO_LIVE_MARK, {
      stage: 'before-cars',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const counts = {
    cars: plan.cars,
    carsWithChanges: plan.changes.length,
    inExport: plan.inExport,
    changed: outcome.changed,
    alreadyNew: outcome.alreadyNew,
    photos: outcome.photos,
    keptEcmsEditsCount: outcome.keptEcmsEdits.length,
    keptEcmsEdits: outcome.keptEcmsEdits.slice(0, REPORT_CAP),
    notInRegistry: outcome.notInRegistry,
    disposedCars: outcome.disposedCars,
    newCars: plan.newCars,
    goneFromExport: plan.goneFromExport,
    // Whole, not a sample: one line per car at most, and every line is a scan somebody has to
    // send — a list cut at 25 would hide which of them are still owed.
    photosNotInBuild: outcome.photosNotInBuild,
    photoAlreadyThere: outcome.photoAlreadyThere,
    photoDropped: outcome.photoDropped,
    catalogCreated: outcome.catalogCreated,
    vehicleTypesCreated: outcome.vehicleTypesCreated,
  };
  if (outcome.keptEcmsEdits.length > 0) {
    logger.warn(
      { kept: outcome.keptEcmsEdits },
      'fleet go-live: fields changed on ECMS since the import — the ECMS value was kept over the new export, and each is listed on the run',
    );
  }
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // finding every field this run wrote already new. The reasons go on the row as well as the log.
    await recordGoLiveFailure(VEHICLE_CHANGES_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: vehicle changes finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial vehicle changes');
    return;
  }
  await finishGoLiveRun(VEHICLE_CHANGES_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: the new cars export applied — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startVehicleChangesGoLive = (): void => {
  if (isTest) return;
  void runVehicleChangesGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: vehicle changes failed — no boot was harmed');
  });
};
