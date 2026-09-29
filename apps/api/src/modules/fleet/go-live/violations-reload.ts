// The go-live VIOLATIONS RELOAD, as a boot step — everything recorded on this system up to 23
// September swept off the violations screen, and the old system's `car_violations` book written
// again in its place, painted green.
//
// THE INSTRUCTION, verbatim, because each clause of it is a rule below:
//
//   «دى المخلفات امسح من ecms كل المخالفات لحد يوم 23 يعنى من يوم 24 البدايه وكل اللى فى الملف
//    ضيفه ويكون الصف لونه اخضر»
//
// «امسح من ecms كل المخالفات لحد يوم 23» — every violation RECORDED here up to the end of 23
// September, Cairo time: the first import's rows (`violations.ts`, which landed on 20 September)
// and whatever was typed beside them before the 24th. Recorded means `createdAt`, the moment the
// row was written on this system — never the fine's own date or year, because a fine typed on the
// 25th for something that happened in March is work done from the 24th on.
//
// «يعنى من يوم 24 البدايه» — the 24th is where this system's own record begins. A row written
// from then on is left EXACTLY as it is: not moved, not re-dated, not recoloured.
//
// «وكل اللى فى الملف ضيفه» — then EVERY row of the book is written again, by the same parse, the
// same plan and the same write the first import used (`violations-import.ts`), so the two can
// never disagree about what a row of the book says. The book is the same export the first import
// read — the owner's upload is byte-for-byte `assets/fleet-go-live/car-violations.json` — so this
// step ships no copy of it.
//
// «ويكون الصف لونه اخضر» — every row it writes carries `fromOldBook: true`, and the two boards
// paint those rows green. A row somebody types is `false` and keeps the normal colour.
//
// THE DELETION IS SOFT, like every deletion in these books: «لو فى صفوف كانت ممسوحه عاوزها موجوده
// والdeleted 1 زى ما هى» and «الداتا اللى ممسوحه متظهرش للمستخدم تبقى فى الداتا بيز فقط». A swept
// row goes off every board and out of every total and stays in the collection — `isDeleted`,
// `deletedAt` now, `deletedBy` null because a boot did this and not a person, `__v` moved so a
// form still open on it is refused as stale. The book's own deleted rows arrive deleted again,
// as they did the first time.
//
// THE ORDER IS THE WHOLE STEP: sweep first, then write. Written the other way round, the sweep
// would have to tell the rows it had just written from the ones it was meant to take, and a
// sweep that misjudged it would delete the book it was reloading. So the write never starts until
// the sweep has succeeded, and a sweep that fails leaves the run unfinished with nothing written.
//
// A TAKE-OVER IS SAFE AT BOTH ENDS. The sweep takes only rows recorded before the cutoff and
// never a row of the book (`violationsRecordedBefore`), so a second attempt finds nothing new to
// delete — the first attempt's rows were written after the cutoff and are the book's. The write
// counts only the book's rows as «already there» (`existingByKey`), so it skips what the first
// attempt landed and does not mistake the rows it swept, or a matching fine somebody typed, for
// the book.
//
// THE GRIEVANCE FIGURES go with the fines, with one difference `grievancesRecordedBefore`
// explains: a figure somebody set again from the 24th on is left, and the book's figure for that
// year is listed beside it rather than written over it.
//
// IT WAITS FOR THE CARS AND FOR THE FIRST IMPORT. The cars because every row names one by code;
// the first import because sweeping before it had finished would leave its later rows standing
// beside the reload's — the same book on the board twice.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { type FleetGrievanceDoc, type FleetViolationDoc } from '../violations/violation.model';
import {
  fleetGrievanceRepository,
  fleetViolationRepository,
} from '../violations/violation.repository';
import {
  claimGoLiveRun,
  finishGoLiveRun,
  FleetGoLiveRunModel,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { day, resolveDrivers } from './odometer-import';
import { resolveGoLiveDataDir, VEHICLE_GO_LIVE_MARK } from './vehicles';
import { CAR_VIOLATIONS_FILE, VIOLATIONS_GO_LIVE_MARK } from './violations';
import {
  applyViolationsImport,
  loadViolationTypes,
  parseViolations,
  planViolationsImport,
} from './violations-import';

/**
 * The run key. v1: sweep what was recorded up to 23 September, write the book again. A different
 * cutoff, or a second reload, is a new version — never this one run again.
 */
export const VIOLATIONS_RELOAD_MARK = 'go-live:violations-reload:v1';

/** The first import's lease. A sweep is one write; a thousand rows in a hundred inserts is seconds. */
export const VIOLATIONS_RELOAD_LEASE_MS = 30 * 60 * 1000;

/**
 * THE LINE: midnight at the START of 24 September 2026, Cairo — «من يوم 24 البدايه».
 *
 * Written as the UTC instant, because that is what `createdAt` is stored as: Egypt keeps summer
 * time from the last Friday of April to the last Thursday of October, so on 24 September Cairo is
 * UTC+3 and its midnight is 21:00 the evening before. Everything recorded BEFORE this instant is
 * «لحد يوم 23»; this instant itself belongs to the 24th and is kept.
 */
export const VIOLATIONS_RELOAD_CUTOFF = new Date('2026-09-23T21:00:00.000Z');

/** How many of a long list the row keeps. The count travels whole where it matters; the list is a sample. */
const REPORT_CAP = 25;

/** What the sweep did — written to the run row as soon as it is done, and again at the end. */
export interface ViolationsReloadSweep {
  /** The line, as an instant — so the row says which midnight it meant. */
  cutoff: string;
  /** Fines the sweep has deleted — on this attempt and any earlier one. */
  deletedViolations: number;
  /** Grievance figures the sweep has deleted — likewise. */
  deletedGrievances: number;
  /** Live fines recorded here from the 24th on — left exactly as they are. */
  keptRecordedSince: number;
  /**
   * Swept fines somebody had CHANGED from the 24th on — a tick, a carry, a corrected amount. The
   * book's copy comes back without that change, so these are named for somebody to redo.
   */
  changedSinceCutoff: string[];
  changedSinceCutoffCount: number;
  /** Grievance figures recorded before the 24th but set again since — not swept, and named. */
  grievancesKeptSinceCutoff: string[];
}

/** How a swept fine is named on the run: its car, its year or day, its money, ✓ if it was ticked. */
export const describeViolation = (
  row: Pick<
    FleetViolationDoc,
    'kind' | 'vehicleId' | 'vehicleCode' | 'year' | 'date' | 'amount' | 'collected'
  >,
  codeOfId: ReadonlyMap<string, string>,
): string => {
  const code =
    row.vehicleCode ?? (row.vehicleId === null ? null : codeOfId.get(String(row.vehicleId))) ?? '—';
  const when =
    row.kind === 'vehicle' ? String(row.year ?? '—') : row.date === null ? '—' : day(row.date);
  return `${code} ${when}: ${row.amount}${row.collected ? ' ✓' : ''}`;
};

/** How a grievance figure is named on the run — the shape `grievancesKept` already uses. */
const describeGrievance = (
  row: Pick<FleetGrievanceDoc, 'vehicleId' | 'year' | 'totalBeforeGrievance'>,
  codeOfId: ReadonlyMap<string, string>,
): string =>
  `${codeOfId.get(String(row.vehicleId)) ?? '—'} ${row.year}: ${row.totalBeforeGrievance}`;

/**
 * What an EARLIER attempt of this run wrote about its sweep, if one got that far — `null` when
 * none did (no row, or a row that only holds a refusal).
 *
 * The one thing a take-over cannot find again for itself: which swept fines somebody had changed
 * since the 24th. The sweep's own write moves `updatedAt`, so once a row is swept that question
 * has no answer left in the collection — only on the run row, where the first attempt put it
 * BEFORE it swept (`sweepRecordedBeforeCutoff`). The counts need no such help
 * (`countSweptBefore` finds them again), and neither do the kept grievance figures, which nothing
 * here touches.
 */
const previousSweep = async (): Promise<{ changed: string[]; count: number } | null> => {
  const run = await FleetGoLiveRunModel.findOne({ key: VIOLATIONS_RELOAD_MARK }).lean().exec();
  const outcome = (run?.outcome ?? {}) as Partial<ViolationsReloadSweep>;
  if (!Array.isArray(outcome.changedSinceCutoff)) return null;
  const changed = outcome.changedSinceCutoff.filter(
    (entry): entry is string => typeof entry === 'string',
  );
  const count =
    typeof outcome.changedSinceCutoffCount === 'number'
      ? outcome.changedSinceCutoffCount
      : changed.length;
  return { changed, count };
};

/**
 * This attempt's findings joined to an earlier attempt's, without counting a row twice.
 *
 * An earlier attempt wrote its list BEFORE it swept, so everything it could see is already in it.
 * What this attempt finds again is what that attempt did not get to sweep — the same rows, already
 * counted — so the count is the larger of the two, never their sum. Without an earlier list, this
 * attempt's findings are the whole answer.
 */
const joinChanged = (
  previous: { changed: string[]; count: number } | null,
  found: readonly string[],
): { changed: string[]; count: number } => {
  if (previous === null) return { changed: found.slice(0, REPORT_CAP), count: found.length };
  const joined = [...new Set([...previous.changed, ...found])];
  return {
    changed: joined.slice(0, REPORT_CAP),
    count: Math.max(previous.count, found.length, joined.length),
  };
};

/** The list the sweep keeps on the run row — read back into a failure's outcome, never lost. */
const keptChangedList = async (): Promise<Record<string, unknown>> => {
  try {
    const kept = await previousSweep();
    return kept === null
      ? {}
      : { changedSinceCutoff: kept.changed, changedSinceCutoffCount: kept.count };
  } catch {
    // The database that failed the sweep may fail this read too; the failure is still recorded.
    return {};
  }
};

/**
 * (a) THE SWEEP — the fines and the grievance figures recorded before the cutoff, soft-deleted,
 * and an account of it.
 *
 * Exported so a test can drive it with the repositories stubbed; the run below calls it after the
 * claim and before a single row of the book is written.
 */
export const sweepRecordedBeforeCutoff = async (
  codeOfId: ReadonlyMap<string, string>,
  at: Date = new Date(),
): Promise<ViolationsReloadSweep> => {
  const cutoff = VIOLATIONS_RELOAD_CUTOFF;
  // Asked BEFORE the sweep — its own write moves `updatedAt` and the answer would be gone.
  const changed = joinChanged(
    await previousSweep(),
    (await fleetViolationRepository.recordedBeforeChangedSince(cutoff)).map((row) =>
      describeViolation(row, codeOfId),
    ),
  );
  // And WRITTEN DOWN before the sweep, too. `updateMany` is not one atomic act across documents:
  // a sweep cut off halfway has already moved `updatedAt` on the rows it reached, and a process
  // that dies between the sweep and the next write to the run row takes the list with it. On the
  // row first, the list survives both, and the next attempt joins it (`joinChanged`).
  await FleetGoLiveRunModel.updateOne(
    { key: VIOLATIONS_RELOAD_MARK },
    {
      $set: {
        outcome: {
          stage: 'sweeping',
          cutoff: cutoff.toISOString(),
          changedSinceCutoff: changed.changed,
          changedSinceCutoffCount: changed.count,
        },
      },
    },
  ).exec();
  const keptRecordedSince = await fleetViolationRepository.countRecordedSince(cutoff);

  const sweptNow = await fleetViolationRepository.softDeleteRecordedBefore(cutoff, at);
  const grievancesSweptNow = await fleetGrievanceRepository.softDeleteRecordedBefore(cutoff, at);
  logger.info(
    { cutoff: cutoff.toISOString(), violations: sweptNow, grievances: grievancesSweptNow },
    'fleet go-live: violations recorded before 24 September swept (soft-deleted) — writing the book again',
  );

  return {
    cutoff: cutoff.toISOString(),
    // The WHOLE sweep, found again from the rows themselves — a take-over's own modifiedCount is
    // whatever the first attempt left, usually nothing, and «0 deleted» is not what happened.
    deletedViolations: await fleetViolationRepository.countSweptBefore(cutoff),
    deletedGrievances: await fleetGrievanceRepository.countSweptBefore(cutoff),
    keptRecordedSince,
    changedSinceCutoff: changed.changed,
    changedSinceCutoffCount: changed.count,
    grievancesKeptSinceCutoff: (await fleetGrievanceRepository.recordedBeforeChangedSince(cutoff))
      .map((row) => describeGrievance(row, codeOfId))
      .slice(0, REPORT_CAP),
  };
};

/**
 * Run the reload, once, and report. Exported so a test can await the whole thing; the boot uses
 * `startViolationsReloadGoLive` below, which is this without the waiting.
 *
 * EVERY REFUSAL HAPPENS BEFORE THE RUN IS CLAIMED, for the reason `vehicles.ts` gives.
 */
export const runViolationsReloadGoLive = async (dataDir?: string): Promise<void> => {
  const dir = dataDir ?? resolveGoLiveDataDir();
  if (dir === null) {
    logger.error(
      'fleet go-live: the go-live data is not in this build — apps/api/assets/fleet-go-live is missing, so the violations were neither swept nor reloaded',
    );
    return;
  }
  const file = join(dir, CAR_VIOLATIONS_FILE);
  if (!existsSync(file)) {
    logger.error(
      { file },
      'fleet go-live: the violations book is not in this build — car-violations.json is missing, so the violations were neither swept nor reloaded',
    );
    return;
  }

  // The cars, and the first import — see the header. Nothing is swept until both are done.
  if (!(await waitForGoLiveRuns([VEHICLE_GO_LIVE_MARK, VIOLATIONS_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the vehicle registry or the first violations import has not finished — the reload waits for the next boot; nothing was swept or written and the run is NOT claimed',
    );
    await recordGoLiveRefusal(VIOLATIONS_RELOAD_MARK, { reason: 'violations-not-done' });
    return;
  }

  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the violations book — run the seed first; nothing was swept or written and the run is NOT claimed',
    );
    await recordGoLiveRefusal(VIOLATIONS_RELOAD_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }

  // THE SAME READING OF THE BOOK the first import made — `violations.ts`, line for line.
  const parsed = parseViolations(JSON.parse(await readFile(file, 'utf8')));
  const drivers = await resolveDrivers(parsed.driver.map((row) => row.driver));
  const codeIndex = await fleetVehicleRepository.codeIndex();
  const plan = planViolationsImport(parsed, codeIndex, await loadViolationTypes(), drivers.ids);
  const notes = {
    keptDeleted: parsed.keptDeleted,
    unreadable: parsed.unreadable.slice(0, REPORT_CAP),
    rejected: parsed.rejected.slice(0, REPORT_CAP),
    deletedRows: plan.deleted,
    unknownCars: plan.unknownCars,
    grievancesUnplaced: plan.grievancesUnplaced,
    zeroCount: plan.zeroCount,
    unknownTypes: plan.unknownTypes,
    grievanceConflicts: plan.grievanceConflicts,
    unmatchedDrivers: drivers.unmatched,
    ambiguousDrivers: drivers.ambiguous,
    placeholders: drivers.placeholders,
  };

  // THE CLAIM. Either this process holds the lease from here, or the job is done / somebody
  // else's — and in both of those cases there is nothing for this boot to do.
  if (!(await claimGoLiveRun(VIOLATIONS_RELOAD_MARK, VIOLATIONS_RELOAD_LEASE_MS))) return;

  // (a) THE SWEEP, and nothing else until it has succeeded.
  const codeOfId = new Map([...codeIndex].map(([code, id]) => [id, code]));
  let sweep: ViolationsReloadSweep;
  try {
    sweep = await sweepRecordedBeforeCutoff(codeOfId);
  } catch (error) {
    // Not one row of the book is written over a sweep that did not finish — the board would show
    // the book beside the rows it was meant to replace. Written to the row, left unfinished; the
    // next boot after the lease runs the sweep again, which takes only what is still there. The
    // list the sweep wrote down before it started is carried into the failure, not written over.
    await recordGoLiveFailure(VIOLATIONS_RELOAD_MARK, {
      stage: 'sweep',
      error: error instanceof Error ? error.message : String(error),
      failed: 1,
      ...(await keptChangedList()),
    });
    logger.error(
      { err: error },
      'fleet go-live: the violations sweep FAILED — nothing of the book was written; the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    return;
  }
  // On the row at once: if this process dies during the write, the next attempt still has the
  // one part of the account it cannot rebuild — see `previousSweep`.
  await FleetGoLiveRunModel.updateOne(
    { key: VIOLATIONS_RELOAD_MARK },
    { $set: { outcome: { stage: 'swept', ...sweep } } },
  ).exec();

  // (b) THE BOOK, written again.
  logger.info(
    {
      vehicles: plan.vehicles.length,
      rows: plan.vehicles.reduce((sum, v) => sum + v.rows.length, 0),
      grievances: plan.grievances.length,
    },
    'fleet go-live: reloading the violations book',
  );
  const outcome = await applyViolationsImport(plan, String(admin._id));
  const counts = {
    ...sweep,
    vehicles: plan.vehicles.length,
    imported: outcome.imported,
    alreadyThere: outcome.alreadyThere,
    namesFilled: outcome.namesFilled,
    grievancesWritten: outcome.grievancesWritten,
    grievancesKept: outcome.grievancesKept,
    typesCreated: outcome.typesCreated,
    ...notes,
  };
  if (outcome.failures.length > 0) {
    // NOT finished — the lease is left to expire and the next boot after it takes the job over:
    // the sweep finds nothing new, and the write skips every row of the book that already landed.
    await recordGoLiveFailure(VIOLATIONS_RELOAD_MARK, {
      ...counts,
      failed: outcome.failures.length,
      failures: outcome.failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { count: outcome.failures.length, failures: outcome.failures },
      'fleet go-live: violations reload finished WITH FAILURES — the run is left unfinished and will be retried by the next boot once its lease expires',
    );
    logger.error(counts, 'fleet go-live: partial violations reload');
    return;
  }
  await finishGoLiveRun(VIOLATIONS_RELOAD_MARK, counts);
  logger.info(
    counts,
    'fleet go-live: violations swept to 23 September and the book reloaded — done, and never again',
  );
};

/**
 * What the long-running processes call: start the step and carry on. Not awaited, cannot reject,
 * and skipped under test — all for the reasons `startVehicleGoLive` gives.
 */
export const startViolationsReloadGoLive = (): void => {
  if (isTest) return;
  void runViolationsReloadGoLive().catch((error: unknown) => {
    logger.error({ err: error }, 'fleet go-live: violations reload failed — no boot was harmed');
  });
};
