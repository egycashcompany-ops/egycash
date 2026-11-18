// Task 2 §5 — the read paths, over the history rather than over a week of it.
//
// WHAT THIS IS FOR. Until now the oldest attendance in ECMS was 90 days old, because that is all
// the import would accept. Task 2 removes that limit, so the employee page, the daily sheet and
// the payroll feed are about to be asked the same questions over 67,839 scans and the day rows
// derived from them — and a query that was instant over a quarter can be a collection scan over
// two years without anything changing in the code.
//
// The assertions are PLANS, not milliseconds: a timing threshold on shared CI is a coin toss, and
// what actually degrades is the plan. Each read must come off an index and must not examine many
// more documents than it returns — which is the thing that turns linear in the history.
//
// The dataset is seeded straight into the collections. This file is about query plans, and a plan
// depends on how many rows exist, not on how they got there; going through the services would take
// minutes and would be testing the services, which `hr-attendance.spec.ts` already does.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { moduleManifests } from '../../src/modules';
import {
  AttendanceDayModel,
  AttendancePunchModel,
} from '../../src/modules/hr/attendance';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';

let replSet: MongoMemoryReplSet | null = null;

/** 25 people × 2 years of days: the shape of this deployment's history, scaled to one test. */
const EMPLOYEES = 25;
const DAYS = 730;
const BRANCHES = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
const DEVICE = 'HQ-GATE-1';
const employeeIds = Array.from({ length: EMPLOYEES }, () => new Types.ObjectId());

/** Day one of the window, UTC-midnight date-only, as every attendance date is stored. */
const DAY_ZERO = Date.UTC(2024, 11, 26); // the machines' own first scan: 2024-12-26
const dayOnly = (index: number): Date => new Date(DAY_ZERO + index * 86_400_000);
const instant = (index: number, hour: number): Date =>
  new Date(DAY_ZERO + index * 86_400_000 + hour * 3_600_000);

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-attendance-history-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const planText = (explained: unknown): string => JSON.stringify(explained);

/** `totalDocsExamined` from anywhere in the explain tree — its path moves between versions. */
const examined = (explained: unknown): number => {
  const found = deepNumber(explained, 'totalDocsExamined');
  expect(found, 'totalDocsExamined missing from the explain output').toBeDefined();
  return found as number;
};

const deepNumber = (node: unknown, key: string): number | undefined => {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepNumber(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if (typeof record[key] === 'number') return record[key] as number;
  for (const value of Object.values(record)) {
    const found = deepNumber(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });

  const days: Record<string, unknown>[] = [];
  const punches: Record<string, unknown>[] = [];
  for (const [person, employeeId] of employeeIds.entries()) {
    const branchId = BRANCHES[person % BRANCHES.length] as Types.ObjectId;
    for (let day = 0; day < DAYS; day += 1) {
      days.push({
        employeeId,
        workDate: dayOnly(day),
        branchId,
        status: day % 7 === 5 || day % 7 === 6 ? 'weekend' : 'present',
        shiftId: null,
        firstInAt: instant(day, 7),
        lastOutAt: instant(day, 15),
        workedMinutes: 480,
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        approvedOvertimeMinutes: 0,
        flags: [],
        leaveId: null,
        holidayId: null,
        frozenAt: null,
        schemaVersion: 1,
        isDeleted: false,
      });
      // Two scans a day — in and out — which is what the heaviest branch actually sends.
      for (const hour of [7, 15]) {
        punches.push({
          employeeId,
          at: instant(day, hour),
          direction: 'unknown',
          source: 'device',
          deviceId: DEVICE,
          branchIdAtPunch: branchId,
          employeeBranchId: branchId,
          importBatchId: 'seed',
          supersededBy: null,
          note: null,
          recordedBy: null,
          schemaVersion: 1,
          isDeleted: false,
        });
      }
    }
  }

  const BATCH = 5_000;
  for (let i = 0; i < days.length; i += BATCH) {
    await AttendanceDayModel.collection.insertMany(days.slice(i, i + BATCH) as never[]);
  }
  for (let i = 0; i < punches.length; i += BATCH) {
    await AttendancePunchModel.collection.insertMany(punches.slice(i, i + BATCH) as never[]);
  }

  // The models declare the indexes; make sure they exist before anything is explained.
  await Promise.all([AttendanceDayModel.createIndexes(), AttendancePunchModel.createIndexes()]);
}, 300_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the attendance read paths over two years of history (Task 2 §5)', () => {
  it('seeded the history the rest of the file is about', async () => {
    expect(await AttendanceDayModel.countDocuments({})).toBe(EMPLOYEES * DAYS);
    expect(await AttendancePunchModel.countDocuments({})).toBe(EMPLOYEES * DAYS * 2);
  });

  /**
   * THE EMPLOYEE PAGE. One person, one period — the query behind the month calendar, the KPIs, the
   * hours-per-day bars and the daily record, all of which read the same page of rows. `{employeeId,
   * workDate}` is the index, and the month must cost a month: 31 documents examined, not 18,250.
   */
  it('one employee’s month comes off {employeeId, workDate} and examines only that month', async () => {
    const explained = await AttendanceDayModel.find({
      employeeId: employeeIds[0] as Types.ObjectId,
      workDate: { $gte: dayOnly(400), $lte: dayOnly(430) },
      isDeleted: false,
    })
      .sort({ workDate: 1 })
      .explain('executionStats');

    const plan = planText(explained);
    expect(plan).toContain('ux_employee_workDate');
    expect(plan).not.toContain('COLLSCAN');
    // 31 days asked for. The ceiling is deliberately loose about the plan's own bookkeeping and
    // tight about the thing that matters: it must not grow with the history behind the window.
    expect(examined(explained)).toBeLessThanOrEqual(40);
  });

  /** The same read over the WHOLE history — the 92-day summary cap is on the contract, not here. */
  it('a two-year window still examines only what it returns', async () => {
    const explained = await AttendanceDayModel.find({
      employeeId: employeeIds[1] as Types.ObjectId,
      workDate: { $gte: dayOnly(0), $lte: dayOnly(DAYS - 1) },
      isDeleted: false,
    })
      .sort({ workDate: 1 })
      .explain('executionStats');
    expect(planText(explained)).toContain('ux_employee_workDate');
    // One person's two years, not twenty-five people's.
    expect(examined(explained)).toBeLessThanOrEqual(DAYS + 10);
  });

  /**
   * THE DAILY SHEET. One day, several branches. It starts from the employees and left-joins the day
   * rows (stage 2), so what has to stay cheap is finding one day's rows — which is
   * `{workDate, branchId}`, and must cost a day rather than a history.
   */
  it('the daily sheet’s day lookup comes off {workDate, branchId}', async () => {
    const explained = await AttendanceDayModel.find({
      workDate: { $gte: dayOnly(500), $lte: dayOnly(500) },
      branchId: { $in: [BRANCHES[0] as Types.ObjectId, BRANCHES[1] as Types.ObjectId] },
      isDeleted: false,
    }).explain('executionStats');

    const plan = planText(explained);
    expect(plan).toContain('IXSCAN');
    expect(plan).not.toContain('COLLSCAN');
    // Two branches of 25 people on one day: well under a hundred, whatever the history holds.
    expect(examined(explained)).toBeLessThanOrEqual(100);
  });

  /**
   * THE DERIVATION'S OWN READ, which runs on every `days/recompute` — so every few seconds, all
   * morning, from every branch. `{employeeId, at}` is the index, and a Cairo day of scans must cost
   * a day of scans even when the person has two years of them.
   */
  it('the engine’s punch window comes off {employeeId, at}', async () => {
    const explained = await AttendancePunchModel.find({
      employeeId: employeeIds[2] as Types.ObjectId,
      at: { $gte: instant(600, 0), $lt: instant(601, 0) },
      supersededBy: null,
    })
      .sort({ at: 1 })
      .explain('executionStats');

    const plan = planText(explained);
    expect(plan).toContain('ix_employee_at');
    expect(plan).not.toContain('COLLSCAN');
    expect(examined(explained)).toBeLessThanOrEqual(10);
  });

  /**
   * THE IMPORT'S IDEMPOTENCY PROBE. `{deviceId, at, employeeId}` is the unique key that makes a
   * branch re-sending its whole 67,839-row file safe, and it is consulted once per row — so it is
   * the one read in this module that runs tens of thousands of times in a minute.
   */
  it('the import’s duplicate check comes off {deviceId, at, employeeId}', async () => {
    const explained = await AttendancePunchModel.find({
      deviceId: DEVICE,
      at: instant(700, 7),
      employeeId: employeeIds[3] as Types.ObjectId,
    }).explain('executionStats');

    const plan = planText(explained);
    expect(plan).toContain('IXSCAN');
    expect(plan).not.toContain('COLLSCAN');
    expect(examined(explained)).toBeLessThanOrEqual(5);
  });

  /** «Last scan», which the daily sheet's header and the employee header both read. */
  it('the newest scan in a window comes off an index and stops at the first row', async () => {
    const explained = await AttendancePunchModel.find({
      employeeId: { $in: [employeeIds[4] as Types.ObjectId] },
      at: { $gte: instant(0, 0), $lt: instant(DAYS, 0) },
      supersededBy: null,
    })
      .sort({ at: -1 })
      .limit(1)
      .explain('executionStats');

    const plan = planText(explained);
    expect(plan).toContain('ix_employee_at');
    expect(plan).not.toContain('COLLSCAN');
    // Walked backwards from the end of the index: a handful of documents, not two years of them.
    expect(examined(explained)).toBeLessThanOrEqual(10);
  });

  /** The branch axis the sheet's arrival chart reads — `{employeeBranchId, at}`. */
  it('one branch’s scans for one day come off {employeeBranchId, at}', async () => {
    const explained = await AttendancePunchModel.find({
      employeeBranchId: BRANCHES[0] as Types.ObjectId,
      at: { $gte: instant(650, 0), $lt: instant(651, 0) },
      supersededBy: null,
    }).explain('executionStats');

    const plan = planText(explained);
    expect(plan).toContain('ix_employeeBranch_at');
    expect(plan).not.toContain('COLLSCAN');
    expect(examined(explained)).toBeLessThanOrEqual(100);
  });

  /**
   * THE ONE READ THAT IS A SCAN, said out loud rather than discovered later.
   *
   * The backfill's `withPunches` plan asks «which employee-days carry a scan in this window», which
   * matches on `at` ALONE — and no index starts with `at` (`{employeeId, at}` and
   * `{employeeBranchId, at}` both have it second). So this one grouped pass reads the punch
   * collection.
   *
   * THAT IS THE RIGHT TRADE, and it is a decision, not an oversight. It runs once per backfill —
   * not per request, per import or per recompute — and a scan of this collection is cheap at the
   * sizes involved. An index on `at` would be paid for on every one of the ~1,300 inserts a day
   * the branches make, for ever, to speed up a job somebody runs by hand. If a backfill ever wants
   * narrowing, it already takes `employeeIds`.
   */
  it('the backfill plan is a deliberate single pass, and nothing else scans', async () => {
    const explained = await AttendancePunchModel.aggregate([
      { $match: { at: { $gte: instant(0, 0), $lt: instant(DAYS, 0) }, supersededBy: null } },
      { $group: { _id: { employeeId: '$employeeId', at: '$at' } } },
      { $limit: 1 },
    ]).explain('executionStats');
    expect(planText(explained)).toContain('COLLSCAN');
  });
});
