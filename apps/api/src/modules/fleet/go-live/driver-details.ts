// The go-live DRIVER FACTS, as a boot step — «الوظيفة / التخصص / الرخصة / تاريخ الرخصة» and the
// area, from the old HR register and the old drivers book, onto the drivers registry.
//
// «ضيف الداتا دى بتاعت السواقيين عشان كانت ناقصه». The licence-scan step's shape
// (`driver-photos.ts`, and `vehicles.ts` at length): the same lease, the same refusals before the
// claim, the same «not on the boot's critical path», the same «nothing here can fail a boot». What
// is different about these facts — the two books, the join, the words — is in
// `driver-details-import.ts`.
//
// IT DEPENDS ON NO OTHER STEP. The facts are keyed by the employee code, and the people are HR's,
// already there. The one step it can meet is the licence scans, which also opens profiles; the
// apply handles that meeting (a profile opened by the other a moment earlier is filled, not
// opened twice), so neither waits for the other.
//
// IT IS IDEMPOTENT PER FIELD, which is what makes the lease's take-over safe: only an EMPTY field
// is written, so a re-run finds everything it wrote no longer empty and writes nothing again.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { getDirectoryEmployeeByCode } from '../../../platform/directory';
import { userService } from '../../../platform/users';
import { drivingSeatRoster } from '../driver-profiles/driving-seat-roster';
import {
  applyDriverDetails,
  DRIVER_DETAILS_FILE,
  LEGACY_DRIVERS_FILE,
  parseDriverDetails,
  parseLegacyDrivers,
  planDriverDetails,
} from './driver-details-import';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
} from './go-live-run.model';
import { resolveGoLiveDataDir } from './vehicles';

/** The run key — versioned like every go-live step's. */
export const DRIVER_DETAILS_GO_LIVE_MARK = 'go-live:drivers:v1';

/** Three hundred drivers is seconds; thirty minutes is «certainly dead». */
export const DRIVER_DETAILS_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

const REPORT_CAP = 25;

/**
 * The planned drivers HR has in no driving seat, told apart the way the licence scans tell them —
 * «add the employee» and «flag their job title as a driving seat» are different people's jobs.
 */
const explainNotOnRegistry = async (
  lines: readonly string[],
): Promise<{ unknownCodes: string[]; notDrivers: string[] }> => {
  const unknownCodes: string[] = [];
  const notDrivers: string[] = [];
  for (const line of lines) {
    const code = line.split(' — ')[0] ?? line;
    if ((await getDirectoryEmployeeByCode(code)) === null) unknownCodes.push(line);
    else notDrivers.push(line);
  }
  return { unknownCodes, notDrivers };
};

/**
 * Run the step, once, and report. Exported so a test can await it; the boot uses
 * `startDriverDetailsGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives.
 */
export const runDriverDetailsGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so no driver fact was imported',
    );
    return;
  }
  const detailsFile = join(dir, DRIVER_DETAILS_FILE);
  const legacyFile = join(dir, LEGACY_DRIVERS_FILE);
  if (!existsSync(detailsFile) || !existsSync(legacyFile)) {
    logger.error(
      { detailsFile, legacyFile },
      "fleet go-live: the drivers' books are not in this build — nothing was imported and the run is NOT claimed",
    );
    return;
  }

  const details = parseDriverDetails(JSON.parse(await readFile(detailsFile, 'utf8')));
  const legacy = parseLegacyDrivers(JSON.parse(await readFile(legacyFile, 'utf8')));
  if (details.rejected.length > 0 || legacy.rejected.length > 0) {
    logger.error(
      { details: details.rejected, legacy: legacy.rejected },
      "fleet go-live: rows of the drivers' books that name nobody — nothing was imported and the run is NOT claimed, so a corrected build will import them",
    );
    await recordGoLiveRefusal(DRIVER_DETAILS_GO_LIVE_MARK, {
      reason: 'rejected-rows',
      rows: [...details.rejected, ...legacy.rejected].slice(0, REPORT_CAP),
    });
    return;
  }

  // The seeding admin authors every profile and every catalog word, exactly as the other steps'
  // rows are authored. Looked up BEFORE the claim, so an unseeded deployment can try again.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the driver facts — run the seed first; nothing was imported and the run is NOT claimed',
    );
    await recordGoLiveRefusal(DRIVER_DETAILS_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  // Leavers INCLUDED: their facts are kept too, on a profile opened switched off — see the apply.
  const roster = await drivingSeatRoster({ includeExited: true });
  const plan = planDriverDetails(details.rows, legacy.rows, roster);

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(DRIVER_DETAILS_GO_LIVE_MARK, DRIVER_DETAILS_GO_LIVE_LEASE_MS))) return;

  logger.info({ drivers: plan.drivers.length }, "fleet go-live: writing the drivers' facts");
  const outcome = await applyDriverDetails(plan, roster, String(admin._id));
  const explained = await explainNotOnRegistry(outcome.notOnRegistry);
  const counts = {
    drivers: plan.drivers.length,
    enrolled: outcome.enrolled,
    filled: outcome.filled,
    alreadyThere: outcome.alreadyThere,
    keptOnScreen: outcome.keptOnScreen,
    enrolledExited: outcome.enrolledExited,
    catalogCreated: outcome.catalogCreated,
    unknownCodes: explained.unknownCodes,
    notDrivers: explained.notDrivers,
    unmatchedLegacy: plan.unmatchedLegacy,
    ambiguousLegacy: plan.ambiguousLegacy,
    deletedRows: plan.deletedRows,
    duplicateCodes: plan.duplicateCodes,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over,
    // finding every field already written no longer empty.
    await recordGoLiveFailure(DRIVER_DETAILS_GO_LIVE_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: driver facts finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    return;
  }
  await finishGoLiveRun(DRIVER_DETAILS_GO_LIVE_MARK, counts);
  logger.info(counts, "fleet go-live: the drivers' facts are in — done, and never again");
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startDriverDetailsGoLive = (): void => {
  if (isTest) return;
  void runDriverDetailsGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: driver facts failed — no boot was harmed');
  });
};
