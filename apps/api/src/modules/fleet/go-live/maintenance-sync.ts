// The go-live WORKSHOP SYNC, as a boot step — the owner's second `car_maintenance` export brought
// onto the visits the first one filled, by the deploy rather than by a person at a shell.
//
// «صفحة الصيانات و صفحة قراءة العدادات دول الملفات بتاعتهم من السيستم القديم شوف لو فى داتا
// المفروض تتضاف او تتعدل اعمل كدا». The workshop step's shape (`maintenance.ts`, and `vehicles.ts`
// at length): the same lease, the same refusals before the claim, the same «not on the boot's
// critical path», the same «nothing here can fail a boot». What is different about a SECOND
// export — that it is a difference, its new rows written by the import's own rules and its
// changes by the three-way rule, never a re-import — is in `maintenance-sync-import.ts`.
//
// BOTH EXPORTS SHIP WITH THE BUILD. `car-maintenance.json` stays exactly as it is: it is what
// `go-live:maintenance:v3` imported, and so it is the OLD side of every comparison — the only
// record of what the import wrote, and therefore of whether a field on ECMS is still untouched.
// The new export sits beside it under its own date, byte for byte as the owner sent it.
//
// IT WAITS FOR THE WORKSHOP IMPORT, and for what that step itself waits for — the cars and the
// odometer book. The rule compares against the visits the import wrote, and the new rows name
// cars by code; deciding anything before all three are DONE would decide it against a
// half-written book. On production, where all three landed weeks ago, the wait is one query.
//
// AND IT WAITS FOR THE ODOMETER BOOK'S OWN NEW EXPORT (`odometer-sync.ts`), because the owner
// sent the two books together and they describe the same fortnight. 18 of the 43 new visits have
// no counter in the book and take the car's reading on or before the day they went in — and the
// readings for 16 to 29 September are exactly what that export adds. Both steps start at the same
// boot; without the wait, whichever finished first would decide which reading a visit keeps, and
// a visit that runs first takes the last reading from before the 16th — car 153's visit of 27
// September a reading some 700 km short — and keeps it, correctly by its own rule and forever.
// The odometer sync waits for nothing of the workshop's, so the two cannot wait on each other.
//
// IT IS IDEMPOTENT, which is what makes the lease's take-over safe here. A field this run already
// wrote reads as «already there» to the next attempt, and a visit it already added is found by the
// import's own key and counted rather than written again.
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
import { CAR_MAINTENANCE_FILE, MAINTENANCE_GO_LIVE_MARK } from './maintenance';
import { isNobodyInWorkshop, planMaintenanceImport } from './maintenance-import';
import { applyMaintenanceSync, planMaintenanceSync } from './maintenance-sync-import';
import { ODOMETER_GO_LIVE_MARK } from './odometer';
import { resolveDrivers } from './odometer-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';

/**
 * The run key — versioned like every go-live step's: a third export is applied by moving the
 * mark, which is a deliberate, reviewable act, never something a redeploy does on its own.
 */
export const MAINTENANCE_SYNC_GO_LIVE_MARK = 'go-live:maintenance-sync:v1';

/** The workshop import's lease. Fifty-three visits take seconds; thirty minutes is «certainly dead». */
export const MAINTENANCE_SYNC_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The OLD export — what `go-live:maintenance:v3` imported. Never edited: it is the rule's old side. */
export const MAINTENANCE_SYNC_OLD_FILE = CAR_MAINTENANCE_FILE;

/** The NEW export, as the owner sent it on 2026-09-29, beside the old one. */
export const MAINTENANCE_SYNC_NEW_FILE = 'car-maintenance-2026-09-29.json';

/** How many of a long list the row keeps. The count travels whole; the list is a sample. */
const REPORT_CAP = 25;

/**
 * Run the step, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startMaintenanceSyncGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives: a refusal
 * is the condition somebody fixes and redeploys, and it must leave no lease to wait out.
 */
export const runMaintenanceSyncGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so the new workshop export was not applied',
    );
    return;
  }
  const oldFile = join(dir, MAINTENANCE_SYNC_OLD_FILE);
  const newFile = join(dir, MAINTENANCE_SYNC_NEW_FILE);
  if (!existsSync(oldFile) || !existsSync(newFile)) {
    logger.error(
      { oldFile, newFile },
      'fleet go-live: one of the two workshop exports is not in this build, so the new workshop export was not applied',
    );
    return;
  }

  // The workshop book, and the two steps it stands on — see the header. Checked before the admin
  // so the reason on the row is the one that will actually change between this boot and the next.
  if (
    !(await waitForGoLiveRuns([
      VEHICLE_GO_LIVE_MARK,
      ODOMETER_GO_LIVE_MARK,
      MAINTENANCE_GO_LIVE_MARK,
    ]))
  ) {
    logger.warn(
      'fleet go-live: the vehicle registry, the odometer book or the workshop book has not finished importing — the new workshop export waits for the next boot; nothing was applied and the run is NOT claimed',
    );
    await recordGoLiveRefusal(MAINTENANCE_SYNC_GO_LIVE_MARK, { reason: 'maintenance-not-done' });
    return;
  }

  // Both files through the import's own reader. Only a file that is not a list of rows, or one
  // that names a row id twice, is refused: the diff is made by that id, and a row it cannot place
  // is a change it would silently leave out.
  const plan = planMaintenanceSync(
    JSON.parse(await readFile(oldFile, 'utf8')),
    JSON.parse(await readFile(newFile, 'utf8')),
  );
  if (plan.rejected.length > 0) {
    logger.error(
      { rows: plan.rejected },
      'fleet go-live: the workshop exports cannot be compared — nothing was applied and the run is NOT claimed, so a corrected build will apply them',
    );
    await recordGoLiveRefusal(MAINTENANCE_SYNC_GO_LIVE_MARK, {
      reason: 'rejected-rows',
      rows: plan.rejected.slice(0, REPORT_CAP),
    });
    return;
  }

  // The seeding admin authors every visit and every change, exactly as it authored the import.
  // Looked up BEFORE the claim, so an unseeded deployment can try again once seeded.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the new workshop export — run the seed first; nothing was applied and the run is NOT claimed',
    );
    await recordGoLiveRefusal(MAINTENANCE_SYNC_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  // HR is asked once for every spelling on the NEW side — the names this run may write, and the
  // ones the run reports — and once more for the old side's own, which are only compared.
  const newSide = [
    ...plan.added.flatMap((visit) => [visit.driver, visit.driver2]),
    ...plan.changes.flatMap((change) => [change.next.driver, change.next.driver2]),
  ];
  const drivers = await resolveDrivers(newSide, isNobodyInWorkshop);
  const oldOnly = plan.changes
    .flatMap((change) => [change.old.driver, change.old.driver2])
    .filter((name) => !newSide.includes(name));
  const oldDrivers = await resolveDrivers(oldOnly, isNobodyInWorkshop);
  const driverIds = new Map([...oldDrivers.ids, ...drivers.ids]);
  const vehicleIdByCode = await fleetVehicleRepository.codeIndex();
  const addedPlan = planMaintenanceImport(plan.added, vehicleIdByCode, drivers.ids);

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(MAINTENANCE_SYNC_GO_LIVE_MARK, MAINTENANCE_SYNC_GO_LIVE_LEASE_MS))) {
    return;
  }

  logger.info(
    {
      rows: plan.rows,
      added: plan.added.length,
      changes: plan.changes.length,
      inExport: plan.inExport,
    },
    'fleet go-live: applying the new workshop export',
  );
  let outcome;
  try {
    outcome = await applyMaintenanceSync(plan, addedPlan, {
      by: String(admin._id),
      vehicleIdByCode,
      driverIds,
    });
  } catch (error) {
    // Thrown OUTSIDE the per-visit loops — the catalog reads in front of each of them. Written to
    // the row for the vehicle step's reason, then rethrown so the boot's own catch logs it; the
    // lease expires and the next boot retries, finding whatever did land already there.
    await recordGoLiveFailure(MAINTENANCE_SYNC_GO_LIVE_MARK, {
      stage: 'catalog',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const counts = {
    // Not `rows`: on the notice that key is a refusal's list of rows that cannot be read.
    exportRows: plan.rows,
    added: outcome.added,
    alreadyThere: outcome.alreadyThere,
    changed: outcome.changed,
    changesAlreadyThere: outcome.changesAlreadyThere,
    keptEcmsEditsCount: outcome.keptEcmsEdits.length,
    keptEcmsEdits: outcome.keptEcmsEdits.slice(0, REPORT_CAP),
    deletedByBook: outcome.deletedByBook,
    restoredByBook: outcome.restoredByBook,
    unappliedCount: outcome.unapplied.length,
    unapplied: outcome.unapplied.slice(0, REPORT_CAP),
    parkedChanged: outcome.parkedChanged,
    inExport: plan.inExport,
    columnsChanged: plan.columnsChanged,
    goneFromExport: plan.goneFromExport.slice(0, REPORT_CAP),
    namesFilled: outcome.namesFilled,
    counterFromOdometer: outcome.counterFromOdometer,
    noCounter: outcome.noCounter,
    counterUnknown: outcome.counterUnknown,
    openConflicts: outcome.openConflicts,
    outBeforeIn: [...addedPlan.outBeforeIn, ...outcome.outBeforeIn],
    catalogCreated: outcome.catalogCreated,
    // The import's own notes, for the new rows — the same keys `maintenance.ts` writes.
    keptDeleted: plan.keptDeleted,
    unreadable: plan.unreadable.slice(0, REPORT_CAP),
    deletedRows: addedPlan.deleted,
    unknownCars: addedPlan.unknownCars,
    unmatchedDrivers: drivers.unmatched,
    ambiguousDrivers: drivers.ambiguous,
    placeholders: drivers.placeholders,
  };
  if (outcome.keptEcmsEdits.length > 0 || outcome.unapplied.length > 0) {
    logger.warn(
      { kept: outcome.keptEcmsEdits, unapplied: outcome.unapplied },
      'fleet go-live: workshop fields changed on ECMS since the import, or changes that could not be applied — the ECMS value was kept, and each is listed on the run',
    );
  }
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // finding every field and every visit this run wrote already there. The reasons go on the row
    // as well as the log.
    await recordGoLiveFailure(MAINTENANCE_SYNC_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: new workshop export finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial workshop sync');
    return;
  }
  await finishGoLiveRun(MAINTENANCE_SYNC_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: the new workshop export applied — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startMaintenanceSyncGoLive = (): void => {
  if (isTest) return;
  void runMaintenanceSyncGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: workshop sync failed — no boot was harmed');
  });
};
