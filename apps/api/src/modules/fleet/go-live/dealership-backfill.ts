// The go-live DEALERSHIP BACKFILL — the rows «التوكيل» never opened for the visits that left the
// workshop before the screen went live, opened once, by the deploy.
//
// «دول مظهروش فى شاشه التوكيل». Which visits, and why those, is in `dealership-backfill-plan.ts`;
// this file reads the visits, opens what the plan says, and reports. The shape is
// `readings-fix.ts`'s: one run key, refusals before the claim, the outcome on the run row because
// the owner cannot read the log, and a run with failures left unfinished for the next boot.
//
// THE CHECK-OUT'S OWN RULES. Each visit's rows are opened by `openRowsOfVisit`, the function the
// check-out itself calls — so «صيانة + إصلاح» splits into two rows, «ملاكي» comes from the car's
// operation, and the bill opens on «لا يوجد» exactly as on a check-out, never by a copy that could
// drift from it. Each row is audited as a check-out's is, under the seeding admin as on every
// audited step, with this run's key as its source.
//
// IT WAITS FOR THE WORKSHOP IMPORT AND THE WORKSHOP SYNC: the visits are theirs, and a visit not
// yet written, or not yet closed by the second export, would be passed over for good once this is
// done. On production both finished weeks ago and the wait is one query.
//
// IDEMPOTENT, which is what makes the lease's take-over safe: a visit an earlier attempt opened
// has rows, and a visit with rows is never opened again. Existing rows are only ever counted —
// never written, never re-opened, never deleted.
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../../platform/users';
import { fleetDealershipRepository } from '../dealership/dealership.repository';
import { fleetDealershipService } from '../dealership/dealership.service';
import {
  FleetMaintenanceVisitModel,
  type FleetMaintenanceVisitDoc,
} from '../maintenance/maintenance.model';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import {
  DEALERSHIP_BACKFILL_FROM,
  dayOf,
  decideBackfill,
  earlierOpened,
  openedLine,
  planDealershipBackfill,
  type BackfillSkip,
  type BackfillVisit,
} from './dealership-backfill-plan';
import {
  FleetGoLiveRunModel,
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { MAINTENANCE_GO_LIVE_MARK } from './maintenance';
import { MAINTENANCE_SYNC_GO_LIVE_MARK } from './maintenance-sync';

/** The run key — versioned like every go-live step's; a second backfill is a v2 somebody reviews. */
export const DEALERSHIP_BACKFILL_GO_LIVE_MARK = 'go-live:dealership-backfill:v1';
export const DEALERSHIP_BACKFILL_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

/** How many of a long list the row keeps. The count travels whole; the list is a sample. */
const REPORT_CAP = 25;

export interface DealershipBackfillOutcome {
  /** The first exit day the rule takes. */
  from: string;
  /** Visits out on or after that day — deleted ones too, so the skips below add up. */
  visitsSeen: number;
  /** Visits given rows by this attempt. */
  opened: number;
  /** Rows this attempt opened — two for a visit whose work was «صيانة + إصلاح». */
  rowsCreated: number;
  skipped: number;
  skippedDeleted: number;
  /** Visits that already had rows, deleted or not — the screen's, or an earlier attempt's. */
  skippedHadRows: number;
  /** Reopened while this ran. */
  skippedStillIn: number;
  skippedBefore: number;
  /** «code day: what» for the first visits opened. */
  openedVisits: string[];
}

interface VisitFailure {
  visit: string;
  reason: string;
}

const toBackfillVisit = (
  doc: FleetMaintenanceVisitDoc,
): BackfillVisit & { doc: FleetMaintenanceVisitDoc } => ({
  id: String(doc._id),
  outDate: doc.outDate,
  isDeleted: doc.isDeleted,
  doc,
});

const startOfDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export const applyDealershipBackfill = async (
  by: string,
): Promise<{ outcome: DealershipBackfillOutcome; failures: VisitFailure[] }> => {
  // Deleted visits are read too — only to be counted, so the row says how many the rule passed over.
  const visits = await FleetMaintenanceVisitModel.find({
    outDate: { $gte: startOfDay(DEALERSHIP_BACKFILL_FROM) },
  })
    .sort({ outDate: 1, _id: 1 })
    .lean<FleetMaintenanceVisitDoc[]>()
    .exec();
  const withRows = await fleetDealershipRepository.visitIdsWithAnyRows(
    visits.map((visit) => String(visit._id)),
  );
  const plan = planDealershipBackfill(visits.map(toBackfillVisit), withRows);
  const skipped: Record<BackfillSkip, number> = { ...plan.skipped };
  const codes = await fleetVehicleRepository.codesByIds([
    ...new Set(
      plan.backfill.flatMap(({ doc }) => (doc.vehicleId == null ? [] : [String(doc.vehicleId)])),
    ),
  ]);
  const codeOf = (doc: FleetMaintenanceVisitDoc): string | null =>
    doc.vehicleId == null ? (doc.vehicleCode ?? null) : (codes.get(String(doc.vehicleId)) ?? null);

  const actor = { userId: by, ip: null, userAgent: null };
  const failures: VisitFailure[] = [];
  const openedVisits: string[] = [];
  let opened = 0;
  let rowsCreated = 0;
  for (const { doc } of plan.backfill) {
    const id = String(doc._id);
    try {
      // Read again just before, and decided again on what it is now: the screen stays live while
      // this runs, and a visit reopened, deleted or checked out again since the list was read is
      // not the visit the plan saw.
      const fresh = await FleetMaintenanceVisitModel.findById(doc._id)
        .lean<FleetMaintenanceVisitDoc>()
        .exec();
      if (fresh === null) {
        skipped.deleted += 1;
        continue;
      }
      const hasRows = (await fleetDealershipRepository.visitIdsWithAnyRows([id])).has(id);
      const decision = decideBackfill(toBackfillVisit(fresh), hasRows);
      if (decision !== 'backfill') {
        skipped[decision] += 1;
        continue;
      }
      const rows = await fleetDealershipService.openRowsOfVisit(fresh, by, {
        actor,
        source: DEALERSHIP_BACKFILL_GO_LIVE_MARK,
      });
      opened += 1;
      rowsCreated += rows.length;
      openedVisits.push(
        openedLine(
          codeOf(fresh),
          fresh.outDate,
          rows.map((row) => row.workTypeLabel),
        ),
      );
    } catch (error) {
      failures.push({
        visit: `${codeOf(doc) ?? '—'} ${doc.outDate === null ? '—' : dayOf(doc.outDate)} (${id})`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    outcome: {
      from: DEALERSHIP_BACKFILL_FROM,
      visitsSeen: visits.length,
      opened,
      rowsCreated,
      skipped: skipped.deleted + skipped.hadRows + skipped.stillIn + skipped.before,
      skippedDeleted: skipped.deleted,
      skippedHadRows: skipped.hadRows,
      skippedStillIn: skipped.stillIn,
      skippedBefore: skipped.before,
      openedVisits: openedVisits.slice(0, REPORT_CAP),
    },
    failures,
  };
};

/** The earlier attempts' counts, as the row carries them — only where they opened something. */
const carried = (earlier: { opened: number; rowsCreated: number }): Record<string, number> =>
  earlier.opened === 0 && earlier.rowsCreated === 0
    ? {}
    : { openedEarlier: earlier.opened, rowsCreatedEarlier: earlier.rowsCreated };

/** Run the step, once. Exported so a test can await it; the boot uses the starter below. */
export const runDealershipBackfillGoLive = async (): Promise<void> => {
  if (!(await waitForGoLiveRuns([MAINTENANCE_GO_LIVE_MARK, MAINTENANCE_SYNC_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the workshop book or its second export has not finished — the dealership backfill waits for the next boot; nothing was opened and the run is NOT claimed',
    );
    await recordGoLiveRefusal(DEALERSHIP_BACKFILL_GO_LIVE_MARK, { reason: 'maintenance-not-done' });
    return;
  }
  // The seeding admin authors every row, as on every audited step. Before the claim, so an
  // unseeded deployment can try again once seeded.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the dealership backfill — nothing was opened and the run is NOT claimed',
    );
    await recordGoLiveRefusal(DEALERSHIP_BACKFILL_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }
  if (
    !(await claimGoLiveRun(DEALERSHIP_BACKFILL_GO_LIVE_MARK, DEALERSHIP_BACKFILL_GO_LIVE_LEASE_MS))
  ) {
    return;
  }

  // What an earlier, failed attempt opened — read before this one writes over the row.
  const run = await FleetGoLiveRunModel.findOne({ key: DEALERSHIP_BACKFILL_GO_LIVE_MARK })
    .lean()
    .exec();
  const earlier = carried(earlierOpened(run?.outcome));

  let result;
  try {
    result = await applyDealershipBackfill(String(admin._id));
  } catch (error) {
    // Outside the per-visit loop — the list of visits, their rows or their cars could not be read.
    // Written to the row, then rethrown for the boot's own catch; the lease expires and the next
    // boot retries.
    await recordGoLiveFailure(DEALERSHIP_BACKFILL_GO_LIVE_MARK, {
      ...earlier,
      stage: 'visits',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const { failures } = result;
  const outcome = { ...result.outcome, ...earlier };
  if (failures.length > 0) {
    // NOT finished: the next boot after the lease takes it over, and finds what landed already there.
    await recordGoLiveFailure(DEALERSHIP_BACKFILL_GO_LIVE_MARK, {
      ...outcome,
      failed: failures.length,
      failures: failures.slice(0, REPORT_CAP),
    });
    logger.error(
      { failures },
      'fleet go-live: the dealership backfill finished WITH FAILURES — left unfinished, retried by the next boot once its lease expires',
    );
    logger.error(outcome, 'fleet go-live: partial dealership backfill');
    return;
  }
  await finishGoLiveRun(DEALERSHIP_BACKFILL_GO_LIVE_MARK, { ...outcome });
  logger.info(
    outcome,
    'fleet go-live: the dealership rows of the visits out since 1 September opened — done, and never again',
  );
};

/** What the long-running processes call. Not awaited, cannot reject, skipped under test. */
export const startDealershipBackfillGoLive = (): void => {
  if (isTest) return;
  void runDealershipBackfillGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'fleet go-live: the dealership backfill failed — no boot was harmed',
    );
  });
};
