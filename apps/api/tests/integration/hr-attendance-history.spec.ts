// Task 2 — the full attendance history from the branch machines.
//
// WHY ITS OWN FILE. `hr-attendance.spec.ts` holds the AT-4 freeze test, and `freezePeriod` walks
// EVERY computable employee × every day of the month — so every test that registers an employee in
// that file makes that one test slower, and these eleven registered fourteen. Keeping the history
// here leaves the freeze test's cost where it was and lets the two files run side by side.
//
// Everything else is the same harness `hr-attendance.spec.ts` uses: its own in-memory replica set,
// its own super-admin and outsider logins, and the seeded GENERAL shift.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  HrAttendanceSettingKeys,
  type AttendanceDayDto,
  type AttendanceDecisionDto,
  type AttendanceBackfillDto,
  type AttendanceQuarantineRetryResultDto,
  type AttendanceQuarantineRowDto,
  type AttendanceUnmatchedIdDto,
  type EmployeeDto,
  type ImportPunchesResultDto,
  type ShiftDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { getCache } from '../../src/infrastructure/redis/cache';
import { addDays, cairoToday, dateOnlyIso, isoWeekday } from '../../src/modules/hr/shared/business-date';
import {
  cairoInstant,
  AttendanceBackfillChunkModel,
  AttendanceBackfillModel,
  AttendanceDayModel,
  type AttendanceBackfillChunkDoc,
} from '../../src/modules/hr/attendance';
import { Types } from 'mongoose';
import { SettingValueModel } from '../../src/platform/settings/setting-value.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let outsiderToken: string;
let BRANCH_ID = '';
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';
let GENERAL: ShiftDto;
let phoneCounter = 60_000_000;
let nidCounter = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-attendance-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string, branchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      // A branch is needed for a `branch`-scoped grant to resolve to anything: the scope filter
      // reads the caller's own unit.
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
    },
    null,
  );
  await userService.setPassword(String(user._id), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(user._id));
  return String(user._id);
};

const login = async (identifier: string): Promise<string> => {
  await getCache().delByPrefix('rl:'); // keep strict auth rate-limits out of the way
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const nextPhone = (): string => `011${String(phoneCounter++).padStart(8, '0')}`;
const nextNid = (): string => `290010101${String(100 + nidCounter++)}10`;

/** Placed in the suite's branch and department unless told otherwise (the daily sheet's filters). */
const regEmployee = async (
  placement: { branchId: string; departmentId: string; sectionId?: string } | null = null,
): Promise<EmployeeDto> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr: 'موظف الحضور', nationalId: nextNid(), nationality: 'Egyptian' },
        contact: { primaryPhone: nextPhone() },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
        jobTitleId: JOB_TITLE_ID,
        departmentId: placement?.departmentId ?? DEPARTMENT_ID,
        branchId: placement?.branchId ?? BRANCH_ID,
        ...(placement?.sectionId === undefined ? {} : { sectionId: placement.sectionId }),
        employmentType: 'fullTime',
        probationMonths: 0,
        startDate: '2024-01-01T00:00:00.000Z',
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
    });
  expect(res.status).toBe(201);
  return res.body.data as EmployeeDto;
};

let HOLIDAY_ISO: Set<string> = new Set();

/** A recent WORKDAY — not Fri/Sat and not a seeded public holiday — inside the punch window. */
const recentWorkday = (): Date => {
  let day = addDays(cairoToday(), -10);
  while ([5, 6].includes(isoWeekday(day)) || HOLIDAY_ISO.has(dateOnlyIso(day))) {
    day = addDays(day, 1);
  }
  return day;
};

const assign = async (employeeId: string, shiftId: string): Promise<void> => {
  const res = await request(app)
    .post('/api/v1/hr/attendance/assignments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ employeeId, shiftId, fromDate: '2024-01-02' });
  expect(res.status).toBe(201);
};

const recompute = async (employeeId: string, day: Date): Promise<{ computed: number; skippedFrozen: number }> => {
  const res = await request(app)
    .post('/api/v1/hr/attendance/days/recompute')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ employeeId, from: dateOnlyIso(day), to: dateOnlyIso(day) });
  expect(res.status).toBe(200);
  return res.body.data as { computed: number; skippedFrozen: number };
};

const dayRow = async (employeeId: string, day: Date): Promise<AttendanceDayDto> => {
  const res = await request(app)
    .get(
      `/api/v1/hr/attendance/days?from=${dateOnlyIso(day)}&to=${dateOnlyIso(day)}&employeeId=${employeeId}`,
    )
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const rows = res.body.data as AttendanceDayDto[];
  expect(rows).toHaveLength(1);
  return rows[0] as AttendanceDayDto;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminId,
    sessionId: 'seed',
    branchId: null,
    departmentId: null,
    sectionId: null,
    locale: 'en',
    permissions: { 'setting.edit': 'organization' },
    permissionVersion: 1,
    isPrivileged: true,
  };
  await settingsService.set(ctx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });

  // ABSENCE ON for this file, against the shipped default. Its subject is two years of imported
  // history and what the read paths make of it, and «absent» is the word the derivation produces
  // for an expected day nobody turned up to. The owner's ruling of 18 November — «lateness only
  // for now», so such a day reads «لا يوجد تسجيل» — is a decision about what the company
  // publishes, covered in `attendance-settings-defaults.spec.ts` and `derive-day.spec.ts`.
  await settingsService.set(ctx, {
    key: HrAttendanceSettingKeys.CountAbsence,
    scope: 'organization',
    value: true,
  });
  adminToken = await login('admin@ecms.local');
  await mkUser('outsider@ecms.local');
  outsiderToken = await login('outsider@ecms.local');

  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '001', name: { ar: 'المركز', en: 'HQ' } });
  BRANCH_ID = (branchRes.body as { data: { id: string } }).data.id;
  const depRes = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DEP-AT-1', name: { ar: 'إدارة', en: 'Ops' }, branchId: BRANCH_ID });
  DEPARTMENT_ID = (depRes.body as { data: { id: string } }).data.id;
  const titleRes = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-AT-1', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
  JOB_TITLE_ID = (titleRes.body as { data: { id: string } }).data.id;

  const shiftsRes = await request(app)
    .get('/api/v1/hr/attendance/shifts')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(shiftsRes.status).toBe(200);
  const seeded = (shiftsRes.body.data as ShiftDto[]).find((s) => s.code === 'GENERAL');
  expect(seeded).toBeDefined();
  GENERAL = seeded as ShiftDto;

  // The seeded Egyptian public holidays could land inside the test window; the workday picker
  // must skip them or an expected `absent` would derive as `holiday`.
  const calRes = await request(app)
    .get(
      `/api/v1/hr/work-calendar?from=${dateOnlyIso(addDays(cairoToday(), -15))}&to=${dateOnlyIso(cairoToday())}`,
    )
    .set('Authorization', `Bearer ${adminToken}`);
  expect(calRes.status).toBe(200);
  const holidays = (calRes.body.data as { holidays: { date: string }[] }).holidays;
  HOLIDAY_ISO = new Set(holidays.map((h) => h.date.slice(0, 10)));
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});
const settingCtx = (): AuthContext => ({
  userId: new Types.ObjectId().toString(),
  sessionId: 'seed',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'en',
  permissions: { 'setting.edit': 'organization' },
  permissionVersion: 1,
  isPrivileged: true,
});

/**
 * Registered once per wall by an administrator; 409 means an earlier test already did it. Returns
 * the device's id, which is what an enrolment mapping is keyed on.
 */
const registerDevice = async (code: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v1/hr/attendance/devices')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code, name: `Gate ${code}`, branchId: BRANCH_ID });
  expect([201, 409]).toContain(res.status);
  if (res.status === 201) return (res.body.data as { id: string }).id;
  const listed = await request(app)
    .get(`/api/v1/hr/attendance/devices?search=${code}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(listed.status).toBe(200);
  const found = (listed.body.data as { id: string; code: string }[]).find((d) => d.code === code);
  expect(found, `device ${code}`).toBeDefined();
  return (found as { id: string }).id;
};

const importRows = async (
  rows: Record<string, unknown>[],
): Promise<ImportPunchesResultDto> => {
  const res = await request(app)
    .post('/api/v1/hr/attendance/punches/import')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ rows });
  expect(res.status).toBe(200);
  return res.body.data as ImportPunchesResultDto;
};

const punchesOfBatch = async (batchId: string): Promise<unknown[]> => {
  const res = await request(app)
    .get(`/api/v1/hr/attendance/punches?importBatchId=${batchId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body.data as unknown[];
};

/** The seeded public holidays inside an arbitrary window — `HOLIDAY_ISO` only covers recent days. */
const holidaysBetween = async (from: Date, to: Date): Promise<Set<string>> => {
  const res = await request(app)
    .get(`/api/v1/hr/work-calendar?from=${dateOnlyIso(from)}&to=${dateOnlyIso(to)}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const holidays = (res.body.data as { holidays: { date: string }[] }).holidays;
  return new Set(holidays.map((h) => h.date.slice(0, 10)));
};

/**
 * `count` workdays starting around `daysBack` days ago — Fri/Sat and public holidays skipped.
 *
 * The backfill tests reach back a year and more, where `recentWorkday`'s pre-loaded holiday set
 * does not reach, and a date that turns out to be Eid derives as `holiday` instead of what the
 * scans say — a false failure that says nothing about the backfill.
 */
const olderWorkdays = async (daysBack: number, count: number): Promise<Date[]> => {
  const start = addDays(cairoToday(), -daysBack);
  const holidays = await holidaysBetween(start, addDays(start, 30));
  const out: Date[] = [];
  for (let day = start; out.length < count; day = addDays(day, 1)) {
    if ([5, 6].includes(isoWeekday(day)) || holidays.has(dateOnlyIso(day))) continue;
    out.push(day);
  }
  return out;
};

/**
 * A workday inside the default 7-day window a manager may decide alone — so the decision applies
 * at once and the test is about the backfill, not about the HR approval queue.
 */
const nearWorkday = (): Date => {
  let day = addDays(cairoToday(), -2);
  while ([5, 6].includes(isoWeekday(day)) || HOLIDAY_ISO.has(dateOnlyIso(day))) {
    day = addDays(day, -1);
  }
  return day;
};

// ── Task 2 — the full history from the branch machines ──────────────────────
//
// The 90-day age guard read as a sanity check and was doing something else entirely: the branch
// app refuses to offer anything the limit would reject, so 62,505 of the 67,839 scans sitting on
// the machines had never reached ECMS and nothing said why. These tests pin the three things that
// had to become true before that history could be sent: an old scan is accepted, a limit still
// exists for anyone who wants one, and a scan landing in a month Payroll has closed is STORED as
// evidence and COUNTED in the answer — never swallowed, and never allowed to move a frozen number.
describe('Task 2 — importing the full history', () => {
  // The limit is process-wide, so it goes back to its declared default (0 — none) by DELETING the
  // row, not by writing 0 over it, and the per-subject cache is dropped by prefix the way
  // `settingsService.set` does it.
  afterEach(async () => {
    await SettingValueModel.deleteMany({
      key: HrAttendanceSettingKeys.ImportMaxAgeDays,
    }).exec();
    await getCache().delByPrefix(`settings:${HrAttendanceSettingKeys.ImportMaxAgeDays}:`);
  });

  it('takes a scan from two years ago, and a re-send of the same file adds nothing', async () => {
    const emp = await regEmployee();
    await registerDevice('hist-1');
    const old = addDays(cairoToday(), -580);
    const rows = [
      {
        employeeNumber: emp.employeeNumber,
        at: cairoInstant(old, '08:47').toISOString(),
        deviceId: 'hist-1',
      },
      {
        employeeNumber: emp.employeeNumber,
        at: cairoInstant(old, '17:12').toISOString(),
        deviceId: 'hist-1',
      },
    ];

    const first = await importRows(rows);
    expect(first.imported).toBe(2);
    expect(first.quarantined).toEqual([]);
    expect(first.onFrozenDays).toBe(0);
    expect(await punchesOfBatch(first.batchId)).toHaveLength(2);

    // A branch re-sends its whole file after a dropped connection — the {deviceId, at, employeeId}
    // key is what makes that safe to do as often as it likes.
    const again = await importRows(rows);
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(2);
    expect(again.onFrozenDays).toBe(0);
  });

  it('still refuses old scans when somebody sets a limit, and takes them again when it is off', async () => {
    const emp = await regEmployee();
    await registerDevice('hist-2');
    const old = addDays(cairoToday(), -200);
    const row = {
      employeeNumber: emp.employeeNumber,
      at: cairoInstant(old, '09:00').toISOString(),
      deviceId: 'hist-2',
    };

    await settingsService.set(settingCtx(), {
      key: HrAttendanceSettingKeys.ImportMaxAgeDays,
      scope: 'organization',
      value: 90,
    });
    const refused = await importRows([row]);
    expect(refused.imported).toBe(0);
    expect(refused.quarantined[0]?.reason).toContain('older than 90 days');

    await settingsService.set(settingCtx(), {
      key: HrAttendanceSettingKeys.ImportMaxAgeDays,
      scope: 'organization',
      value: 0,
    });
    const accepted = await importRows([row]);
    expect(accepted.imported).toBe(1);
    expect(accepted.quarantined).toEqual([]);
  });

  it('keeps a frozen day frozen, stores the scans anyway, and counts only the frozen ones', async () => {
    const frozenEmp = await regEmployee();
    const openEmp = await regEmployee();
    await assign(frozenEmp.id, GENERAL.id);
    await assign(openEmp.id, GENERAL.id);
    await registerDevice('hist-3');
    const workday = recentWorkday();

    // Both start as a derived `absent`; only one of the two days is then closed by Payroll.
    await recompute(frozenEmp.id, workday);
    await recompute(openEmp.id, workday);
    const closed = await dayRow(frozenEmp.id, workday);
    expect(closed.status).toBe('absent');
    await AttendanceDayModel.updateOne(
      { _id: closed.id },
      { $set: { frozenAt: new Date() } },
    ).exec();

    const result = await importRows(
      [frozenEmp, openEmp].flatMap((emp) => [
        {
          employeeNumber: emp.employeeNumber,
          at: cairoInstant(workday, '09:00').toISOString(),
          deviceId: 'hist-3',
        },
        {
          employeeNumber: emp.employeeNumber,
          at: cairoInstant(workday, '17:00').toISOString(),
          deviceId: 'hist-3',
        },
      ]),
    );
    expect(result.imported).toBe(4);
    // Two of the four landed in the closed month. Said out loud, because a backfill reporting
    // «12,000 imported» and nothing else would look complete while a season of it moved no day.
    expect(result.onFrozenDays).toBe(2);
    expect(await punchesOfBatch(result.batchId)).toHaveLength(4);

    // The closed day refuses the recompute and keeps every number Payroll was given...
    const recomputed = await recompute(frozenEmp.id, workday);
    expect(recomputed.skippedFrozen).toBe(1);
    expect(recomputed.computed).toBe(0);
    const stillClosed = await dayRow(frozenEmp.id, workday);
    expect(stillClosed.status).toBe('absent');
    expect(stillClosed.workedMinutes).toBe(0);

    // ...while the open day takes the history and becomes what the scans say it was.
    await recompute(openEmp.id, workday);
    const reopened = await dayRow(openEmp.id, workday);
    expect(reopened.status).toBe('present');
    expect(reopened.workedMinutes).toBeGreaterThan(0);
  });
});

// ── Task 2 §4 — the quarantine is kept, reported and retried ────────────────
//
// 153 of the 655 people on the branch machines are no longer enrolled on them, so they have no
// `{deviceId, enrollmentNo}` mapping and their whole history quarantines on arrival. Reported in
// the response and stored nowhere, that is a dropped row with extra steps: the import runs
// overnight and nobody reads what it answered. These tests pin the four things that make it
// recoverable — the row is kept, a re-send does not multiply it, the unmatched ids read as a list
// somebody can work through, and the moment the link exists the history lands by itself.
describe('Task 2 — the quarantined rows', () => {
  const quarantine = async (deviceId: string, status = 'pending'): Promise<
    AttendanceQuarantineRowDto[]
  > => {
    const res = await request(app)
      .get(`/api/v1/hr/attendance/quarantine?deviceId=${deviceId}&status=${status}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.data as AttendanceQuarantineRowDto[];
  };

  const unmatched = async (): Promise<AttendanceUnmatchedIdDto[]> => {
    const res = await request(app)
      .get('/api/v1/hr/attendance/quarantine/unmatched')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.data as AttendanceUnmatchedIdDto[];
  };

  const link = async (
    deviceId: string,
    enrollmentNo: string,
    employeeId: string,
  ): Promise<void> => {
    const res = await request(app)
      .post('/api/v1/hr/attendance/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId, enrollmentNo, employeeId });
    expect(res.status).toBe(201);
  };

  it('keeps an unplaceable row, and a re-send of the file leaves ONE of it', async () => {
    await registerDevice('q-1');
    const [day] = (await olderWorkdays(500, 1)) as [Date];
    const rows = [
      { enrollmentNo: '7731', at: cairoInstant(day, '08:50').toISOString(), deviceId: 'q-1' },
    ];

    const first = await importRows(rows);
    expect(first.imported).toBe(0);
    expect(first.quarantined[0]?.reason).toContain('unmapped enrollmentNo 7731');

    const held = await quarantine('q-1');
    expect(held).toHaveLength(1);
    expect(held[0]?.enrollmentNo).toBe('7731');
    expect(held[0]?.employeeNumber).toBeNull();
    expect(held[0]?.status).toBe('pending');
    expect(held[0]?.retries).toBe(0);
    expect(held[0]?.reason).toContain('unmapped enrollmentNo 7731');

    // The branch re-sends its whole file every night. One unplaceable scan must stay one row.
    await importRows(rows);
    await importRows(rows);
    expect(await quarantine('q-1')).toHaveLength(1);
  });

  it('reports the unmatched machine ids with how much history each is holding', async () => {
    await registerDevice('q-2');
    const days = await olderWorkdays(480, 3);
    await importRows(
      days.map((day) => ({
        enrollmentNo: '300412',
        at: cairoInstant(day, '09:10').toISOString(),
        deviceId: 'q-2',
      })),
    );

    // The device code is normalized the way the registry normalizes it — one wall, one spelling.
    const report = (await unmatched()).filter((row) => row.deviceId === 'Q-2');
    expect(report).toHaveLength(1);
    const entry = report[0] as AttendanceUnmatchedIdDto;
    expect(entry.enrollmentNo).toBe('300412');
    expect(entry.rows).toBe(3);
    expect(entry.reason).toContain('unmapped enrollmentNo 300412');
    expect(entry.firstAt).toBe(cairoInstant(days[0] as Date, '09:10').toISOString());
    expect(entry.lastAt).toBe(cairoInstant(days[2] as Date, '09:10').toISOString());
  });

  /**
   * THE WHOLE POINT. Nobody re-sends the file: linking the enrolment is what recovers the history,
   * and it recovers it by itself. ECMS asks nothing of the machine when a link is made — it checks
   * that the device and the employee exist and stops — which is exactly what lets somebody who was
   * removed from the device, or who has since left, be mapped so their past scans have a home.
   */
  it('recovers the held scans the moment somebody links the enrolment', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const deviceId = await registerDevice('q-3');
    const [day] = (await olderWorkdays(460, 1)) as [Date];
    const rows = [
      { enrollmentNo: '101907', at: cairoInstant(day, '08:58').toISOString(), deviceId: 'q-3' },
      { enrollmentNo: '101907', at: cairoInstant(day, '17:04').toISOString(), deviceId: 'q-3' },
    ];
    const held = await importRows(rows);
    expect(held.imported).toBe(0);
    expect(await quarantine('q-3')).toHaveLength(2);

    await link(deviceId, '101907', emp.id);

    // Nothing else was asked for: no re-import, no retry call.
    expect(await quarantine('q-3')).toHaveLength(0);
    const imported = await quarantine('q-3', 'imported');
    expect(imported).toHaveLength(2);
    expect(imported[0]?.retries).toBe(1);
    expect(imported[0]?.resolvedAt).not.toBeNull();

    // And the punches are real: a recompute of that day derives it from them.
    await recompute(emp.id, day);
    const row = await dayRow(emp.id, day);
    expect(row.status).toBe('present');
    expect(row.firstInAt).not.toBeNull();
  });

  it('retries on demand, and says what is still stuck', async () => {
    const emp = await regEmployee();
    const deviceId = await registerDevice('q-4');
    const [day] = (await olderWorkdays(440, 1)) as [Date];
    await importRows([
      // One id nobody will ever map, and one that is about to be mapped.
      { enrollmentNo: '999999', at: cairoInstant(day, '08:40').toISOString(), deviceId: 'q-4' },
      { enrollmentNo: '202020', at: cairoInstant(day, '08:41').toISOString(), deviceId: 'q-4' },
    ]);
    expect(await quarantine('q-4')).toHaveLength(2);

    // Mapped WITHOUT the automatic retry seeing it: the link is made on a different device's
    // namespace first, so the manual endpoint is what has to do the work here.
    const otherDevice = await registerDevice('q-4b');
    await link(otherDevice, '202020', emp.id);
    expect(await quarantine('q-4')).toHaveLength(2);

    await link(deviceId, '202020', emp.id);
    const left = await quarantine('q-4');
    expect(left).toHaveLength(1);
    expect(left[0]?.enrollmentNo).toBe('999999');

    const retried = await request(app)
      .post('/api/v1/hr/attendance/quarantine/retry')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId: 'q-4' });
    expect(retried.status).toBe(200);
    const result = retried.body.data as AttendanceQuarantineRetryResultDto;
    expect(result.tried).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.stillQuarantined).toBe(1);
    expect(result.batchId).not.toBeNull();

    const stuck = await quarantine('q-4');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]?.retries).toBe(1);
    expect(stuck[0]?.lastTriedAt).not.toBeNull();
  });

  it('discards an id that will never be a person here, and deletes nothing', async () => {
    await registerDevice('q-5');
    const [day] = (await olderWorkdays(420, 1)) as [Date];
    await importRows([
      { enrollmentNo: '1', at: cairoInstant(day, '07:30').toISOString(), deviceId: 'q-5' },
    ]);
    expect(await quarantine('q-5')).toHaveLength(1);

    const discarded = await request(app)
      .post('/api/v1/hr/attendance/quarantine/discard')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId: 'q-5', enrollmentNo: '1' });
    expect(discarded.status).toBe(200);
    expect((discarded.body.data as { discarded: number }).discarded).toBe(1);

    // Gone from the queue, still readable as the reason those scans never became attendance.
    expect(await quarantine('q-5')).toHaveLength(0);
    expect(await quarantine('q-5', 'discarded')).toHaveLength(1);
    expect((await unmatched()).filter((row) => row.deviceId === 'Q-5')).toEqual([]);

    // A retry does not pick a discarded row back up.
    const retried = await request(app)
      .post('/api/v1/hr/attendance/quarantine/retry')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId: 'q-5' });
    expect((retried.body.data as AttendanceQuarantineRetryResultDto).tried).toBe(0);
  });

  it('reading needs attendanceDevice.view and acting needs attendanceDevice.manage', async () => {
    const denied = await request(app)
      .get('/api/v1/hr/attendance/quarantine')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(denied.status).toBe(403);
    const deniedReport = await request(app)
      .get('/api/v1/hr/attendance/quarantine/unmatched')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(deniedReport.status).toBe(403);
    const deniedRetry = await request(app)
      .post('/api/v1/hr/attendance/quarantine/retry')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({});
    expect(deniedRetry.status).toBe(403);
    const deniedDiscard = await request(app)
      .post('/api/v1/hr/attendance/quarantine/discard')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ deviceId: 'q-1' });
    expect(deniedDiscard.status).toBe(403);
  });
});

// ── Task 2 §3 — the backfill recompute: worker jobs, progress, resume ───────
//
// `days/recompute` is capped at 92 days and answers inside the request, because the branch servers
// call it every few seconds. The backfill is the other job: ~655 people × ~23 months. These tests
// are about the three properties that make that safe to run — it plans only what it needs, it says
// how far it has got, and it can be picked back up without redoing finished work — plus the one
// guarantee it must never break: a manager's judgement survives it.
//
// The queue runs INLINE in tests, so `POST /backfills` returns with the run already finished. That
// is what the suite wants: the same code path a worker takes, with nothing to wait for.
describe('Task 2 — the backfill recompute', () => {
  const startBackfill = (body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .post('/api/v1/hr/attendance/backfills')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const startOk = async (body: Record<string, unknown>): Promise<AttendanceBackfillDto> => {
    const res = await startBackfill(body);
    expect(res.status).toBe(201);
    return res.body.data as AttendanceBackfillDto;
  };

  const progressOf = async (id: string): Promise<AttendanceBackfillDto> => {
    const res = await request(app)
      .get(`/api/v1/hr/attendance/backfills/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return res.body.data as AttendanceBackfillDto;
  };

  it('plans only the days that carry a scan, derives them, and reports the progress', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    await registerDevice('bf-1');
    const [first, second] = (await olderWorkdays(400, 2)) as [Date, Date];

    await importRows([
      {
        employeeNumber: emp.employeeNumber,
        at: cairoInstant(first, '09:00').toISOString(),
        deviceId: 'bf-1',
      },
      {
        employeeNumber: emp.employeeNumber,
        at: cairoInstant(first, '17:00').toISOString(),
        deviceId: 'bf-1',
      },
      // One scan only — the ordinary case here, and `checkedIn` after the derivation.
      {
        employeeNumber: emp.employeeNumber,
        at: cairoInstant(second, '09:03').toISOString(),
        deviceId: 'bf-1',
      },
    ]);

    const run = await startOk({
      from: dateOnlyIso(addDays(first, -20)),
      to: dateOnlyIso(addDays(second, 20)),
      employeeIds: [emp.id],
    });

    // TWO DAYS, not forty-one: `withPunches` plans the employee-days an import actually touched.
    expect(run.scope).toBe('withPunches');
    expect(run.employees).toBe(1);
    expect(run.totalDays).toBe(2);
    expect(run.doneDays).toBe(2);
    expect(run.computed).toBe(2);
    expect(run.skippedFrozen).toBe(0);
    expect(run.failedDays).toBe(0);
    expect(run.percent).toBe(100);
    expect(run.status).toBe('completed');

    // The history is now derived, a year and more back.
    expect((await dayRow(emp.id, first)).status).toBe('present');
    expect((await dayRow(emp.id, second)).status).toBe('checkedIn');

    // And the progress endpoint says the same thing afterwards as the start call did.
    expect(await progressOf(run.id)).toEqual(run);
  });

  it('refuses a window no scan landed in, and names the way to walk it anyway', async () => {
    const emp = await regEmployee();
    const res = await startBackfill({
      from: dateOnlyIso(addDays(cairoToday(), -700)),
      to: dateOnlyIso(addDays(cairoToday(), -690)),
      employeeIds: [emp.id],
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('scope=all');
  });

  it('walks every day under scope=all, and counts the days Payroll had closed', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const [first] = (await olderWorkdays(300, 1)) as [Date];
    const last = addDays(first, 4);

    // One of the five days is frozen before the backfill runs, the AT-4 stand-in.
    await recompute(emp.id, first);
    const closed = await dayRow(emp.id, first);
    await AttendanceDayModel.updateOne(
      { _id: closed.id },
      { $set: { frozenAt: new Date() } },
    ).exec();

    const run = await startOk({
      from: dateOnlyIso(first),
      to: dateOnlyIso(last),
      employeeIds: [emp.id],
      scope: 'all',
    });
    expect(run.scope).toBe('all');
    expect(run.totalDays).toBe(5);
    expect(run.doneDays).toBe(5);
    expect(run.skippedFrozen).toBe(1);
    expect(run.computed).toBe(4);
    expect(run.status).toBe('completed');
  });

  /**
   * THE RESUME. A worker killed mid-chunk leaves its chunk claimed and unfinished; the run is
   * stopped before the rest is done. Resuming re-offers exactly that chunk and the days nobody
   * reached, and leaves the finished chunk alone — which is visible in `attempts`, because a chunk
   * that was never claimed again was never run again.
   */
  it('is resumable: the stalled work is re-offered and the finished work is not redone', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const [start] = (await olderWorkdays(250, 1)) as [Date];
    const run = await startOk({
      from: dateOnlyIso(start),
      to: dateOnlyIso(addDays(start, 40)),
      employeeIds: [emp.id],
      scope: 'all',
    });
    // 41 days at a month per chunk: two chunks, which is what makes "the other one" meaningful.
    expect(run.totalChunks).toBe(2);
    expect(run.totalDays).toBe(41);
    expect(run.status).toBe('completed');

    const chunks = await AttendanceBackfillChunkModel.find({ runId: run.id })
      .sort({ _id: 1 })
      .exec();
    expect(chunks).toHaveLength(2);
    const done = chunks[0] as AttendanceBackfillChunkDoc;
    const stalled = chunks[1] as AttendanceBackfillChunkDoc;

    // Rewind the second chunk to a worker that claimed it an hour ago and never came back, and
    // stop the run — exactly the state a killed container leaves behind.
    await AttendanceBackfillChunkModel.updateOne(
      { _id: stalled._id },
      {
        $set: {
          status: 'running',
          claimedAt: new Date(Date.now() - 60 * 60 * 1000),
          computed: 0,
          skippedFrozen: 0,
          finishedAt: null,
        },
      },
    ).exec();
    await AttendanceBackfillModel.updateOne(
      { _id: run.id },
      { $set: { status: 'cancelled', finishedAt: new Date() } },
    ).exec();

    const partial = await progressOf(run.id);
    expect(partial.status).toBe('cancelled');
    expect(partial.doneChunks).toBe(1);
    expect(partial.doneDays).toBe(done.days);
    expect(partial.percent).toBeLessThan(100);

    const resumed = await request(app)
      .post(`/api/v1/hr/attendance/backfills/${run.id}/resume`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resumed.status).toBe(200);
    const after = resumed.body.data as AttendanceBackfillDto;
    expect(after.status).toBe('completed');
    expect(after.doneChunks).toBe(2);
    expect(after.doneDays).toBe(after.totalDays);
    expect(after.failedChunks).toBe(0);

    const reread = await AttendanceBackfillChunkModel.find({ runId: run.id })
      .sort({ _id: 1 })
      .exec();
    const doneAgain = reread[0] as AttendanceBackfillChunkDoc;
    const stalledAgain = reread[1] as AttendanceBackfillChunkDoc;
    expect(doneAgain.attempts).toBe(1); // never claimed a second time
    expect(stalledAgain.attempts).toBe(2); // re-offered, and finished this time
    expect(stalledAgain.status).toBe('done');

    // Nothing left to pick up, and the endpoint says so rather than queueing empty work.
    const again = await request(app)
      .post(`/api/v1/hr/attendance/backfills/${run.id}/resume`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(again.status).toBe(422);
  });

  /**
   * THE GUARANTEE. A decision is an INPUT to the derivation, not a field on the derived row, so a
   * backfill re-deriving the day reads it again and reaches the same verdict. This is the same
   * property that lets a branch re-send 67,839 scans without erasing anybody's judgement — tested
   * here against the backfill because that is the path that will actually re-derive two years.
   */
  it('a manager decision survives the backfill recompute', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const day = nearWorkday();
    await registerDevice('bf-5');
    await importRows([
      {
        employeeNumber: emp.employeeNumber,
        at: cairoInstant(day, '09:00').toISOString(),
        deviceId: 'bf-5',
      },
      {
        employeeNumber: emp.employeeNumber,
        at: cairoInstant(day, '17:00').toISOString(),
        deviceId: 'bf-5',
      },
    ]);
    await recompute(emp.id, day);
    expect((await dayRow(emp.id, day)).status).toBe('present');

    const decided = await request(app)
      .post('/api/v1/hr/attendance/decisions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employeeId: emp.id,
        workDate: dateOnlyIso(day),
        type: 'markAbsent',
        reason: 'لم يكن على رأس العمل رغم وجود البصمة',
      });
    expect(decided.status).toBe(201);
    expect((decided.body.data as AttendanceDecisionDto).status).toBe('applied');
    expect((await dayRow(emp.id, day)).status).toBe('absent');

    const run = await startOk({
      from: dateOnlyIso(day),
      to: dateOnlyIso(day),
      employeeIds: [emp.id],
      scope: 'all',
    });
    expect(run.computed).toBe(1);

    const row = await dayRow(emp.id, day);
    expect(row.status).toBe('absent');
    expect(row.flags).toContain('overriddenByManager');
  });

  it('lists the runs newest first, and every route needs attendance.recompute', async () => {
    const listed = await request(app)
      .get('/api/v1/hr/attendance/backfills?limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    const runs = listed.body.data as AttendanceBackfillDto[];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThanOrEqual(5);
    const times = runs.map((run) => Date.parse(run.startedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    const denied = await startBackfill(
      { from: dateOnlyIso(addDays(cairoToday(), -5)), to: dateOnlyIso(cairoToday()) },
      outsiderToken,
    );
    expect(denied.status).toBe(403);
    const deniedRead = await request(app)
      .get(`/api/v1/hr/attendance/backfills/${String(runs[0]?.id)}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(deniedRead.status).toBe(403);
  });
});

/**
 * THE READ PATHS, against the two defects production showed.
 *
 * The data was never the problem. 65,579 punches had been imported, the backfill had run to
 * completion (2,062/2,062 chunks, 52,237 days computed, 0 failed) and the enrolment audit found no
 * mismatched machine id at all — and the daily sheet still showed four people out of a hundred on a
 * day thirty-nine had scanned, while `GET /punches?from=D&to=D` answered zero for a day that had
 * seventy-four. Both were reads, and both were silent.
 */
describe('the read paths — what the owner was actually looking at', () => {
  /**
   * REGRESSION: the sheet resolved the FIRST HUNDRED EMPLOYEES BY CODE, on every date.
   *
   * It asked `listEmployees` for `pageSize: SHEET_CAP` to mean "all of them", and
   * `BaseRepository.list` clamps pageSize to `MAX_PAGE_SIZE` — 100. Nothing failed: the sheet
   * answered a hundred lines, the summary said «total 100» on every date of the year, and the
   * company's other 1,655 people were absent from the screen and from every count beneath it. The
   * four who showed as present were whichever of the thirty-nine scanners sorted into the first
   * page.
   *
   * So this registers enough people to cross that boundary and punches for one whose code sorts
   * PAST it — the person the old read could not have shown however hard it looked.
   */
  it('resolves every employee in scope, not the first hundred', async () => {
    const device = await registerDevice('SHEET-CAP');
    const day = recentWorkday();

    // Enough to cross 100 in this suite's branch, whatever earlier tests registered.
    const before = await request(app)
      .get(`/api/v1/hr/attendance/days/sheet/summary?date=${dateOnlyIso(day)}&branchId=${BRANCH_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.status).toBe(200);
    const already = (before.body.data as { total: number }).total;
    const needed = Math.max(0, 104 - already);
    const made: EmployeeDto[] = [];
    for (let i = 0; i < needed; i += 1) made.push(await regEmployee());

    // The LAST employee by code is the one the clamp hid. Give them a scan on the day.
    const sheetAll = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(day)}&branchId=${BRANCH_ID}&page=1&pageSize=100&sortDir=asc`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sheetAll.status).toBe(200);

    const lastByCode = [...made].sort((a, b) => b.code.localeCompare(a.code))[0] as EmployeeDto;
    await request(app)
      .post('/api/v1/hr/attendance/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId: device, enrollmentNo: 'CAP-1', employeeId: lastByCode.id })
      .expect(201);
    await importRows([
      { deviceId: 'SHEET-CAP', enrollmentNo: 'CAP-1', at: cairoInstant(day, '08:12').toISOString() },
      { deviceId: 'SHEET-CAP', enrollmentNo: 'CAP-1', at: cairoInstant(day, '17:04').toISOString() },
    ]);

    const summary = await request(app)
      .get(`/api/v1/hr/attendance/days/sheet/summary?date=${dateOnlyIso(day)}&branchId=${BRANCH_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(summary.status).toBe(200);
    const counts = summary.body.data as {
      total: number;
      byStatus: Record<string, number>;
    };
    // The whole point: past the hundred the clamp stopped at.
    expect(counts.total).toBeGreaterThan(100);

    // And the person past it is ON the sheet, with their times — found by paging to them rather
    // than by trusting the first page, which is exactly what the old read could not do.
    interface SheetLine {
      employeeId: string;
      status: string;
    }
    let found: SheetLine | undefined;
    for (let page = 1; page <= Math.ceil(counts.total / 100) && found === undefined; page += 1) {
      const res = await request(app)
        .get(
          `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(day)}&branchId=${BRANCH_ID}&page=${String(page)}&pageSize=100`,
        )
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      found = (res.body.data as SheetLine[]).find((r) => r.employeeId === lastByCode.id);
    }
    expect(found, 'the employee whose code sorts past the first page').toBeDefined();
    expect(['present', 'checkedIn', 'late', 'lateAndEarly', 'earlyLeave']).toContain(found?.status);
    // TWO MINUTES. This registers up to a hundred and four employees one HTTP call at a time to
    // cross the clamp it is about, and then pages the sheet to find one of them. It is the slowest
    // test in the file by a wide margin and has nothing to do with the default five seconds.
  }, 120_000);

  /**
   * REGRESSION: `GET /punches?from=D&to=D` answered ZERO for a day with seventy-four scans.
   *
   * `z.coerce.date()` turns `2026-11-18` into `2026-11-18T00:00:00Z`, and the filter compared it
   * against the punch INSTANT with `$gte from, $lte to` — so one day asked for a zero-width window,
   * and every other window was shifted two hours into the previous Cairo day.
   */
  it('answers a single Cairo day for from = to on the punch list', async () => {
    const device = await registerDevice('DAY-WINDOW');
    const employee = await regEmployee();
    const day = recentWorkday();
    await request(app)
      .post('/api/v1/hr/attendance/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId: device, enrollmentNo: 'WIN-1', employeeId: employee.id })
      .expect(201);

    // One scan just after Cairo midnight and one just before the next — the two the old window
    // dropped: `00:30` Cairo is `22:30Z` the day BEFORE, and `23:30` Cairo is past `00:00Z`.
    await importRows([
      { deviceId: 'DAY-WINDOW', enrollmentNo: 'WIN-1', at: cairoInstant(day, '00:30').toISOString() },
      { deviceId: 'DAY-WINDOW', enrollmentNo: 'WIN-1', at: cairoInstant(day, '12:00').toISOString() },
      { deviceId: 'DAY-WINDOW', enrollmentNo: 'WIN-1', at: cairoInstant(day, '23:30').toISOString() },
    ]);

    const sameDay = await request(app)
      .get(
        `/api/v1/hr/attendance/punches?employeeId=${employee.id}&from=${dateOnlyIso(day)}&to=${dateOnlyIso(day)}&pageSize=100`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sameDay.status).toBe(200);
    expect((sameDay.body.data as unknown[]).length).toBe(3);

    // The day BEFORE must not borrow them, which is the other half of the same bug.
    const dayBefore = await request(app)
      .get(
        `/api/v1/hr/attendance/punches?employeeId=${employee.id}&from=${dateOnlyIso(addDays(day, -1))}&to=${dateOnlyIso(addDays(day, -1))}&pageSize=100`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dayBefore.status).toBe(200);
    expect((dayBefore.body.data as unknown[]).length).toBe(0);
  });

  /**
   * REGRESSION: «12 and 15 November read يوم راحة although I scanned on both».
   *
   * Nothing has derived `dayOff` since `noSchedule` arrived, so every stored one is a legacy row —
   * and production has tens of thousands of them, written by the nightly pass for employees with no
   * shift. Taking one at face value holds «يوم راحة» on screen over real punches for as long as the
   * row sits there, which is why a stored `dayOff` is re-resolved rather than believed.
   */
  it('never reads a day with punches as a rest day, however the stored row is labelled', async () => {
    const device = await registerDevice('STALE-ROW');
    const employee = await regEmployee();
    const day = recentWorkday();
    await request(app)
      .post('/api/v1/hr/attendance/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId: device, enrollmentNo: 'STALE-1', employeeId: employee.id })
      .expect(201);
    await importRows([
      { deviceId: 'STALE-ROW', enrollmentNo: 'STALE-1', at: cairoInstant(day, '09:57').toISOString() },
      { deviceId: 'STALE-ROW', enrollmentNo: 'STALE-1', at: cairoInstant(day, '17:07').toISOString() },
    ]);

    // Put the legacy label back on the row, exactly as the old engine left it.
    await AttendanceDayModel.updateOne(
      { employeeId: new Types.ObjectId(employee.id), workDate: day },
      { $set: { status: 'dayOff', firstInAt: null, lastOutAt: null, workedMinutes: 0 } },
    ).exec();

    const period = await request(app)
      .get(
        `/api/v1/hr/attendance/days/employee-period?employeeId=${employee.id}&from=${dateOnlyIso(day)}&to=${dateOnlyIso(day)}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(period.status).toBe(200);
    const [resolved] = period.body.data as { status: string; firstInAt: string | null }[];
    expect(resolved?.status).not.toBe('dayOff');
    expect(resolved?.status).not.toBe('weekend');
    expect(resolved?.status).not.toBe('holiday');
    expect(['present', 'late', 'earlyLeave', 'lateAndEarly', 'checkedIn']).toContain(resolved?.status);
    expect(resolved?.firstInAt).not.toBeNull();
  });

  /**
   * The property the whole change is for: the sheet and the employee page cannot disagree about the
   * same employee on the same day. They had two different sources — the sheet resolved its own
   * answer, the page read a status off whichever rows it was sent — so they did.
   */
  it('agrees between the daily sheet and the employee page, day for day', async () => {
    const device = await registerDevice('AGREE');
    const employee = await regEmployee();
    const day = recentWorkday();
    await request(app)
      .post('/api/v1/hr/attendance/enrollments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ deviceId: device, enrollmentNo: 'AGREE-1', employeeId: employee.id })
      .expect(201);
    await importRows([
      { deviceId: 'AGREE', enrollmentNo: 'AGREE-1', at: cairoInstant(day, '08:40').toISOString() },
    ]);

    const sheet = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(day)}&search=${employee.code}&page=1&pageSize=100`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(sheet.status).toBe(200);
    const line = (sheet.body.data as { employeeId: string; status: string }[]).find(
      (r) => r.employeeId === employee.id,
    );
    expect(line, 'the employee on the sheet').toBeDefined();

    const period = await request(app)
      .get(
        `/api/v1/hr/attendance/days/employee-period?employeeId=${employee.id}&from=${dateOnlyIso(day)}&to=${dateOnlyIso(day)}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(period.status).toBe(200);
    const [resolved] = period.body.data as { status: string }[];
    expect(resolved?.status).toBe(line?.status);
  });

  /** One entry per calendar date, so a month cannot skip the days it has punches for. */
  it('answers one entry per date of the period, including a day in January 2025', async () => {
    const employee = await regEmployee();
    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/employee-period?employeeId=${employee.id}&from=2025-01-01&to=2025-01-31`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const days = res.body.data as { date: string; status: string }[];
    // Employed from 2024-01-01, so every one of January's 31 days is theirs.
    expect(days).toHaveLength(31);
    expect(days[0]?.date).toBe('2025-01-01');
    expect(days[30]?.date).toBe('2025-01-31');
    // Nothing concluded and nothing scanned: the honest answer, not an absence and not a rest day.
    const workingDay = days.find((d) => d.status === 'noRecord' || d.status === 'noSchedule');
    expect(workingDay, 'a January day with an honest status').toBeDefined();
    expect(days.every((d) => d.status !== 'dayOff')).toBe(true);
  });

  /** Every employee the sheet resolves falls in exactly one of the counters the screen draws. */
  it('counts every line once, so the band adds up to the total', async () => {
    const day = recentWorkday();
    const res = await request(app)
      .get(`/api/v1/hr/attendance/days/sheet/summary?date=${dateOnlyIso(day)}&branchId=${BRANCH_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const { total, byStatus } = res.body.data as {
      total: number;
      byStatus: Record<string, number>;
    };
    const summed = Object.values(byStatus).reduce((a, b) => a + b, 0);
    expect(summed).toBe(total);
  });
});


/**
 * THE SCOPE RIDES ON THE READ THAT IS ACTUALLY USED, which is a rule worth a test because this
 * change nearly broke it.
 *
 * `employee-summary` used to fetch a page of day ROWS through the scoped list and hand them to the
 * arithmetic. When the arithmetic started resolving the period itself, that page briefly became the
 * only thing carrying the scope check while contributing nothing to the answer — a branch-scoped
 * reader asking about somebody in another branch would have got an empty page and then the full
 * figures anyway. Both endpoints are pinned here, in both directions.
 */
describe('one employee period, in the caller scope', () => {
  it('answers nothing about an employee outside the reader branch, and everything inside it', async () => {
    // A second branch, and an employee who scans in it.
    const otherBranchRes = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '077', name: { ar: 'فرع آخر', en: 'Other branch' } });
    expect(otherBranchRes.status).toBe(201);
    const otherBranchId = (otherBranchRes.body as { data: { id: string } }).data.id;
    const otherDepRes = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'D77', name: { ar: 'قسم آخر', en: 'Other dept' }, branchId: otherBranchId });
    expect(otherDepRes.status).toBe(201);
    const outsiderEmp = await regEmployee({
      branchId: otherBranchId,
      departmentId: (otherDepRes.body as { data: { id: string } }).data.id,
    });
    const insiderEmp = await regEmployee();

    // A reader holding `attendance.view` at BRANCH scope, sitting in this suite's branch.
    const readerRole = await rbacService.createRole(
      {
        name: { en: 'Branch attendance reader', ar: 'قارئ حضور الفرع' },
        permissionKeys: ['attendance.view'],
      },
      // `by` is an id, and no actor is passed: the fixture is not testing who may mint a role.
      new Types.ObjectId().toString(),
    );
    const readerId = await mkUser('branch.reader@ecms.local', BRANCH_ID);
    await rbacService.ensureAssignment(readerId, String(readerRole._id), 'branch');
    const readerToken = await login('branch.reader@ecms.local');

    const day = recentWorkday();
    const window = `from=${dateOnlyIso(day)}&to=${dateOnlyIso(day)}`;

    // OUTSIDE the branch: nothing, from both endpoints — not an error, and certainly not figures.
    const outPeriod = await request(app)
      .get(`/api/v1/hr/attendance/days/employee-period?employeeId=${outsiderEmp.id}&${window}`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(outPeriod.status).toBe(200);
    expect(outPeriod.body.data).toEqual([]);

    const outSummary = await request(app)
      .get(`/api/v1/hr/attendance/days/employee-summary?employeeId=${outsiderEmp.id}&${window}`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(outSummary.status).toBe(200);
    // Every figure is a figure OF the resolved days, so an empty resolution is an empty answer.
    expect((outSummary.body.data as { daysPresent: number }).daysPresent).toBe(0);
    expect((outSummary.body.data as { daysExpected: number }).daysExpected).toBe(0);

    // INSIDE the branch: the day is there, which proves the empty answer above was the scope and
    // not simply a broken read.
    const inPeriod = await request(app)
      .get(`/api/v1/hr/attendance/days/employee-period?employeeId=${insiderEmp.id}&${window}`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(inPeriod.status).toBe(200);
    expect((inPeriod.body.data as unknown[]).length).toBe(1);
  });
});
