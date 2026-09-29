// The go-live step that gives back what the violations reload took from the 24th on — the ticks
// and corrections people made on the old rows after the date the owner named as this system's
// start. The rules are in `violations-restore-import.ts`; this file is the lease around them, the
// shape every go-live step has (`vehicles.ts` at length).
//
// IT WAITS FOR THE RELOAD, and reads its end: the audit window runs from the reload's cutoff to
// the moment the reload finished. On a database where the reload swept nothing — a fresh one —
// the trail holds no such change and the step finishes having written nothing.
import { isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  FleetGoLiveRunModel,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { VIOLATIONS_RELOAD_CUTOFF, VIOLATIONS_RELOAD_MARK } from './violations-reload';
import { applyViolationsRestore } from './violations-restore-import';

/** The run key — versioned like every go-live step's. */
export const VIOLATIONS_RESTORE_MARK = 'go-live:violations-restore:v1';

/** A few hundred audit entries is seconds. */
export const VIOLATIONS_RESTORE_LEASE_MS = 30 * 60 * 1000;

const REPORT_CAP = 25;

/** Run the step, once. Exported so a test can await it; the boot uses the starter below. */
export const runViolationsRestoreGoLive = async (): Promise<void> => {
  if (!(await waitForGoLiveRuns([VIOLATIONS_RELOAD_MARK]))) {
    logger.warn(
      'fleet go-live: the violations reload has not finished — the restore of the ticks waits for the next boot; nothing was written and the run is NOT claimed',
    );
    await recordGoLiveRefusal(VIOLATIONS_RESTORE_MARK, { reason: 'reload-not-done' });
    return;
  }
  const reload = await FleetGoLiveRunModel.findOne({ key: VIOLATIONS_RELOAD_MARK })
    .lean<{ finishedAt: Date | null }>()
    .exec();
  const until = reload?.finishedAt ?? new Date();

  if (!(await claimGoLiveRun(VIOLATIONS_RESTORE_MARK, VIOLATIONS_RESTORE_LEASE_MS))) return;

  try {
    const outcome = await applyViolationsRestore(
      VIOLATIONS_RELOAD_CUTOFF,
      until,
      new Map([...(await fleetVehicleRepository.codeIndex())].map(([code, id]) => [id, code])),
    );
    const counts = {
      restoredFields: outcome.restored,
      yearTicksRestored: outcome.yearTicksRestored,
      deletedAgain: outcome.deletedAgain,
      auditEntries: outcome.entries,
      noTwin: outcome.noTwin.slice(0, REPORT_CAP),
      keptSinceReload: outcome.keptSinceReload.slice(0, REPORT_CAP),
      laterTicks: outcome.laterTicks,
      unreadable: outcome.unreadable.slice(0, REPORT_CAP),
      failures: outcome.failures.slice(0, REPORT_CAP),
    };
    if (outcome.failures.length > 0) {
      // Left unfinished: the next boot after the lease retries, and every write here is guarded,
      // so what already landed is found landed.
      await recordGoLiveFailure(VIOLATIONS_RESTORE_MARK, {
        ...counts,
        failed: outcome.failures.length,
      });
      return;
    }
    await finishGoLiveRun(VIOLATIONS_RESTORE_MARK, counts);
    logger.info(
      counts,
      'fleet go-live: the violations changes made from the 24th on are back — done, and never again',
    );
  } catch (error) {
    await recordGoLiveFailure(VIOLATIONS_RESTORE_MARK, {
      stage: 'restore',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

/** What the long-running processes call. Not awaited, cannot reject, skipped under test. */
export const startViolationsRestoreGoLive = (): void => {
  if (isTest) return;
  void runViolationsRestoreGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'fleet go-live: restoring the violations changes failed — no boot was harmed',
    );
  });
};
