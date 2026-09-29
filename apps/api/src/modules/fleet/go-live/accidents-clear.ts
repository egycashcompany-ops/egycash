// The accidents screen EMPTIED, once, by the deploy — «fleet/accidents امسح كل الحوادث اللى فيها».
//
// Every accident file on `/fleet/accidents` is deleted: the 184 files the go-live import brought
// across from the old book, and whatever was typed on the new screen since. Nothing is spared,
// because nothing was named to spare.
//
// SOFT, NOT HARD — and that is the difference from the go-live reset (`reset.ts`), which cleared
// test fixtures «خالص». The owner's standing rule for real data is «الداتا اللى ممسوحه متظهرش
// للمستخدم تبقى فى الداتا بيز فقط»: a deleted row leaves every screen, every total and every
// export, and stays in the database. So each file gets exactly what the screen's own «حذف» gives
// it — `isDeleted: true`, the day it was deleted, and its version bumped so an edit dialog left
// open on a stale copy is refused rather than written over a deleted file. The transfers embedded
// in a file go with it; every reader of balances, transfers and the log already skips a deleted
// file, so no car is left owing or owed money on account of one.
//
// IT WAITS FOR THE IMPORT. On the production database the accidents book was imported weeks ago
// and the wait is one query. On a database the deploy is building from nothing, clearing first
// would clear nothing, and the import behind it would then fill the screen the owner asked to
// empty — so the import lands first and is cleared after it.
//
// ONCE PER DATABASE, on the lease every go-live step runs on (`go-live-run.model.ts`). It is one
// `updateMany`, so a take-over after a crash simply finds nothing left to delete.
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { FleetAccidentModel } from '../accidents/accident.model';
import { ACCIDENTS_GO_LIVE_MARK } from './accidents';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';

/** The run key — versioned like every go-live step's, so a second clearing is a decision. */
export const ACCIDENTS_CLEAR_GO_LIVE_MARK = 'go-live:accidents-clear:v1';

/** One `updateMany` is milliseconds; the lease is the other steps' «certainly dead». */
export const ACCIDENTS_CLEAR_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/**
 * Delete every live accident file, softly. Exported so a test can drive it against a real
 * database; returns how many files it deleted.
 */
export const clearAccidents = async (at: Date = new Date()): Promise<number> => {
  const result = await FleetAccidentModel.updateMany(
    { isDeleted: false },
    { $set: { isDeleted: true, deletedAt: at, deletedBy: null }, $inc: { __v: 1 } },
  ).exec();
  return result.modifiedCount;
};

/**
 * Run the step, once, and report. Exported so a test can await it; the boot uses
 * `startAccidentsClearGoLive` below, which is this without the waiting.
 *
 * The one refusal happens BEFORE the claim, for the reason `vehicles.ts` gives: it is a condition
 * the next boot re-checks, and it must not leave a lease to wait out.
 */
export const runAccidentsClearGoLive = async (): Promise<void> => {
  if (!(await waitForGoLiveRuns([ACCIDENTS_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the accidents book has not finished importing — the accidents screen is cleared on the next boot; nothing was deleted and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ACCIDENTS_CLEAR_GO_LIVE_MARK, { reason: 'accidents-not-done' });
    return;
  }

  if (!(await claimGoLiveRun(ACCIDENTS_CLEAR_GO_LIVE_MARK, ACCIDENTS_CLEAR_GO_LIVE_LEASE_MS))) {
    return;
  }

  const deleted = await clearAccidents();
  await finishGoLiveRun(ACCIDENTS_CLEAR_GO_LIVE_MARK, { deleted });
  logger.warn(
    { deleted },
    'fleet go-live: every accident file was deleted (softly — still in the database, off every screen) — done, and never again',
  );
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startAccidentsClearGoLive = (): void => {
  if (isTest) return;
  void runAccidentsClearGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'fleet go-live: clearing the accidents failed — no boot was harmed',
    );
  });
};
