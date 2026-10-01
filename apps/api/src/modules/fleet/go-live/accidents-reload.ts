// The accidents screen FILLED AGAIN from the old system's latest book — «وضيف الداتا دى بتاعت
// الحوادث», sent on 1 October after the screen had been emptied (`accidents-clear.ts`).
//
// THE SAME RULES AS THE FIRST IMPORT. The book is read, planned and written by
// `accidents-import.ts` exactly as the go-live import was, so the two can never disagree about
// what a row of the book says: every row lands, a row the old system had deleted lands deleted
// («الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط»), a file with no date keeps none,
// and a car the registry never had is kept by the book's code.
//
// WHAT COUNTS AS ALREADY THERE is only what was written AFTER the screen was emptied. The files
// deleted then are the old book's — the same accidents, mostly — and matching against them would
// skip every row and leave the screen empty. A file typed on the new screen since, or one an
// interrupted earlier try of this step already wrote, does count, so nothing is doubled.
//
// IT WAITS FOR THE CLEARING. Run before it, the clearing that follows would delete what this
// writes.
//
// ONCE PER DATABASE, on the go-live lease. A failure leaves the run unfinished and the next boot
// after the lease takes it over, skipping every file that already landed.
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
import { ACCIDENTS_CLEAR_GO_LIVE_MARK } from './accidents-clear';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  FleetGoLiveRunModel,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { resolveDrivers } from './odometer-import';
import { resolveGoLiveDataDir } from './vehicles';

export const ACCIDENTS_RELOAD_GO_LIVE_MARK = 'go-live:accidents-reload:v1';
export const ACCIDENTS_RELOAD_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** The book as the old system exported it on 1 October 2026. */
export const ACCIDENTS_RELOAD_FILE = 'fleet-accident-2026-10-01.json';

/** How many of each list go on the run row — the log carries the whole of it. */
const REPORT_CAP = 50;

export const runAccidentsReloadGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  const file = dir === null ? null : join(dir, ACCIDENTS_RELOAD_FILE);
  if (file === null || !existsSync(file)) {
    logger.error(
      { file },
      'fleet go-live: the 1 October accidents book is not in this build — nothing was imported',
    );
    return;
  }

  if (!(await waitForGoLiveRuns([ACCIDENTS_CLEAR_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the accidents screen has not been emptied yet — the new book waits for the next boot; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ACCIDENTS_RELOAD_GO_LIVE_MARK, { reason: 'clear-not-done' });
    return;
  }
  const cleared = await FleetGoLiveRunModel.findOne({ key: ACCIDENTS_CLEAR_GO_LIVE_MARK })
    .lean<{ finishedAt: Date | null }>()
    .exec();
  const since = cleared?.finishedAt ?? new Date(0);

  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the accidents book — nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(ACCIDENTS_RELOAD_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  const parsed = parseAccidents(JSON.parse(await readFile(file, 'utf8')));
  const culprits = await resolveDrivers(
    parsed.accidents.map((row) => row.culprit),
    isNobodyCulprit,
  );
  const plan = planAccidentsImport(
    parsed.accidents,
    await fleetVehicleRepository.codeIndex(),
    culprits.ids,
  );
  const notes = {
    rows: parsed.accidents.length,
    keptDeleted: parsed.keptDeleted,
    unreadable: parsed.unreadable.slice(0, REPORT_CAP),
    rejected: parsed.rejected.slice(0, REPORT_CAP),
    deletedRows: plan.deleted,
    unknownCars: plan.unknownCars,
    noDate: plan.noDate,
    statementFilled: plan.statementFilled,
    blankAmounts: plan.blankAmounts,
    amountNotes: plan.amountNotes,
    unmatchedCulprits: culprits.unmatched,
    ambiguousCulprits: culprits.ambiguous,
  };

  if (!(await claimGoLiveRun(ACCIDENTS_RELOAD_GO_LIVE_MARK, ACCIDENTS_RELOAD_GO_LIVE_LEASE_MS))) {
    return;
  }

  const outcome = await applyAccidentsImport(plan, String(admin._id), since);
  const counts = { imported: outcome.imported, alreadyThere: outcome.alreadyThere, ...notes };
  if (outcome.failures.length > 0) {
    await recordGoLiveFailure(ACCIDENTS_RELOAD_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { failures: outcome.failures },
      'fleet go-live: the 1 October accidents book finished WITH FAILURES — the run is left unfinished and will be retried after its lease',
    );
    return;
  }
  await finishGoLiveRun(ACCIDENTS_RELOAD_GO_LIVE_MARK, counts);
  logger.info(
    counts,
    'fleet go-live: the 1 October accidents book imported — done, and never again',
  );
};

/** What the long-running processes call. Not awaited, cannot reject, skipped under test. */
export const startAccidentsReloadGoLive = (): void => {
  if (isTest) return;
  void runAccidentsReloadGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'fleet go-live: the 1 October accidents book failed to import — no boot was harmed',
    );
  });
};
