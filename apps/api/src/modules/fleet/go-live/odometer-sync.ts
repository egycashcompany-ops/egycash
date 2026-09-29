// The go-live ODOMETER SYNC, as a boot step — the owner's second export of the legacy `cars_log`
// book, brought onto the chain the first one wrote, by the deploy rather than by a person at a
// shell.
//
// «صفحة الصيانات و صفحة قراءة العدادات دول الملفات بتاعتهم من السيستم القديم شوف لو فى داتا
// المفروض تتضاف او تتعدل اعمل كدا». The odometer step's shape (`vehicles.ts` explains each of these
// at length): the same lease, the same refusals before the claim, the same «not on the boot's
// critical path», the same «nothing here can fail a boot». What is different about a SECOND
// export — that it is a difference, joined by the old system's row id, planned by the import's own
// planner on both sides and applied by the three-way rule, never a re-import — is in
// `odometer-sync-import.ts`.
//
// BOTH EXPORTS SHIP WITH THE BUILD. `cars-log.json` stays exactly as it is: it is what
// `go-live:odometer:v4` imported, and so it is the OLD side of every comparison — the only record
// of what the import wrote, and therefore of whether a reading on ECMS is still untouched. The new
// export sits beside it under its own date, byte for byte as the owner sent it.
//
// IT WAITS FOR THE CARS AND FOR THE BOOK. The rule compares against the chain the odometer import
// wrote, and every row names its car by a code the registry resolves; deciding anything before
// both runs are DONE would call every reading new and write it a second time. On a fresh database
// the same boot runs all three, and this one waits; on production, where both landed weeks ago,
// the wait is one query.
//
// IT IS IDEMPOTENT PER ROW AND PER FIELD, which is what makes the lease's take-over safe here. A
// reading this step already wrote is found by the car, the day and the opening reading among the
// rows the old book does not account for, and counted; a change it already made reads as «already
// there». Nothing is written twice.
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
import { CARS_LOG_FILE, ODOMETER_GO_LIVE_MARK } from './odometer';
import { parseCarsLog, resolveDrivers } from './odometer-import';
import { applyOdometerSync, diffBooks, planOdometerSync } from './odometer-sync-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';

/**
 * The run key — versioned like the import's, and for the same reason: a third export is applied by
 * adding its file and moving the mark, which is a deliberate, reviewable act, never something a
 * redeploy does on its own.
 */
export const ODOMETER_SYNC_GO_LIVE_MARK = 'go-live:odometer-sync:v1';

/**
 * The import's lease. A few hundred writes on some ninety cars take seconds; thirty minutes is
 * «certainly dead», not «probably slow».
 */
export const ODOMETER_SYNC_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The OLD export — what `go-live:odometer:v4` imported. Never edited: it is the rule's old side. */
export const ODOMETER_SYNC_OLD_FILE = CARS_LOG_FILE;

/** The NEW export, as the owner sent it on 2026-09-29, beside the old one. */
export const ODOMETER_SYNC_NEW_FILE = 'cars-log-2026-09-29.json';

/** How many of a long list the row keeps. The count travels whole; the list is a sample. */
const REPORT_CAP = 25;

/**
 * Run the step, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startOdometerSyncGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives: a refusal
 * is the condition somebody fixes and redeploys, and it must leave no lease to wait out.
 */
export const runOdometerSyncGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so the new odometer export was not applied',
    );
    return;
  }
  const oldFile = join(dir, ODOMETER_SYNC_OLD_FILE);
  const newFile = join(dir, ODOMETER_SYNC_NEW_FILE);
  if (!existsSync(oldFile) || !existsSync(newFile)) {
    logger.error(
      { oldFile, newFile },
      'fleet go-live: one of the two odometer exports is not in this build, so the new one was not applied',
    );
    return;
  }

  // The cars and the book first — see the header. Checked before the admin so the reason on the
  // row is the one that will actually change between this boot and the next.
  if (!(await waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK, ODOMETER_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the vehicle registry or the odometer book has not finished importing — the new odometer export waits for the next boot; nothing was applied and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ODOMETER_SYNC_GO_LIVE_MARK, { reason: 'prior-steps-not-done' });
    return;
  }

  // Both files, and a row either cannot be joined by — no id, or an id twice — is a refusal: the
  // join is the whole method, and a row it cannot place is one it would call new and write twice.
  const oldRaw: unknown = JSON.parse(await readFile(oldFile, 'utf8'));
  const newRaw: unknown = JSON.parse(await readFile(newFile, 'utf8'));
  const notLists = [
    ...(Array.isArray(oldRaw)
      ? []
      : [{ file: ODOMETER_SYNC_OLD_FILE, reason: 'the export is not a JSON array' }]),
    ...(Array.isArray(newRaw)
      ? []
      : [{ file: ODOMETER_SYNC_NEW_FILE, reason: 'the export is not a JSON array' }]),
  ];
  const diff = notLists.length > 0 ? null : diffBooks(oldRaw as unknown[], newRaw as unknown[]);
  const rejected = [
    ...notLists,
    ...(diff?.unidentified ?? []).map(({ file, row, reason }) => ({
      file: file === 'old' ? ODOMETER_SYNC_OLD_FILE : ODOMETER_SYNC_NEW_FILE,
      reason: `row ${row}: ${reason}`,
    })),
  ];
  if (diff === null || rejected.length > 0) {
    logger.error(
      { rows: rejected },
      'fleet go-live: rows of the odometer exports that cannot be joined by the old system’s id — nothing was applied and the run is NOT claimed, so a corrected build will apply them',
    );
    await recordGoLiveRefusal(ODOMETER_SYNC_GO_LIVE_MARK, {
      reason: 'rejected-rows',
      rows: rejected.slice(0, REPORT_CAP),
    });
    return;
  }

  // The seeding admin authors every row and every change, exactly as the import authored the
  // book. Looked up BEFORE the claim, so an unseeded deployment can try again once seeded.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the new odometer export — run the seed first; nothing was applied and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ODOMETER_SYNC_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  const parsedOld = parseCarsLog(oldRaw);
  const parsedNew = parseCarsLog(newRaw);
  // Every spelling in both books, asked once — the answer the import got for the old spelling is
  // what the rule compares ECMS against, and the answer for the new one is what gets written.
  const drivers = await resolveDrivers(
    [...parsedOld.rows, ...parsedNew.rows].flatMap((row) => [row.driver, row.driver2]),
  );
  const plan = planOdometerSync(
    parsedOld.rows,
    parsedNew.rows,
    await fleetVehicleRepository.codeIndex(),
    drivers.ids,
  );
  // The notes the import writes on its run, for what THIS step writes: the new rows, and the
  // drivers the new book names on the old ones.
  const written = new Set(plan.writtenSpellings);
  const notes = {
    keptDeleted: plan.keptDeleted,
    unreadable: parsedNew.unreadable
      .filter((row) => plan.addedIds.has(row.id))
      .slice(0, REPORT_CAP),
    unknownCars: plan.unknownCars,
    openedByPrevious: plan.openedByPrevious,
    closedByNext: plan.closedByNext,
    badInReading: plan.badInReading,
    unmatchedDrivers: drivers.unmatched.filter((name) => written.has(name)),
    ambiguousDrivers: drivers.ambiguous.filter((entry) =>
      written.has(entry.split(' — ')[0] as string),
    ),
    placeholders: drivers.placeholders.filter((name) => written.has(name)),
  };
  const inExport = {
    newRows: diff.added.length,
    changedRows: diff.changed.length,
    ...diff.fieldCounts,
  };

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(ODOMETER_SYNC_GO_LIVE_MARK, ODOMETER_SYNC_GO_LIVE_LEASE_MS))) return;

  logger.info(
    { cars: plan.cars.length, newRows: plan.addedRows, planned: plan.planned },
    'fleet go-live: applying the new odometer export',
  );
  const outcome = await applyOdometerSync(plan, drivers.ids, String(admin._id));
  const unapplied = [...plan.movedCars, ...outcome.unapplied];
  const counts = {
    vehicles: outcome.vehicles,
    inExport,
    added: outcome.added,
    alreadyThere: outcome.alreadyThere,
    changed: outcome.changed,
    changesAlreadyThere: outcome.changesAlreadyThere,
    deletedByBook: outcome.deletedByBook,
    restoredByBook: outcome.restoredByBook,
    restored: outcome.restored,
    closedByExisting: outcome.closedByExisting,
    deletedRows: outcome.writtenDeleted,
    keptEcmsEditsCount: outcome.keptEcmsEdits.length,
    keptEcmsEdits: outcome.keptEcmsEdits.slice(0, REPORT_CAP),
    // Whole, not a sample, as the import writes it: one line per car at most, and every line is a
    // reading kept deleted that somebody has to look at.
    openConflicts: outcome.openConflicts,
    unappliedCount: unapplied.length,
    unapplied: unapplied.slice(0, REPORT_CAP),
    goneFromExport: diff.removed.slice(0, REPORT_CAP),
    ...notes,
  };
  if (
    outcome.keptEcmsEdits.length > 0 ||
    unapplied.length > 0 ||
    outcome.openConflicts.length > 0
  ) {
    logger.warn(
      { kept: outcome.keptEcmsEdits, unapplied, openConflicts: outcome.openConflicts },
      'fleet go-live: readings the new odometer export could not bring across as it wrote them — a value somebody changed on ECMS since was kept, and each one is listed on the run',
    );
  }
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // finding every change this run made already there and every row it wrote already written.
    await recordGoLiveFailure(ODOMETER_SYNC_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: new odometer export finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial odometer sync');
    return;
  }
  await finishGoLiveRun(ODOMETER_SYNC_GO_LIVE_MARK, counts);
  logger.info(counts, 'fleet go-live: the new odometer export applied — done, and never again');
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startOdometerSyncGoLive = (): void => {
  if (isTest) return;
  void runOdometerSyncGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: odometer sync failed — no boot was harmed');
  });
};
