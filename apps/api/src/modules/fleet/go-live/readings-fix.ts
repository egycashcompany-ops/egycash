// Cars 219, 295, 248 and 249 — the live readings and the last maintenance counter brought into
// line with what the owner read off the live system on 11 October 2026, once, by the deploy.
//
// «الرقم اللى بعد التاريخ دا بتاع الصيانه الرقم التانى بتاعت القراءة اللى النهارده». What is decided,
// and why, is in `readings-fix-plan.ts`; this file reads the rows, writes what the plan says, and
// reports. The shape is `odometer-fix.ts`'s: one run key, refusals before the claim, every write
// guarded on the exact figure it was decided against — so a row somebody corrected since is left
// as they left it — and the outcome on the run row, because the owner cannot read the log.
//
// ONE TRANSACTION PER CAR for its readings: the row that held the figure and the row closed past
// it move together or not at all, so the chain is never seen half re-linked. The visit's counter
// is one document and needs none. Every change is audited under the seeding admin, as the other
// audited steps are, and every row keeps the figure it held in its notes.
//
// IDEMPOTENT. A second attempt finds no figure above the owner's reading, none read above the
// owner's maintenance counter before its day (a2), the counter already the owner's, and only
// reports — which is what makes the lease's take-over safe; what an earlier
// attempt wrote is read off the run row and kept on it, not reported away as «nothing». Nothing is
// written for 266, 246 and 503: «لما نضيف داتا باقى الفروع هبعتهالك».
import { FleetSettingKeys } from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { env, isTest } from '../../../infrastructure/config/env';
import { logger } from '../../../infrastructure/logging/logger';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { settingsService } from '../../../platform/settings';
import { userService } from '../../../platform/users';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { computeAlarm, computeAlarms } from '../maintenance/maintenance-alarm';
import {
  FleetMaintenanceVisitModel,
  type FleetMaintenanceVisitDoc,
} from '../maintenance/maintenance.model';
import { fleetMaintenanceRepository } from '../maintenance/maintenance.repository';
import { FleetOdometerLogModel, type FleetOdometerLogDoc } from '../odometer/odometer.model';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import {
  FleetGoLiveRunModel,
  claimGoLiveRun,
  finishGoLiveRun,
  recordGoLiveFailure,
  recordGoLiveRefusal,
  waitForGoLiveRuns,
} from './go-live-run.model';
import { noteWith } from './legacy-row';
import { MAINTENANCE_SYNC_GO_LIVE_MARK } from './maintenance-sync';
import { ODOMETER_SYNC_GO_LIVE_MARK } from './odometer-sync';
import {
  OWNER_DAY,
  OWNER_FACTS,
  clearedNote,
  counterNote,
  dayOf,
  describeAlarm,
  describeOnceRecorded,
  describeToday,
  earlierWrites,
  pickServiceVisit,
  planCounter,
  planTypoReadings,
  reclosedNote,
  startOfDay,
  withEarlierWrites,
  type OwnerFact,
  type ServiceVisit,
  type TypoPlan,
} from './readings-fix-plan';

/** The run key. The three cars still to come are a v2 — a change somebody reviews. */
export const READINGS_FIX_GO_LIVE_MARK = 'go-live:readings-fix:v1';
export const READINGS_FIX_GO_LIVE_LEASE_MS = 30 * 60 * 1000;

export interface ReadingsFixOutcome {
  /** Cars this run wrote something on. */
  applied: string[];
  /** «code: why» — cars it wrote nothing on. */
  skipped: string[];
  /**
   * «code day: out → in» — rows now days without a reading: they opened on an impossible figure,
   * or (a2) closed on one with nothing possible to close on instead; (a2)'s carry «; why».
   */
  readingsCleared: string[];
  /**
   * «code day: out → old, now → new» — rows that closed on one, or (a2) on a row now cleared,
   * closed on the next reading; (a2)'s carry «; why».
   */
  readingsReclosed: string[];
  /** «code: figures — reason» — impossible figures found and left, because the rule cannot apply. */
  readingsLeft: string[];
  /** «code day field: old → owner's» — the last maintenance counter set. */
  countersSet: string[];
  /** «code day: figure» — the counter was already the owner's. */
  countersAlready: string[];
  /** «code day: why» — no visit, several, or a write that would put the way out below the way in. */
  countersLeft: string[];
  /** «code: …» — the owner's visit is not the one the maintenance alarm measures from. */
  notBaseline: string[];
  /** «code day: …» — today's reading: on the board or not, and would the board take it. */
  todayReading: string[];
  /** «code: …» — the maintenance board after this run. */
  alarmNow: string[];
  /** «code: …» — the board once the owner's reading of today is recorded, beside the owner's figure. */
  alarmOnceRecorded: string[];
  notInRegistry: string[];
}

interface CarFailure {
  code: string;
  reason: string;
}

const dayRange = (day: string): { $gte: Date; $lt: Date } => {
  const start = startOfDay(day);
  return { $gte: start, $lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
};

/** The version guard, where the row has one — rows inserted by hand in a test may not. */
const versionOf = (doc: { __v?: number }): { __v?: number } =>
  typeof doc.__v === 'number' ? { __v: doc.__v } : {};

const asText = (value: number | null): string | null => (value === null ? null : String(value));

interface RowWrite {
  id: string;
  changes: { field: string; old: unknown; new: unknown }[];
}

/**
 * (a) and (a2) The car's impossible figures, in ONE transaction. Read and decided inside it, so a
 * retried transaction decides again against what is there rather than against what was.
 */
const fixReadings = async (
  fact: OwnerFact,
  vehicleId: Types.ObjectId,
  by: Types.ObjectId,
): Promise<{ plan: TypoPlan; writes: RowWrite[] }> =>
  unitOfWork(async (session: ClientSession) => {
    const rows = await FleetOdometerLogModel.find({
      vehicleId,
      isDeleted: false,
      outReading: { $ne: null },
    })
      .sort({ date: 1, _id: 1 })
      .session(session)
      .lean<FleetOdometerLogDoc[]>()
      .exec();
    const empty = await FleetOdometerLogModel.find(
      { vehicleId, isDeleted: false, outReading: null },
      { date: 1 },
    )
      .session(session)
      .lean<Pick<FleetOdometerLogDoc, 'date'>[]>()
      .exec();
    const plan = planTypoReadings(
      rows.map((row) => ({
        id: String(row._id),
        date: row.date,
        out: row.outReading as number,
        in: row.inReading,
        notes: row.notes,
      })),
      fact.today,
      startOfDay(OWNER_DAY),
      empty.map((row) => dayOf(row.date)),
      // (a2) «113325 دى اخر صيانه» — no reading before that day stands above it.
      { before: startOfDay(fact.serviceDay), counter: fact.counter },
    );
    if (plan.kind !== 'fix') return { plan, writes: [] };

    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const writes: RowWrite[] = [];
    // Only a live row still holding EXACTLY the figures read above. Anything else means somebody
    // wrote to the car while this ran: the whole car is rolled back and the run retried.
    const write = async (
      doc: FleetOdometerLogDoc,
      set: Partial<FleetOdometerLogDoc>,
    ): Promise<void> => {
      const result = await FleetOdometerLogModel.updateOne(
        {
          _id: doc._id,
          vehicleId,
          isDeleted: false,
          outReading: doc.outReading,
          inReading: doc.inReading,
          ...versionOf(doc),
        },
        { $set: { ...set, updatedBy: by }, $inc: { __v: 1 } },
        { session },
      ).exec();
      if (result.modifiedCount !== 1) {
        throw new Error(
          `${fact.code} ${dayOf(doc.date)}: the reading changed while this ran — nothing was written for this car`,
        );
      }
    };

    // The cleared rows FIRST: one of them may be the car's open period, and the row closed past it
    // may become the open one — in this order `ux_open_period` never sees two.
    for (const row of plan.clear) {
      const doc = byId.get(row.id) as FleetOdometerLogDoc;
      const notes = noteWith(doc.notes, clearedNote(row));
      await write(doc, { outReading: null, inReading: null, km: null, notes });
      writes.push({
        id: row.id,
        changes: [
          { field: 'outReading', old: asText(row.out), new: null },
          { field: 'inReading', old: asText(row.in), new: null },
          { field: 'dayWithoutReading', old: null, new: true },
          { field: 'notes', old: doc.notes, new: notes },
        ],
      });
    }
    for (const row of plan.reclose) {
      const doc = byId.get(row.id) as FleetOdometerLogDoc;
      const notes = noteWith(doc.notes, reclosedNote(row));
      await write(doc, {
        inReading: row.newIn,
        km: row.newIn === null ? null : row.newIn - row.out,
        notes,
      });
      writes.push({
        id: row.id,
        changes: [
          { field: 'inReading', old: asText(row.oldIn), new: asText(row.newIn) },
          { field: 'notes', old: doc.notes, new: notes },
        ],
      });
    }
    return { plan, writes };
  });

/** The visit, as much of it as the plan reads. */
const toServiceVisit = (visit: FleetMaintenanceVisitDoc): ServiceVisit => ({
  id: String(visit._id),
  inDate: visit.inDate,
  outDate: visit.outDate,
  // `?? null`: a visit written before the exit counter existed carries no field at all.
  odometerAtService: visit.odometerAtService ?? null,
  exitOdometer: visit.exitOdometer ?? null,
  notes: visit.notes,
});

/** The settings and the work types the alarm reads, asked once for the four cars. */
interface AlarmContext {
  yellowKm: number;
  redKm: number;
  countingIds: string[];
}

/**
 * Everything the run row says about one car once its writes are in: today's reading, whether the
 * owner's visit is the one the alarm measures from, and the alarm once today's reading is on the
 * board. Read-only.
 */
const reportCar = async (
  fact: OwnerFact,
  vehicle: FleetVehicleDoc,
  matched: ServiceVisit | null,
  ctx: AlarmContext,
  outcome: ReadingsFixOutcome,
): Promise<void> => {
  const id = String(vehicle._id);

  // (c) Today's reading — never written here; the clerk records it on the board.
  const onDay = await FleetOdometerLogModel.find({
    vehicleId: vehicle._id,
    isDeleted: false,
    date: dayRange(OWNER_DAY),
  })
    .lean<FleetOdometerLogDoc[]>()
    .exec();
  const bounds = await fleetOdometerRepository.chainBounds(id, startOfDay(OWNER_DAY));
  outcome.todayReading.push(
    describeToday(fact, {
      onDay: onDay.map((row) => row.outReading),
      writable: isVehicleWritable(vehicle.status),
      lower: bounds.lower,
      upper: bounds.upper,
    }),
  );

  // Is the owner's visit the one the alarm measures from?
  const baseline =
    (await fleetMaintenanceRepository.alarmBaselines([id], ctx.countingIds)).get(id) ?? null;
  if (matched !== null && baseline?.visitId !== matched.id) {
    const visit = await FleetMaintenanceVisitModel.findById(matched.id)
      .lean<FleetMaintenanceVisitDoc>()
      .exec();
    const why =
      visit === null
        ? 'it is gone'
        : visit.outDate === null
          ? 'it is still open'
          : !ctx.countingIds.includes(String(visit.workTypeId))
            ? 'its work type does not count for the alarm'
            : 'another counting visit came out on the same day or later';
    const from =
      baseline === null
        ? 'the car has no counting visit at all'
        : `it measures from the visit that came out on ${dayOf(baseline.serviceDate)}`;
    outcome.notBaseline.push(
      `${fact.code}: the ${fact.serviceDay} visit is not the alarm's — ${why}; ${from}`,
    );
  }

  // The board once the owner's reading of today is the latest — by the alarm's own rule.
  if (baseline === null) {
    outcome.alarmOnceRecorded.push(`${fact.code}: still no figure — noService`);
    return;
  }
  const lower =
    (
      await fleetOdometerRepository.lowerBoundsAt([{ vehicleId: id, on: baseline.counterDate }])
    ).get(id) ?? null;
  const type = await fleetVehicleTypeRepository.findById(String(vehicle.typeId));
  // A counting visit with no counter is measured from the reading the car stood at — as on the board.
  const counter = baseline.odometerAtService ?? lower?.reading ?? null;
  const once = computeAlarm({
    intervalKm: type?.maintenanceIntervalKm ?? 0,
    yellowKm: ctx.yellowKm,
    redKm: ctx.redKm,
    latestReading: fact.today,
    latestReadingDate: startOfDay(OWNER_DAY),
    baselineCounter: counter,
    baselineDate: baseline.serviceDate,
    baselineLowerBound: lower?.reading ?? null,
  });
  outcome.alarmOnceRecorded.push(describeOnceRecorded(fact, once, { counter, lower }));
};

export const applyReadingsFix = async (
  by: string,
): Promise<{ outcome: ReadingsFixOutcome; failures: CarFailure[] }> => {
  const outcome: ReadingsFixOutcome = {
    applied: [],
    skipped: [],
    readingsCleared: [],
    readingsReclosed: [],
    readingsLeft: [],
    countersSet: [],
    countersAlready: [],
    countersLeft: [],
    notBaseline: [],
    todayReading: [],
    alarmNow: [],
    alarmOnceRecorded: [],
    notInRegistry: [],
  };
  const failures: CarFailure[] = [];
  const admin = new Types.ObjectId(by);
  const actor = { userId: by, ip: null, userAgent: null };
  const [yellowKm, redKm, countingIds] = await Promise.all([
    settingsService.resolve<number>(FleetSettingKeys.AlarmYellowKm, {
      userId: null,
      branchId: null,
    }),
    settingsService.resolve<number>(FleetSettingKeys.AlarmRedKm, { userId: null, branchId: null }),
    fleetCatalogItemRepository.countingWorkTypeIds(),
  ]);
  const ctx: AlarmContext = { yellowKm, redKm, countingIds };
  const reported: string[] = [];

  for (const fact of OWNER_FACTS) {
    const done: string[] = [];
    const kept: string[] = [];
    try {
      const vehicle = await fleetVehicleRepository.findByCode(fact.code);
      if (vehicle === null) {
        outcome.notInRegistry.push(fact.code);
        outcome.skipped.push(`${fact.code}: not in the registry`);
        continue;
      }

      // (a) and (a2) The readings. (a)'s lines read as they always did — an earlier attempt's run
      // row is matched line for line (`withEarlierWrites`); (a2)'s say which figure refused them.
      const { plan, writes } = await fixReadings(fact, vehicle._id, admin);
      const why = (text: string | null): string => (text === null ? '' : `; ${text}`);
      if (plan.kind === 'fix') {
        for (const row of plan.clear) {
          outcome.readingsCleared.push(
            `${fact.code} ${dayOf(row.date)}: ${row.out} → ${row.in ?? '—'} — now a day without a reading${why(row.why)}`,
          );
        }
        for (const row of plan.reclose) {
          outcome.readingsReclosed.push(
            `${fact.code} ${dayOf(row.date)}: ${row.out} → ${row.oldIn}, now → ${row.newIn ?? '— (the open period)'}${why(row.why)}`,
          );
        }
        done.push(`${plan.clear.length + plan.reclose.length} readings`);
      } else if (plan.kind === 'left') {
        outcome.readingsLeft.push(`${fact.code}: ${plan.found.join(' · ')} — ${plan.reason}`);
        kept.push('readings left');
      } else {
        kept.push(
          `no reading above ${fact.today} before ${OWNER_DAY}, nor above ${fact.counter} before ${fact.serviceDay}`,
        );
      }
      for (const write of writes) {
        await auditService.record({
          entityRef: { moduleId: 'fleet', entityType: 'odometerLog', entityId: write.id },
          action: 'correct',
          changes: [
            ...write.changes,
            { field: 'source', old: null, new: READINGS_FIX_GO_LIVE_MARK },
          ],
          actor,
        });
      }

      // (b) The last maintenance counter.
      const visits = await FleetMaintenanceVisitModel.find({
        vehicleId: vehicle._id,
        isDeleted: false,
        $or: [{ inDate: dayRange(fact.serviceDay) }, { outDate: dayRange(fact.serviceDay) }],
      })
        .lean<FleetMaintenanceVisitDoc[]>()
        .exec();
      const pick = pickServiceVisit(visits.map(toServiceVisit), fact.serviceDay);
      let matched: ServiceVisit | null = null;
      if (pick.kind === 'none') {
        outcome.countersLeft.push(`${fact.code} ${fact.serviceDay}: no visit on that day`);
        kept.push('no visit on the day');
      } else if (pick.kind === 'several') {
        outcome.countersLeft.push(
          `${fact.code} ${fact.serviceDay}: ${pick.visits.length} visits on that day — which one is the owner's to say`,
        );
        kept.push('several visits on the day');
      } else {
        matched = pick.visit;
        const counter = planCounter(pick.visit, fact.serviceDay, fact.counter);
        // A visit that came out on a LATER day with an exit counter is measured from that counter,
        // not from the one the owner gave — said, not changed: the exit counter is not the owner's.
        if (counter.field === 'odometerAtService' && pick.visit.exitOdometer !== null) {
          outcome.notBaseline.push(
            `${fact.code}: the alarm measures the ${fact.serviceDay} visit from its exit counter ${pick.visit.exitOdometer}, not from the counter at the maintenance`,
          );
        }
        if (counter.kind === 'already') {
          outcome.countersAlready.push(`${fact.code} ${fact.serviceDay}: ${fact.counter}`);
          kept.push(`the ${fact.serviceDay} counter is already ${fact.counter}`);
        } else if (counter.kind === 'conflict') {
          outcome.countersLeft.push(`${fact.code} ${fact.serviceDay}: ${counter.reason}`);
          kept.push('counter left');
        } else {
          const doc = visits.find(
            (visit) => String(visit._id) === pick.visit.id,
          ) as FleetMaintenanceVisitDoc;
          const notes = noteWith(doc.notes, counterNote(counter.field, counter.old));
          // Guarded on exactly what it was decided against — both counters and the day out, which
          // chose the field. `null` matches a field the visit does not carry at all, too.
          const result = await FleetMaintenanceVisitModel.updateOne(
            {
              _id: doc._id,
              isDeleted: false,
              outDate: doc.outDate,
              odometerAtService: pick.visit.odometerAtService,
              exitOdometer: pick.visit.exitOdometer,
              ...versionOf(doc),
            },
            { $set: { [counter.field]: fact.counter, notes, updatedBy: admin }, $inc: { __v: 1 } },
          ).exec();
          if (result.modifiedCount !== 1) {
            throw new Error(
              `${fact.code} ${fact.serviceDay}: the visit changed while this ran — its counter was not set`,
            );
          }
          await auditService.record({
            entityRef: {
              moduleId: 'fleet',
              entityType: 'maintenanceVisit',
              entityId: pick.visit.id,
            },
            action: 'update',
            changes: [
              { field: counter.field, old: asText(counter.old), new: String(fact.counter) },
              { field: 'notes', old: doc.notes, new: notes },
              { field: 'source', old: null, new: READINGS_FIX_GO_LIVE_MARK },
            ],
            actor,
          });
          outcome.countersSet.push(
            `${fact.code} ${fact.serviceDay} ${counter.field}: ${counter.old ?? '—'} → ${fact.counter}`,
          );
          done.push(`the ${fact.serviceDay} counter`);
        }
      }

      if (done.length > 0) outcome.applied.push(`${fact.code}: ${done.join(', ')}`);
      else outcome.skipped.push(`${fact.code}: ${kept.join('; ')}`);

      // (c) and the board — after the car's writes, so it reports what is there now.
      await reportCar(fact, vehicle, matched, ctx, outcome);
      reported.push(fact.code);
    } catch (error) {
      // What landed before the failure is said too — the retry finds it done and says nothing of it.
      if (done.length > 0) outcome.applied.push(`${fact.code}: ${done.join(', ')}`);
      failures.push({
        code: fact.code,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The board as the screen computes it — once, for every car this run reported on.
  const alarms = await computeAlarms();
  for (const code of reported) {
    outcome.alarmNow.push(describeAlarm(code, alarms.find((alarm) => alarm.code === code) ?? null));
  }
  return { outcome, failures };
};

/** Run the step, once. Exported so a test can await it; the boot uses the starter below. */
export const runReadingsFixGoLive = async (): Promise<void> => {
  // Both books' second exports are what the four cars' rows came from; on production they finished
  // weeks ago and this is one query.
  if (!(await waitForGoLiveRuns([ODOMETER_SYNC_GO_LIVE_MARK, MAINTENANCE_SYNC_GO_LIVE_MARK]))) {
    logger.warn(
      'fleet go-live: the odometer or the workshop sync has not finished — cars 219, 295, 248 and 249 wait for the next boot; nothing was written and the run is NOT claimed',
    );
    await recordGoLiveRefusal(READINGS_FIX_GO_LIVE_MARK, { reason: 'syncs-not-done' });
    return;
  }
  // The seeding admin authors every change, as on every audited step. Before the claim, so an
  // unseeded deployment can try again once seeded.
  const admin = await userService.findByEmail(env.SEED_ADMIN_EMAIL);
  if (admin === null) {
    logger.error(
      { email: env.SEED_ADMIN_EMAIL },
      'fleet go-live: no seeded admin to author the readings fix — nothing was written and the run is NOT claimed',
    );
    await recordGoLiveRefusal(READINGS_FIX_GO_LIVE_MARK, {
      reason: 'no-admin',
      email: env.SEED_ADMIN_EMAIL,
    });
    return;
  }
  if (!(await claimGoLiveRun(READINGS_FIX_GO_LIVE_MARK, READINGS_FIX_GO_LIVE_LEASE_MS))) return;

  // What an earlier, failed attempt wrote — read before this one writes over the row, and carried
  // into whatever this one writes there (`withEarlierWrites`).
  const run = await FleetGoLiveRunModel.findOne({ key: READINGS_FIX_GO_LIVE_MARK }).lean().exec();
  const earlier = earlierWrites(run?.outcome);

  let result;
  try {
    result = await applyReadingsFix(String(admin._id));
  } catch (error) {
    // Outside the per-car loop — the settings, the catalog or the board. Written to the row, then
    // rethrown for the boot's own catch; the lease expires and the next boot retries.
    await recordGoLiveFailure(READINGS_FIX_GO_LIVE_MARK, {
      ...earlier,
      stage: 'report',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const { failures } = result;
  const outcome = withEarlierWrites(earlier, result.outcome);
  if (failures.length > 0) {
    // NOT finished: the next boot after the lease takes it over and finds what landed already there.
    await recordGoLiveFailure(READINGS_FIX_GO_LIVE_MARK, {
      ...outcome,
      failed: failures.length,
      failures,
    });
    logger.error(
      { failures },
      'fleet go-live: the readings fix for cars 219, 295, 248 and 249 finished WITH FAILURES — left unfinished, retried by the next boot once its lease expires',
    );
    logger.error(outcome, 'fleet go-live: partial readings fix');
    return;
  }
  await finishGoLiveRun(READINGS_FIX_GO_LIVE_MARK, { ...outcome });
  logger.info(
    outcome,
    'fleet go-live: cars 219, 295, 248 and 249 set to the owner’s readings — done, and never again',
  );
};

/** What the long-running processes call. Not awaited, cannot reject, skipped under test. */
export const startReadingsFixGoLive = (): void => {
  if (isTest) return;
  void runReadingsFixGoLive().catch((error: unknown) => {
    logger.error(
      { err: error },
      'fleet go-live: the readings fix for cars 219, 295, 248 and 249 failed — no boot was harmed',
    );
  });
};
