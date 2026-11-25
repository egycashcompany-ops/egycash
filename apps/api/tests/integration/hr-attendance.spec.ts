// Attendance AT-1..3 integration suite (frozen design v1.1). Exercises the shifts catalog and
// its coherence rules, dated assignments with the one-open-interval guard, immutable punches
// (record / supersede / idempotent device import with quarantine), and the §4 derivation engine
// over HTTP: absent / present / late / weekend / incomplete, the own-scope /days/me read, the
// freeze guard refusing recomputation, and authorization on every surface.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  ATTENDANCE_FEED_FIELDS,
  AttendanceFeedRowSchema,
  HrAttendanceSettingKeys,
  HrAttendanceTemplates,
  HrLeaveSettingKeys,
  type AttendanceDayDto,
  type AttendanceRegularizationDto,
  type AttendanceDecisionDto,
  type AttendanceDecisionSignalsDto,
  type AttendanceSheetRowDto,
  type AttendanceEmployeeSummaryDto,
  type AttendanceSheetSummaryDto,
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
import { HolidayModel, type HolidayDoc } from '../../src/modules/hr/work-calendar/holiday.model';
import {
  attendanceSweepService,
  cairoInstant,
  dayRecordService,
  AttendanceDayModel,
  AttendancePunchModel,
} from '../../src/modules/hr/attendance';
import { Types } from 'mongoose';
import { NotificationModel } from '../../src/platform/notifications/notification.model';
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

const mkUser = async (email: string): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId: null, departmentId: null, sectionId: null, jobTitleId: null },
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

/**
 * An OLD workday — past the seven-day threshold an old-day decision waits behind, and never a weekend
 * or a seeded holiday (a fixed «20 days ago» lands on a Friday or a Saturday two days a week, and
 * that day is then recomputed as `weekend`, whatever a decision says).
 */
const oldWorkday = (): Date => {
  let day = addDays(cairoToday(), -20);
  while ([5, 6].includes(isoWeekday(day)) || HOLIDAY_ISO.has(dateOnlyIso(day))) {
    day = addDays(day, -1);
  }
  return day;
};

/** A recent WEEKEND day per the seeded calendar (Fri=5). */
const recentWeekendDay = (): Date => {
  let day = addDays(cairoToday(), -10);
  while (isoWeekday(day) !== 5) day = addDays(day, 1);
  return day;
};

const assign = async (employeeId: string, shiftId: string): Promise<void> => {
  const res = await request(app)
    .post('/api/v1/hr/attendance/assignments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ employeeId, shiftId, fromDate: '2024-01-02' });
  expect(res.status).toBe(201);
};

const recordPunch = (body: Record<string, unknown>, token = adminToken) =>
  request(app)
    .post('/api/v1/hr/attendance/punches')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

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
  // ABSENCE ON, FOR THIS FILE ONLY, and the reason is worth stating because the shipped default is
  // the opposite. This file's subject is what the derivation engine computes over HTTP, and
  // «absent» is the word that computation produces for an expected day nobody turned up to. The
  // owner's ruling of 18 November — «lateness only for now», so such a day reads «لا يوجد تسجيل»
  // instead — is a decision about what the company PUBLISHES, not about what the engine can work
  // out, and it ships as `hr.attendance.countAbsence: false` with its own coverage in
  // `attendance-settings-defaults.spec.ts` and `derive-day.spec.ts`. Leaving it off here would
  // have turned forty assertions about the engine into assertions about one setting.
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

describe('shifts catalog', () => {
  it('seeds GENERAL (09:00–17:00, 30-minute grace) at boot, idempotently', () => {
    expect(GENERAL.startTime).toBe('09:00');
    expect(GENERAL.endTime).toBe('17:00');
    expect(GENERAL.graceInMinutes).toBe(30);
  });

  it('creates a night shift; refuses a duplicate code and incoherent times', async () => {
    const night = await request(app)
      .post('/api/v1/hr/attendance/shifts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'NIGHT-A',
        name: { ar: 'ليلية', en: 'Night A' },
        startTime: '22:00',
        endTime: '06:00',
        crossesMidnight: true,
      });
    expect(night.status).toBe(201);

    const dup = await request(app)
      .post('/api/v1/hr/attendance/shifts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'GENERAL', name: { ar: 'ن', en: 'N' }, startTime: '08:00', endTime: '16:00' });
    expect(dup.status).toBe(409);

    const bad = await request(app)
      .post('/api/v1/hr/attendance/shifts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'BAD-1', name: { ar: 'ن', en: 'N' }, startTime: '17:00', endTime: '09:00' });
    expect(bad.status).toBe(400);
  });

  it('re-validates time coherence on the MERGED update', async () => {
    const res = await request(app)
      .patch(`/api/v1/hr/attendance/shifts/${GENERAL.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ endTime: '08:00', version: GENERAL.version });
    expect(res.status).toBe(422);
  });

  it('the catalog surface requires attendance.manageShifts', async () => {
    const res = await request(app)
      .get('/api/v1/hr/attendance/shifts')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});

describe('assignments', () => {
  it('one open interval per employee; a bounded override coexists', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);

    const secondOpen = await request(app)
      .post('/api/v1/hr/attendance/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ employeeId: emp.id, shiftId: GENERAL.id, fromDate: '2025-01-01' });
    expect(secondOpen.status).toBe(422);

    const override = await request(app)
      .post('/api/v1/hr/attendance/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employeeId: emp.id,
        shiftId: GENERAL.id,
        fromDate: '2025-01-01',
        toDate: '2025-01-01',
      });
    expect(override.status).toBe(201);
  });

  it('requires attendance.assign', async () => {
    const res = await request(app)
      .get('/api/v1/hr/attendance/assignments')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });
});

describe('punches', () => {
  it('records a manual punch; a web punch is refused while the D1 setting is off', async () => {
    const emp = await regEmployee();
    const day = recentWorkday();
    const ok = await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(day, '09:00').toISOString(),
    });
    expect(ok.status).toBe(201);
    expect((ok.body.data as { source: string }).source).toBe('manual');

    const web = await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(day, '10:00').toISOString(),
      source: 'web',
    });
    expect(web.status).toBe(422);
  });

  it('supersedes a wrong punch instead of editing it — once', async () => {
    const emp = await regEmployee();
    const day = recentWorkday();
    const wrong = await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(day, '08:00').toISOString(),
    });
    const wrongId = (wrong.body.data as { id: string }).id;

    const fix = await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(day, '09:00').toISOString(),
      supersedesId: wrongId,
    });
    expect(fix.status).toBe(201);

    const again = await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(day, '09:01').toISOString(),
      supersedesId: wrongId,
    });
    expect(again.status).toBe(422);
  });

  it('imports device rows idempotently and quarantines bad ones instead of dropping them', async () => {
    const emp = await regEmployee();
    const day = recentWorkday();
    // AT-D1 (D12.5): a device must be registered before its rows are accepted — an unregistered
    // one is quarantined rather than stored as a punch nobody can place. Registering it here is
    // the same act an administrator performs once per wall.
    const device = await request(app)
      .post('/api/v1/hr/attendance/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'dev-1', name: 'Gate 1', branchId: BRANCH_ID });
    expect(device.status).toBe(201);
    const rows = [
      { employeeNumber: emp.employeeNumber, at: cairoInstant(day, '09:00').toISOString(), deviceId: 'dev-1' },
      { employeeNumber: emp.employeeNumber, at: cairoInstant(day, '17:00').toISOString(), deviceId: 'dev-1' },
      { employeeNumber: 'no-such-employee', at: cairoInstant(day, '09:00').toISOString(), deviceId: 'dev-1' },
      { employeeNumber: emp.employeeNumber, at: '2030-01-01T09:00:00.000Z', deviceId: 'dev-1' },
    ];
    const first = await request(app)
      .post('/api/v1/hr/attendance/punches/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rows });
    expect(first.status).toBe(200);
    const r1 = first.body.data as ImportPunchesResultDto;
    expect(r1.imported).toBe(2);
    expect(r1.quarantined).toHaveLength(2);

    const second = await request(app)
      .post('/api/v1/hr/attendance/punches/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rows: rows.slice(0, 2) });
    const r2 = second.body.data as ImportPunchesResultDto;
    expect(r2.imported).toBe(0);
    expect(r2.duplicates).toBe(2);
  });

  /**
   * AT-D2 (D12.3) — an approved correction writes its OWN source, and the day says which of the
   * two signals it saw. Before this split both wrote `manual` and raised the same flag, so a day
   * fixed through manager and HR approval was indistinguishable from one somebody typed.
   */
  it('a hand-entered punch is manual, and says so on the day', async () => {
    const emp = await regEmployee();
    const day = recentWorkday();
    const rec = await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(day, '09:00').toISOString(),
      direction: 'in',
    });
    expect(rec.status).toBe(201);
    expect((rec.body.data as { source: string }).source).toBe('manual');
  });

  it('record and import each require their own grant', async () => {
    const rec = await recordPunch({ employeeId: '0123456789abcdef01234567', at: new Date().toISOString() }, outsiderToken);
    expect(rec.status).toBe(403);
    const imp = await request(app)
      .post('/api/v1/hr/attendance/punches/import')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ rows: [{ employeeNumber: 'x', at: new Date().toISOString(), deviceId: 'd' }] });
    expect(imp.status).toBe(403);
  });
});

describe('the derivation engine over HTTP', () => {
  it('derives absent / present / late / weekend / incomplete per the §4 order', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    const weekend = recentWeekendDay();

    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('absent');

    await recompute(emp.id, weekend);
    expect((await dayRow(emp.id, weekend)).status).toBe('weekend');

    // One punch → checkedIn: a presence with the hours unknown. A departure is still never
    // guessed into the day (D6) — what changed is that the day is no longer called a fault.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:05').toISOString() });
    await recompute(emp.id, workday);
    const checkedIn = await dayRow(emp.id, workday);
    expect(checkedIn.status).toBe('checkedIn');
    expect(checkedIn.workedMinutes).toBe(0);
    expect(checkedIn.lastOutAt).toBeNull();

    // The out punch arrives → present, worked minutes, zero late (inside the 30-minute grace).
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);
    const present = await dayRow(emp.id, workday);
    expect(present.status).toBe('present');
    expect(present.workedMinutes).toBe(475);
    expect(present.lateMinutes).toBe(0);
    expect(present.approvedOvertimeMinutes).toBe(0);
  });

  it('recomputation is idempotent — same day, byte-identical numbers', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '10:00').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);
    const a = await dayRow(emp.id, workday);
    expect(a.status).toBe('late');
    expect(a.lateMinutes).toBe(60);
    await recompute(emp.id, workday);
    const b = await dayRow(emp.id, workday);
    expect({ ...b, computedAt: a.computedAt }).toEqual(a);
  });

  it('a frozen day refuses recomputation — the §4 guard', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recompute(emp.id, workday);
    const before = await dayRow(emp.id, workday);
    expect(before.status).toBe('absent');

    // Stand-in for the AT-4 Payroll-owned trigger: freeze the row directly.
    await AttendanceDayModel.updateOne(
      { _id: before.id },
      { $set: { frozenAt: new Date() } },
    ).exec();

    // A punch arrives late — the truth changed — but the frozen row must not.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    const result = await recompute(emp.id, workday);
    expect(result.skippedFrozen).toBe(1);
    expect(result.computed).toBe(0);
    const after = await dayRow(emp.id, workday);
    expect(after.status).toBe('absent');
    expect(after.workedMinutes).toBe(0);
  });

  it('caps the recompute window at 92 days', async () => {
    const res = await request(app)
      .post('/api/v1/hr/attendance/days/recompute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ from: '2026-01-01', to: '2026-06-01' });
    expect(res.status).toBe(400);
  });

  it('/days requires attendance.view; /days/me is own-scope by construction', async () => {
    const denied = await request(app)
      .get('/api/v1/hr/attendance/days?from=2026-01-01&to=2026-01-02')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(denied.status).toBe(403);

    // A login with no linked employee gets a 404, not somebody else's rows.
    const mine = await request(app)
      .get('/api/v1/hr/attendance/days/me?from=2026-01-01&to=2026-01-02')
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(mine.status).toBe(404);
  });
});

// ── Stage 1b — the default working pattern ──────────────────────────────────
//
// The pattern is what lets `late`, `earlyLeave` and `absent` mean anything for the majority of
// this workforce, who have no shift assignment. The tests that matter are the two edges: it is
// INERT until switched on, and a real assignment BEATS it.
//
// Every test here puts the settings back, because they are process-wide.
//
// THE BLOCK'S PREMISE INVERTED on 18 November. The pattern used to ship INERT, and the rest of
// this file was written against a shift-less day deriving as `noSchedule`. The owner then set the
// company day — 09:00–17:00, eight hours, no grace — so the pattern is ON by default and a
// shift-less employee HAS an expectation. The tests that proved the inert behaviour now prove the
// switch in the other direction: off gives «لا يوجد جدول», on holds the day to the hours.
describe('the default working pattern', () => {
  const patternCtx = (): AuthContext => ({
    // `settingsService.set` stamps `updatedBy`, so this has to be a real ObjectId.
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

  const PATTERN_KEYS = {
    enabled: HrAttendanceSettingKeys.DefaultPatternEnabled,
    startTime: HrAttendanceSettingKeys.DefaultPatternStartTime,
    endTime: HrAttendanceSettingKeys.DefaultPatternEndTime,
    breakMinutes: HrAttendanceSettingKeys.DefaultPatternBreakMinutes,
    graceInMinutes: HrAttendanceSettingKeys.DefaultPatternGraceInMinutes,
    graceOutMinutes: HrAttendanceSettingKeys.DefaultPatternGraceOutMinutes,
  } as const;

  const setPattern = async (
    values: Partial<{
      enabled: boolean;
      startTime: string;
      endTime: string;
      breakMinutes: number;
      graceInMinutes: number;
      graceOutMinutes: number;
    }>,
    scope: { scope: 'organization' } | { scope: 'branch'; scopeRef: string } = {
      scope: 'organization',
    },
  ): Promise<void> => {
    for (const [field, value] of Object.entries(values)) {
      await settingsService.set(patternCtx(), {
        key: PATTERN_KEYS[field as keyof typeof PATTERN_KEYS],
        ...scope,
        value,
      });
    }
  };

  /**
   * Back to the declared defaults — by DELETING the rows, not by writing `false` over them.
   *
   * Writing `false` at branch scope was the first version of this, and it poisoned every test
   * after it: a branch row BEATS the organization row, so a later test that switched the pattern
   * on company-wide was silently overridden by this cleanup. Removing the rows leaves the
   * declaration's own default (off) with nothing in front of it. The cache is keyed per subject,
   * so it has to be dropped by key prefix the way `settingsService.set` does it.
   */
  afterEach(async () => {
    await SettingValueModel.deleteMany({ key: { $in: Object.values(PATTERN_KEYS) } }).exec();
    for (const key of Object.values(PATTERN_KEYS)) {
      await getCache().delByPrefix(`settings:${key}:`);
    }
  });

  it('ships ON, so a shift-less day is held to the company hours', async () => {
    const emp = await regEmployee();
    const workday = recentWorkday();
    await recompute(emp.id, workday);
    // Nine to five, and nobody came: an absence rather than «nobody said when this person works».
    // (`countAbsence` is on for this file — see the note in the global setup.)
    expect((await dayRow(emp.id, workday)).status).toBe('absent');
  });

  it('switched OFF, the same day reads «لا يوجد جدول» — nobody has said when they work', async () => {
    const emp = await regEmployee();
    const workday = recentWorkday();
    await setPattern({ enabled: false });
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('noSchedule');
    // And nothing is judged against an hour nobody set.
    const row = await dayRow(emp.id, workday);
    expect(row.lateMinutes).toBe(0);
    expect(row.requiredMinutes).toBeNull();
  });

  it('once on, an unassigned employee with no punches is ABSENT', async () => {
    const emp = await regEmployee();
    const workday = recentWorkday();
    await setPattern({ enabled: true, startTime: '09:00', endTime: '17:00', graceInMinutes: 15 });
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('absent');
  });

  it('measures lateness for somebody never assigned a shift — but only on a SHORT day', async () => {
    const emp = await regEmployee();
    const workday = recentWorkday();
    await setPattern({ enabled: true, startTime: '09:00', endTime: '17:00', graceInMinutes: 0 });

    // A lone punch is a check-in, and NOTHING on it is judged. Lateness under the owner's rule
    // depends on whether the eight hours were completed, and with no check-out that is exactly
    // what nobody knows — so the arrival is recorded and no verdict is reached.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:40').toISOString() });
    await recompute(emp.id, workday);
    const row = await dayRow(emp.id, workday);
    expect(row.status).toBe('checkedIn');
    expect(row.lateMinutes).toBe(0);
    expect(row.requiredMinutes).toBe(480);

    // Out at 17:00: 440 minutes against 480 required, so the day IS short and the arrival IS late.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);
    const short = await dayRow(emp.id, workday);
    expect(short.status).toBe('late');
    expect(short.workedMinutes).toBe(440);
    expect(short.lateMinutes).toBe(40);
    expect(short.shortfallMinutes).toBe(40);
    expect(short.overtimeMinutes).toBe(0);
  });

  it('does NOT call the same arrival late once the eight hours are finished', async () => {
    // The owner's own example: «09:40 → 17:40 … they are NOT late and NOT early.» Same arrival as
    // the test above, forty minutes more at the end, and the day is «حاضر» with nothing owed.
    const emp = await regEmployee();
    const workday = recentWorkday();
    await setPattern({ enabled: true, startTime: '09:00', endTime: '17:00', graceInMinutes: 0 });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:40').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:40').toISOString() });
    await recompute(emp.id, workday);
    const row = await dayRow(emp.id, workday);
    expect(row.status).toBe('present');
    expect(row.workedMinutes).toBe(480);
    expect(row.lateMinutes).toBe(0);
    expect(row.shortfallMinutes).toBe(0);
    expect(row.earlyLeaveMinutes).toBe(0);
    expect(row.overtimeMinutes).toBe(0);
  });

  it('A REAL ASSIGNMENT WINS: the pattern never argues with somebody who was assigned', async () => {
    const emp = await regEmployee();
    const workday = recentWorkday();
    await assign(emp.id, GENERAL.id); // 09:00–17:00, 30-minute break, 15-minute grace
    // A pattern that disagrees on every field. If it leaked in, the numbers below would change.
    await setPattern({ enabled: true, startTime: '14:00', endTime: '22:00', graceInMinutes: 0 });

    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:05').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);
    const row = await dayRow(emp.id, workday);
    // Against GENERAL: 09:05 is inside its grace, so not late at all. Against the 14:00 pattern
    // the same punch would have been 305 minutes early for a shift that had not started, and the
    // day would have run to 22:00 — so every number here is GENERAL's.
    expect(row.status).toBe('present');
    expect(row.lateMinutes).toBe(0);
    // 09:05 → 17:00 is 475 minutes of presence, flat — the break is not subtracted from worked
    // time, it sets what the day REQUIRED. The seeded GENERAL has no break, so 480 is required and
    // the day is five minutes short of it, which is NOT lateness: 09:05 is inside its grace.
    expect(row.workedMinutes).toBe(475);
    expect(row.requiredMinutes).toBe(480);
    expect(row.shortfallMinutes).toBe(5);
    expect(row.overtimeMinutes).toBe(0);
    expect(row.shiftId).toBe(GENERAL.id);
  });

  it('a branch value overrides the company default for that branch', async () => {
    const emp = await regEmployee();
    const workday = recentWorkday();
    await setPattern({ enabled: true, startTime: '09:00', endTime: '17:00', graceInMinutes: 0 });
    await setPattern(
      { enabled: true, startTime: '11:00', endTime: '19:00', graceInMinutes: 0 },
      { scope: 'branch', scopeRef: BRANCH_ID },
    );

    // A SHORT day, so the lateness clause is live: 11:30 → 19:00 is 450 minutes against the
    // branch pattern's 480. Under the flexible rule a full day would report no lateness at all,
    // whichever hour it was measured against — so proving WHICH pattern applied needs a day that
    // actually owes time.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '11:30').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '19:00').toISOString() });
    await recompute(emp.id, workday);
    const row = await dayRow(emp.id, workday);
    // 30 minutes late against the BRANCH's 11:00, not 150 against the company's 09:00.
    expect(row.lateMinutes).toBe(30);
    expect(row.shortfallMinutes).toBe(30);
  });

  it('leaves `shiftId` null when the expectation came from the pattern', async () => {
    const emp = await regEmployee();
    const workday = recentWorkday();
    await setPattern({ enabled: true, startTime: '09:00', endTime: '17:00' });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    await recompute(emp.id, workday);
    // No shift document was involved, so the row must not claim one — the payroll feed carries
    // this field onward.
    expect((await dayRow(emp.id, workday)).shiftId).toBeNull();
  });
});

// ── AT-4 — the freeze + the §15.1 feed seam (D-PR-07 Option A) ──────────────
//
// `freezePeriod` and `readFrozenFeed` are INTERNAL: no route mounts them, so the suite calls the
// service directly — the same way payroll's two ports do (PY-4 reads the feed, PY-6 calls the
// freeze). Everything runs against
// the PREVIOUS Cairo month (the freeze refuses a period still being lived), which stays inside
// the 90-day punch sanity window.
describe('the daily sheet, and «لم يحضر بعد» resolved when it is read (stage 2)', () => {
  // The sheet's own branch, so these assertions count THESE employees and not the hundred the
  // rest of the suite has registered in the shared one.
  let SHEET_BRANCH = '';
  let SHEET_DEPARTMENT = '';

  const patternCtx = (): AuthContext => ({
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

  const PATTERN_KEYS = [
    HrAttendanceSettingKeys.DefaultPatternEnabled,
    HrAttendanceSettingKeys.DefaultPatternStartTime,
    HrAttendanceSettingKeys.DefaultPatternEndTime,
    HrAttendanceSettingKeys.DefaultPatternBreakMinutes,
    HrAttendanceSettingKeys.DefaultPatternGraceInMinutes,
    HrAttendanceSettingKeys.DefaultPatternGraceOutMinutes,
  ] as const;

  /** The pattern OFF, so a shift-less employee has no expectation and reads «لا يوجد جدول». */
  const switchPatternOff = async (): Promise<void> => {
    await settingsService.set(patternCtx(), {
      key: HrAttendanceSettingKeys.DefaultPatternEnabled,
      scope: 'organization',
      value: false,
    });
  };

  /** The pattern on company-wide, 09:00–17:00, so everybody in this block is EXPECTED. */
  const switchPatternOn = async (): Promise<void> => {
    for (const [key, value] of [
      [HrAttendanceSettingKeys.DefaultPatternEnabled, true],
      [HrAttendanceSettingKeys.DefaultPatternStartTime, '09:00'],
      [HrAttendanceSettingKeys.DefaultPatternEndTime, '17:00'],
      [HrAttendanceSettingKeys.DefaultPatternGraceInMinutes, 15],
    ] as const) {
      await settingsService.set(patternCtx(), { key, scope: 'organization', value });
    }
  };

  const sheet = async (
    date: Date,
    token = adminToken,
  ): Promise<{ status: number; rows: AttendanceSheetRowDto[] }> => {
    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(date)}&branchId=${SHEET_BRANCH}&pageSize=100`,
      )
      .set('Authorization', `Bearer ${token}`);
    return { status: res.status, rows: (res.body.data ?? []) as AttendanceSheetRowDto[] };
  };

  const dayListCount = async (date: Date): Promise<number> => {
    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days?from=${dateOnlyIso(date)}&to=${dateOnlyIso(date)}&branchId=${SHEET_BRANCH}&pageSize=100`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    return (res.body.data as AttendanceDayDto[]).length;
  };

  /**
   * A WORKING day in the future — not a weekend and not a seeded public holiday. The suite's
   * `recentWorkday` looks backwards and its holiday set only covers the past fortnight, so the
   * forward window is fetched here: a future date that turned out to be a holiday would derive
   * `holiday` and the «لم يحضر بعد» assertion would fail for the right reason at the wrong time.
   */
  let FORWARD_HOLIDAY_ISO: Set<string> = new Set();
  const nextWorkday = (): Date => {
    let day = addDays(cairoToday(), 1);
    while ([5, 6].includes(isoWeekday(day)) || FORWARD_HOLIDAY_ISO.has(dateOnlyIso(day))) {
      day = addDays(day, 1);
    }
    return day;
  };

  /**
   * The next WEEKEND day (Fri=5 per the seeded calendar), looking FORWARD rather than back.
   *
   * It has to be forward: on a past date with no row the line is omitted — the engine never
   * concluded that day for that person — and the omission is decided before the calendar is
   * consulted. The case worth testing is a Friday MORNING anyway, which is what forward means.
   */
  const nextWeekendDay = (): Date => {
    let day = addDays(cairoToday(), 1);
    while (isoWeekday(day) !== 5) day = addDays(day, 1);
    return day;
  };

  beforeAll(async () => {
    const calRes = await request(app)
      .get(
        `/api/v1/hr/work-calendar?from=${dateOnlyIso(cairoToday())}&to=${dateOnlyIso(addDays(cairoToday(), 15))}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(calRes.status).toBe(200);
    FORWARD_HOLIDAY_ISO = new Set(
      (calRes.body.data as { holidays: { date: string }[] }).holidays.map((h) => h.date.slice(0, 10)),
    );

    const branchRes = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: '090', name: { ar: 'فرع كشف الحضور', en: 'Sheet branch' } });
    SHEET_BRANCH = (branchRes.body as { data: { id: string } }).data.id;
    const depRes = await request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'DEP-AT-90', name: { ar: 'إدارة', en: 'Ops' }, branchId: SHEET_BRANCH });
    SHEET_DEPARTMENT = (depRes.body as { data: { id: string } }).data.id;
  }, 60_000);

  afterEach(async () => {
    // By DELETING, never by writing `false` at branch scope — a branch row beats the organization
    // row and would silently override a later test that switches the pattern on company-wide.
    await SettingValueModel.deleteMany({ key: { $in: [...PATTERN_KEYS] } }).exec();
    for (const key of PATTERN_KEYS) await getCache().delByPrefix(`settings:${key}:`);
  });

  const inBranch = (): Promise<EmployeeDto> =>
    regEmployee({ branchId: SHEET_BRANCH, departmentId: SHEET_DEPARTMENT });

  it('LISTS EVERY EMPLOYEE, not only the ones with a row — the undercount this fixes', async () => {
    // THE BUG, STATED AS A TEST. Three employees, one of whom the engine has written a row for.
    // The day list can only answer about that one row, which is why the old sheet reported
    // near-perfect attendance every morning: the people it was opened to find — the ones nobody
    // had recomputed, because they had not scanned — were exactly the ones it left out.
    //
    // Today, and deliberately asserting COUNTS rather than statuses: whether today is a working
    // day, a weekend or a public holiday changes what each line says and not how many there are.
    const known = await inBranch();
    await inBranch();
    await inBranch();
    const today = cairoToday();
    await recompute(known.id, today);

    expect(await dayListCount(today)).toBe(1);
    const { status, rows } = await sheet(today);
    expect(status).toBe(200);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.day !== null)).toHaveLength(1);
    expect(rows.filter((r) => r.day === null)).toHaveLength(2);
  });

  it('attaches the day row, with its times, to the employee who did scan', async () => {
    const emp = await inBranch();
    const workday = recentWorkday();
    await switchPatternOn();
    expect(
      (await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:02').toISOString() }))
        .status,
    ).toBe(201);
    await recompute(emp.id, workday);

    const mine = (await sheet(workday)).rows.find((r) => r.employeeId === emp.id);
    expect(mine?.status).toBe('checkedIn');
    expect(mine?.day?.firstInAt).toBe(cairoInstant(workday, '09:02').toISOString());
    expect(mine?.employeeCode).toBe(emp.code);
  });

  it('shows a no-show with NO day row, and writes nothing to make them appear', async () => {
    // The guarantee that makes read-time resolution worth having: drawing the screen must not mint
    // a row per employee for a date that is not over, 1,300 at a time, each to be corrected when
    // the person walks in. The resolved label itself is pinned in `resolve-display-status.spec`,
    // where `now` is injected and the boundary can be tested instead of waited for.
    const emp = await inBranch();
    const today = cairoToday();
    await switchPatternOn();

    const before = await dayListCount(today);
    const mine = (await sheet(today)).rows.find((r) => r.employeeId === emp.id);
    expect(mine).toBeDefined();
    expect(mine?.day).toBeNull();
    expect(await dayListCount(today)).toBe(before);
  });

  it('carries the expected hours, resolved now rather than stored on anything', async () => {
    const emp = await inBranch();
    const today = cairoToday();
    await switchPatternOn();
    const mine = (await sheet(today)).rows.find((r) => r.employeeId === emp.id);
    expect(mine?.expectedStartAt).toBe(cairoInstant(today, '09:00').toISOString());
    expect(mine?.expectedEndAt).toBe(cairoInstant(today, '17:00').toISOString());
  });

  it('says «لم يحضر بعد» for a working day still ahead, whose expectation cannot have ended', async () => {
    const emp = await inBranch();
    await switchPatternOn();
    const mine = (await sheet(nextWorkday())).rows.find((r) => r.employeeId === emp.id);
    expect(mine?.status).toBe('pending');
    expect(mine?.day).toBeNull();
  });

  it('says WEEKEND on a weekend, not «غائب» — nobody is expected', async () => {
    // The regression this is here for: with the pattern on and no row, a Friday would otherwise
    // read «لم يحضر بعد» all morning and «غائب» all evening, for every employee in the company.
    const emp = await inBranch();
    await switchPatternOn();
    const mine = (await sheet(nextWeekendDay())).rows.find((r) => r.employeeId === emp.id);
    expect(mine?.status).toBe('weekend');
  });

  it('says the SCHEDULE IS MISSING, not «يوم راحة», when nobody said when the person was due', async () => {
    // THE PRODUCTION BUG, and it needs the pattern switched OFF to reproduce now — the company
    // hours of 18 November mean a shift-less employee normally HAS an expectation. The case is
    // still live for any branch that turns the pattern off, and the answer must stay «لا يوجد
    // جدول»: this once answered `dayOff`, so every employee on the sheet read «يوم راحة» on a
    // Tuesday — the company claiming it owed them no work, which nobody had decided, and which hid
    // the real problem of an empty roster. Recomputed first, so the stored row and the sheet are
    // checked to give the same answer rather than two.
    const emp = await inBranch();
    const workday = recentWorkday();
    await switchPatternOff();
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('noSchedule');
    const mine = (await sheet(workday)).rows.find((r) => r.employeeId === emp.id);
    expect(mine?.status).toBe('noSchedule');
    expect(mine?.expectedEndAt).toBeNull();
  });

  it('a missing schedule does NOT overrule the weekend — that really is a rest day', async () => {
    // The two answers must stay separate in the direction that matters as well: a Friday is a rest
    // day for everybody, roster or no roster, and must not start reading «لا يوجد جدول».
    const emp = await inBranch();
    const mine = (await sheet(nextWeekendDay())).rows.find((r) => r.employeeId === emp.id);
    expect(mine?.status).toBe('weekend');
  });

  it('reads a row the nightly pass never reached as the absence it turned out to be', async () => {
    // THE CASE THE OWNER CAUGHT. A branch recompute in the afternoon writes `pending`; nothing
    // rewrites it until 2 AM; in between the sheet must not keep claiming the person might still
    // arrive on a day that has ended.
    //
    // The row is aged by writing it directly, because that is the only way to produce one: the
    // state needs a recompute that happened WHILE a now-past date was still being lived, and a
    // test cannot wait a day. Everything after the write goes through the API.
    const emp = await inBranch();
    const workday = recentWorkday();
    await switchPatternOn();
    await recompute(emp.id, workday);
    await AttendanceDayModel.updateOne(
      { employeeId: new Types.ObjectId(emp.id), workDate: workday },
      { $set: { status: 'pending' } },
    ).exec();

    // Stored one thing, read as another — and the stored row is left exactly as it was.
    expect((await dayRow(emp.id, workday)).status).toBe('pending');
    const mine = (await sheet(workday)).rows.find((r) => r.employeeId === emp.id);
    expect(mine?.status).toBe('absent');
    expect((await dayRow(emp.id, workday)).status).toBe('pending');
  });

  it('leaves out a past date the engine never concluded for that person', async () => {
    // Before they were hired, so `deriveDay` returns no row at all by design. An «غائب» invented
    // here would be a claim about somebody who did not work for the company yet.
    const emp = await inBranch();
    await switchPatternOn();
    const longAgo = new Date(Date.UTC(2023, 5, 15));
    const rows = (await sheet(longAgo)).rows;
    expect(rows.find((r) => r.employeeId === emp.id)).toBeUndefined();
  });

  it('COUNTS THE WHOLE DAY, not the page — the cards would otherwise lie (stage 6)', async () => {
    const scanned = await inBranch();
    await inBranch();
    await inBranch();
    const today = cairoToday();
    await switchPatternOn();
    await recompute(scanned.id, today);

    // ONE ROW PER PAGE. A count taken from the page would say "1"; the property under test is
    // that both the page meta and the summary describe the whole day instead. The branch's exact
    // headcount is whatever this block has registered by now, which is deliberately not asserted
    // — tying the test to it would make it fail every time a sibling test added an employee.
    const paged = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(today)}&branchId=${SHEET_BRANCH}&pageSize=1`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(paged.status).toBe(200);
    expect((paged.body.data as AttendanceSheetRowDto[])).toHaveLength(1);
    const total = (paged.body.meta as { totalItems: number }).totalItems;
    expect(total).toBeGreaterThanOrEqual(3);

    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet/summary?date=${dateOnlyIso(today)}&branchId=${SHEET_BRANCH}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const summary = res.body.data as AttendanceSheetSummaryDto;
    // The cards and the table agree about how many people the day covers.
    expect(summary.total).toBe(total);
    // Every status is counted separately — the screen does the grouping, not the server.
    const counted = Object.values(summary.byStatus).reduce((sum, n) => sum + n, 0);
    expect(counted).toBe(total);
  });

  it('filters by the RESOLVED status, which is not a stored field', async () => {
    const emp = await inBranch();
    await inBranch();
    const workday = recentWorkday();
    await switchPatternOff();
    await recompute(emp.id, workday);
    // With the pattern off and no assignment, every one of them has no schedule — a status that
    // exists nowhere in the database and can only be filtered after it is worked out. The pattern
    // is switched off explicitly now that the company hours ship on; the property under test is
    // the filter, not which status happens to be the default.
    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(workday)}&branchId=${SHEET_BRANCH}&status=noSchedule&pageSize=100`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as AttendanceSheetRowDto[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'noSchedule')).toBe(true);

    // And a status nobody on this date holds narrows to nothing rather than to everybody.
    const none = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(workday)}&branchId=${SHEET_BRANCH}&status=onLeave&pageSize=100`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect((none.body.data as AttendanceSheetRowDto[])).toHaveLength(0);
  });

  it('searches by name or code', async () => {
    const emp = await inBranch();
    const today = cairoToday();
    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(today)}&branchId=${SHEET_BRANCH}&search=${emp.code}&pageSize=100`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const rows = res.body.data as AttendanceSheetRowDto[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employeeId).toBe(emp.id);
    // The summary narrows with it, so the cards describe what the table is showing.
    const summary = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet/summary?date=${dateOnlyIso(today)}&branchId=${SHEET_BRANCH}&search=${emp.code}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect((summary.body.data as AttendanceSheetSummaryDto).total).toBe(1);
  });

  /**
   * THE ARRIVAL CHART, THE ROSTER AND THE LAST SCAN — the three things the redesigned sheet needs
   * that no row carries. All three are aggregated over the WHOLE filtered day beside the counts,
   * because a chart drawn from one page of fifty would redraw itself every time somebody turned a
   * page, and the question it answers is about the day.
   */
  it('aggregates the arrivals, the roster and the last scan for the whole day', async () => {
    const early = await inBranch();
    const late = await inBranch();
    const workday = recentWorkday();
    await switchPatternOn();
    // 08:52 and 09:42 Cairo — one inside the 9:00 + 15 grace, one well past it.
    for (const [emp, at] of [
      [early, '08:52'],
      [late, '09:42'],
    ] as const) {
      const rec = await recordPunch({
        employeeId: emp.id,
        at: cairoInstant(workday, at).toISOString(),
        direction: 'in',
      });
      expect(rec.status).toBe(201);
      await recompute(emp.id, workday);
    }

    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet/summary?date=${dateOnlyIso(workday)}&branchId=${SHEET_BRANCH}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const summary = res.body.data as AttendanceSheetSummaryDto;

    // The roster the sheet is held to, read from the default pattern rather than assumed.
    expect(summary.dayStart).toBe(9 * 60);
    expect(summary.graceMinutes).toBe(15);

    // One arrival in the 08:45 quarter and one in the 09:30 quarter — slots are quarter hours,
    // counted from each person's FIRST check-in, and empty quarters are left out entirely.
    const bySlot = new Map(summary.arrivals.map((a) => [a.slot, a.count]));
    expect(bySlot.get(8 * 60 + 45)).toBeGreaterThanOrEqual(1);
    expect(bySlot.get(9 * 60 + 30)).toBeGreaterThanOrEqual(1);
    expect(summary.arrivals.every((a) => a.slot % 15 === 0 && a.count > 0)).toBe(true);

    // The last scan comes from the PUNCHES, so it is a fact the moment one is imported rather
    // than a second after the row it belongs to is rewritten.
    expect(summary.lastPunchAt).not.toBeNull();
    expect(new Date(summary.lastPunchAt as string).toISOString()).toBe(
      cairoInstant(workday, '09:42').toISOString(),
    );
  });

  it('reports no roster at all rather than a working day nobody set', async () => {
    // The pattern is off and nobody is assigned a shift. The screen must not draw a «بداية الدوام»
    // line at nine o'clock: that is a claim about lateness nobody in the company has made.
    await settingsService.set(patternCtx(), {
      key: HrAttendanceSettingKeys.DefaultPatternEnabled,
      scope: 'organization',
      value: false,
    });
    await inBranch();
    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet/summary?date=${dateOnlyIso(recentWorkday())}&branchId=${SHEET_BRANCH}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect((res.body.data as AttendanceSheetSummaryDto).dayStart).toBeNull();
    await switchPatternOn();
  });

  it('names the department on every line, so the client needs no catalogue', async () => {
    const emp = await inBranch();
    const { rows } = await sheet(cairoToday());
    const line = rows.find((r) => r.employeeId === emp.id);
    expect(line?.employeeDepartment?.ar).toBeTruthy();
  });

  /**
   * ONE EMPLOYEE'S PERIOD, ADDED UP BY THE SERVER — the six figures above their attendance page.
   *
   * The client does no arithmetic over a month: the figures are computed beside the rows they come
   * from, so the page, the profile tab and My Attendance cannot drift into three answers about the
   * same person.
   */
  it('adds up one employee period, in the same words payroll uses', async () => {
    const emp = await inBranch();
    const workday = recentWorkday();
    await switchPatternOn();
    // In 09:42 (past the 9:00 + 15 grace) and out 17:30 — one late day, measured hours.
    for (const [at, direction] of [
      ['09:42', 'in'],
      ['17:30', 'out'],
    ] as const) {
      const rec = await recordPunch({
        employeeId: emp.id,
        at: cairoInstant(workday, at).toISOString(),
        direction,
      });
      expect(rec.status).toBe(201);
    }
    await recompute(emp.id, workday);

    const iso = dateOnlyIso(workday);
    const res = await request(app)
      .get(`/api/v1/hr/attendance/days/employee-summary?employeeId=${emp.id}&from=${iso}&to=${iso}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const figures = res.body.data as AttendanceEmployeeSummaryDto;

    expect(figures.daysPresent).toBe(1);
    expect(figures.daysExpected).toBe(1);
    expect(figures.lateDays).toBe(1);
    expect(figures.lateMinutesTotal).toBeGreaterThan(0);
    expect(figures.absentDays).toBe(0);
    expect(figures.incompleteDays).toBe(0);
    // Cairo minutes after midnight, not the server's zone: 09:42 and 17:30.
    expect(figures.usualArrival).toBe(9 * 60 + 42);
    expect(figures.usualDeparture).toBe(17 * 60 + 30);
    expect(figures.avgWorkedMinutes).toBe(figures.totalWorkedMinutes);
    // This employee's own roster, for the punctuality band.
    expect(figures.dayStart).toBe(9 * 60);
    expect(figures.graceMinutes).toBe(15);
    expect(figures.lastPunchAt).toBe(cairoInstant(workday, '17:30').toISOString());
  });

  it('averages hours over the days that HAVE hours, never over the ones without', async () => {
    // On this payroll most days are a scan in and nothing out. Dividing the month's minutes by
    // every attended day would report half the real figure.
    const emp = await inBranch();
    const full = recentWorkday();
    // The next WORKDAY, not simply the next day: a Friday or a holiday there is no day at work.
    let openEnded = addDays(full, 1);
    while ([5, 6].includes(isoWeekday(openEnded)) || HOLIDAY_ISO.has(dateOnlyIso(openEnded))) {
      openEnded = addDays(openEnded, 1);
    }
    await switchPatternOn();
    for (const [day, at, direction] of [
      [full, '09:00', 'in'],
      [full, '17:00', 'out'],
      [openEnded, '09:00', 'in'],
    ] as const) {
      await recordPunch({
        employeeId: emp.id,
        at: cairoInstant(day, at).toISOString(),
        direction,
      });
    }
    await recompute(emp.id, full);
    await recompute(emp.id, openEnded);

    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/employee-summary?employeeId=${emp.id}&from=${dateOnlyIso(full)}&to=${dateOnlyIso(openEnded)}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    const figures = res.body.data as AttendanceEmployeeSummaryDto;
    // Both days are days at work; only one of them has hours, and that one sets the average.
    expect(figures.daysPresent).toBe(2);
    expect(figures.incompleteDays).toBe(1);
    expect(figures.avgWorkedMinutes).toBe(figures.totalWorkedMinutes);
  });

  it('answers an employee with nothing recorded without inventing a zero', async () => {
    const emp = await inBranch();
    const iso = dateOnlyIso(recentWorkday());
    const res = await request(app)
      .get(`/api/v1/hr/attendance/days/employee-summary?employeeId=${emp.id}&from=${iso}&to=${iso}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const figures = res.body.data as AttendanceEmployeeSummaryDto;
    // Null, not 0 — a zero here would print as midnight on the screen.
    expect(figures.usualArrival).toBeNull();
    expect(figures.usualDeparture).toBeNull();
    expect(figures.avgWorkedMinutes).toBeNull();
    expect(figures.lastPunchAt).toBeNull();
  });

  it('caps the period at a year — long enough for the picker, still a cap', async () => {
    // It was 92 days, sized for a month view. The period picker now offers a custom range reaching
    // back to the employee's first scan, and «did he come on the 1st of January?» is a question
    // about a period this endpoint has to admit — so a year is accepted and more is refused. The
    // cost does not grow with the span: `loadDayInputs` batches every input once for the whole
    // period, so a year costs the same handful of queries a month does.
    const emp = await inBranch();
    const to = cairoToday();
    const within = await request(app)
      .get(
        `/api/v1/hr/attendance/days/employee-summary?employeeId=${emp.id}&from=${dateOnlyIso(addDays(to, -200))}&to=${dateOnlyIso(to)}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(within.status).toBe(200);

    const beyond = await request(app)
      .get(
        `/api/v1/hr/attendance/days/employee-summary?employeeId=${emp.id}&from=${dateOnlyIso(addDays(to, -400))}&to=${dateOnlyIso(to)}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(beyond.status).toBe(400);
  });

  it('is governed by attendance.view, and answers /me for the caller alone', async () => {
    const emp = await inBranch();
    const iso = dateOnlyIso(recentWorkday());
    const denied = await request(app)
      .get(`/api/v1/hr/attendance/days/employee-summary?employeeId=${emp.id}&from=${iso}&to=${iso}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(denied.status).toBe(403);

    // `/me/summary` carries no permission because it is own-scope BY CONSTRUCTION: the employee
    // comes from the login and the query cannot name one. An employee id in the query string is
    // not merely ignored — the schema refuses the request outright.
    const strict = await request(app)
      .get(`/api/v1/hr/attendance/days/me/summary?employeeId=${emp.id}&from=${iso}&to=${iso}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect([400, 404]).toContain(strict.status);
  });

  it('is governed by attendance.view, like the list it is a view of', async () => {
    const res = await request(app)
      .get(`/api/v1/hr/attendance/days/sheet?date=${dateOnlyIso(cairoToday())}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(res.status).toBe(403);
  });

  it('takes one date and refuses a range — a sheet is a day', async () => {
    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/days/sheet?from=${dateOnlyIso(cairoToday())}&to=${dateOnlyIso(cairoToday())}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

describe('manager day decisions (stage 3)', () => {
  /**
   * The approval threshold, set to FOURTEEN days for this block and restored afterwards.
   *
   * `recentWorkday()` lands about ten days back, which is past the shipped default of seven — so
   * every decision here would arrive as `pendingHr` and the applied-path tests would be testing
   * the queue instead. Widening it puts the ordinary workday firmly on the manager's side of the
   * line and leaves the twenty-day-old date firmly on HR's, which is what these tests are about.
   * Where the boundary itself falls is pinned exactly, and without a database, in
   * `decision-rules.spec.ts`.
   */
  const THRESHOLD = HrAttendanceSettingKeys.DecisionApprovalAfterDays;

  beforeAll(async () => {
    await settingsService.set(
      {
        userId: new Types.ObjectId().toString(),
        sessionId: 'seed',
        branchId: null,
        departmentId: null,
        sectionId: null,
        locale: 'en',
        permissions: { 'setting.edit': 'organization' },
        permissionVersion: 1,
        isPrivileged: true,
      },
      { key: THRESHOLD, scope: 'organization', value: 14 },
    );
  });

  afterAll(async () => {
    await SettingValueModel.deleteMany({ key: THRESHOLD }).exec();
    await getCache().delByPrefix(`settings:${THRESHOLD}:`);
  });

  /** A caller who is BOTH a decider and an employee — the only way to test the self-prohibition. */
  const decidingEmployee = async (): Promise<{ emp: EmployeeDto; token: string }> => {
    const emp = await regEmployee();
    const reread = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const userId = String((reread.body.data as EmployeeDto).userId);
    await userService.setPassword(userId, PASSWORD, 'passwordReset');
    await userService.forceActivate(userId);
    const superAdmin = await rbacService.ensureSystemRole(
      'super-admin',
      { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
      [...platformPermissions, ...hrPermissions].map((p) => p.key),
    );
    await rbacService.ensureAssignment(userId, String(superAdmin._id), 'organization');
    return { emp, token: await login(emp.code) };
  };

  const decide = (body: Record<string, unknown>, token = adminToken) =>
    request(app)
      .post('/api/v1/hr/attendance/decisions')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const livePunches = async (employeeId: string, day: Date): Promise<number> =>
    AttendancePunchModel.countDocuments({
      employeeId: new Types.ObjectId(employeeId),
      at: { $gte: cairoInstant(day, '00:00'), $lte: cairoInstant(addDays(day, 1), '00:00') },
      supersededBy: null,
    }).exec();

  it('marks a day absent against the evidence, and leaves the evidence standing', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('present');

    const res = await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markAbsent',
      reason: 'لم يكن على رأس العمل رغم وجود البصمة',
    });
    expect(res.status).toBe(201);
    expect((res.body.data as AttendanceDecisionDto).status).toBe('applied');
    expect((res.body.data as AttendanceDecisionDto).overrodePunch).toBe(true);

    const row = await dayRow(emp.id, workday);
    expect(row.status).toBe('absent');
    expect(row.flags).toContain('overriddenByManager');
    // THE PUNCHES ARE UNTOUCHED — not deleted, not superseded. The device saw what it saw, and
    // that is exactly what lets somebody later judge whether the manager was right.
    expect(await livePunches(emp.id, workday)).toBe(2);
  });

  it('SURVIVES a branch re-send and a recompute — the guarantee the feature exists for', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    await recompute(emp.id, workday);
    await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markAbsent',
      reason: 'غادر قبل بداية الوردية',
    });
    expect((await dayRow(emp.id, workday)).status).toBe('absent');

    // Exactly what a branch server does all morning: more punches, then recompute.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:30').toISOString() });
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('absent');
  });

  it('vouches somebody in on a day the devices never saw', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('absent');

    const res = await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markPresent',
      inAt: cairoInstant(workday, '09:05').toISOString(),
      reason: 'الجهاز كان متوقفًا وتم التحقق من الحضور',
    });
    expect(res.status).toBe(201);
    // No device evidence existed, so nothing was overridden — the §4 warning keys on this.
    expect((res.body.data as AttendanceDecisionDto).overrodePunch).toBe(false);

    const row = await dayRow(emp.id, workday);
    expect(row.status).toBe('checkedIn');
    expect(row.firstInAt).toBe(cairoInstant(workday, '09:05').toISOString());
    // 09:05 is inside GENERAL's 30-minute grace: a vouched-for arrival is judged by the same rule
    // as a scanned one, never more kindly.
    expect(row.lateMinutes).toBe(0);
    // And still no punch was written — the decision is an input, not a forged scan.
    expect(await livePunches(emp.id, workday)).toBe(0);
  });

  it('sends an OLD day to HR, changing nothing until it is approved', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    // Past the default seven-day threshold.
    const old = oldWorkday();
    await recompute(emp.id, old);
    const before = (await dayRow(emp.id, old)).status;

    const res = await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(old),
      type: 'markPresent',
      inAt: cairoInstant(old, '09:00').toISOString(),
      reason: 'تأكيد الحضور من دفتر الفرع',
    });
    expect(res.status).toBe(201);
    const decision = res.body.data as AttendanceDecisionDto;
    expect(decision.status).toBe('pendingHr');
    // Recorded, and inert: the day has not moved.
    expect((await dayRow(emp.id, old)).status).toBe(before);

    const approved = await request(app)
      .post(`/api/v1/hr/attendance/decisions/${decision.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ verdict: 'approve', version: decision.version });
    // The admin filed it, so the admin may not clear it: an approval step its own author can
    // perform is not a step.
    expect(approved.status).toBe(403);
  });

  it('applies an old-day decision once somebody OTHER than its author approves it', async () => {
    const author = await decidingEmployee();
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const old = oldWorkday();
    await recompute(emp.id, old);

    const res = await decide(
      {
        employeeId: emp.id,
        workDate: dateOnlyIso(old),
        type: 'markPresent',
        inAt: cairoInstant(old, '09:00').toISOString(),
        reason: 'تأكيد الحضور من دفتر الفرع',
      },
      author.token,
    );
    expect(res.status).toBe(201);
    const decision = res.body.data as AttendanceDecisionDto;
    expect(decision.status).toBe('pendingHr');

    const approved = await request(app)
      .post(`/api/v1/hr/attendance/decisions/${decision.id}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ verdict: 'approve', version: decision.version });
    expect(approved.status).toBe(200);
    expect((approved.body.data as AttendanceDecisionDto).status).toBe('applied');
    expect((await dayRow(emp.id, old)).status).toBe('checkedIn');
  });

  it('REVOKING puts the day back, and records the undoing rather than erasing it', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);

    const res = await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markAbsent',
      reason: 'بصمة بالخطأ من زميل',
    });
    const decision = res.body.data as AttendanceDecisionDto;
    expect((await dayRow(emp.id, workday)).status).toBe('absent');

    const revoked = await request(app)
      .post(`/api/v1/hr/attendance/decisions/${decision.id}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'تبيّن أن البصمة صحيحة', version: decision.version });
    expect(revoked.status).toBe(200);
    const record = revoked.body.data as AttendanceDecisionDto;
    expect(record.type).toBe('revoke');
    expect(record.revokesId).toBe(decision.id);

    // The day returns to what the devices saw — possible precisely because nothing of theirs was
    // ever changed — and the original decision still stands in the record, marked revoked.
    const row = await dayRow(emp.id, workday);
    expect(row.status).toBe('present');
    expect(row.flags).not.toContain('overriddenByManager');
    const list = await request(app)
      .get(`/api/v1/hr/attendance/decisions?employeeId=${emp.id}&pageSize=50`)
      .set('Authorization', `Bearer ${adminToken}`);
    const rows = list.body.data as AttendanceDecisionDto[];
    expect(rows.find((r) => r.id === decision.id)?.status).toBe('revoked');
    expect(rows).toHaveLength(2);
  });

  it('refuses a day nobody has lived yet', async () => {
    const emp = await regEmployee();
    const res = await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(addDays(cairoToday(), 1)),
      type: 'markAbsent',
      reason: 'لن يحضر غدًا',
    });
    expect(res.status).toBe(422);
  });

  it('refuses a FROZEN day, and says the correction goes forward', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recompute(emp.id, workday);
    // Stamped directly: freezing a whole period here would recompute every employee the suite has
    // created, and the condition under test is the stamp on this one row.
    await AttendanceDayModel.updateOne(
      { employeeId: new Types.ObjectId(emp.id), workDate: workday },
      { $set: { frozenAt: new Date() } },
    ).exec();

    const res = await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markAbsent',
      reason: 'محاولة تعديل شهر مغلق',
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('الشهر مغلق من المرتبات');
  });

  it('bars a caller from deciding their OWN attendance, whatever they hold', async () => {
    // A super-admin grant and all: the prohibition is about the act, not about scope.
    const self = await decidingEmployee();
    const res = await decide(
      {
        employeeId: self.emp.id,
        workDate: dateOnlyIso(recentWorkday()),
        type: 'markPresent',
        inAt: cairoInstant(recentWorkday(), '09:00').toISOString(),
        reason: 'أثبت حضوري بنفسي',
      },
      self.token,
    );
    expect(res.status).toBe(403);
  });

  it('is governed by attendance.decide', async () => {
    const emp = await regEmployee();
    const res = await decide(
      {
        employeeId: emp.id,
        workDate: dateOnlyIso(recentWorkday()),
        type: 'markAbsent',
        reason: 'بدون صلاحية',
      },
      outsiderToken,
    );
    expect(res.status).toBe(403);
  });

  it('reports WHO has been deciding days, and how often against the devices (stage 4)', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    // One day with device evidence, one without — the two shapes the signal distinguishes.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    await recompute(emp.id, workday);
    await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markAbsent',
      reason: 'لم يكن على رأس العمل',
    });

    const other = await regEmployee();
    const quietDay = addDays(workday, -1);
    await decide({
      employeeId: other.id,
      workDate: dateOnlyIso(quietDay),
      type: 'markPresent',
      inAt: cairoInstant(quietDay, '09:00').toISOString(),
      reason: 'الجهاز كان متوقفًا',
    });

    const res = await request(app)
      .get(
        `/api/v1/hr/attendance/decisions/signals?from=${dateOnlyIso(addDays(workday, -5))}&to=${dateOnlyIso(workday)}`,
      )
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const data = res.body.data as AttendanceDecisionSignalsDto;
    const mine = data.managers.find((m) => m.total >= 2);
    expect(mine).toBeDefined();
    // One of the two went against a punch; the other had nothing to go against.
    expect(mine?.overrodePunch).toBeGreaterThanOrEqual(1);
    expect(mine?.overrodePunch).toBeLessThan(mine?.total ?? 0);
    // A prompt, not a verdict: two decisions are nowhere near the threshold.
    expect(mine?.flagged).toBe(false);
    expect(data.threshold).toBeGreaterThan(0);
  });

  it('leaves revocations OUT of the counts — undoing is not a second decision', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recompute(emp.id, workday);
    const made = await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markAbsent',
      reason: 'قرار سيُلغى',
    });
    const decision = made.body.data as AttendanceDecisionDto;

    const window = `from=${dateOnlyIso(addDays(workday, -2))}&to=${dateOnlyIso(workday)}&branchId=${BRANCH_ID}`;
    const before = await request(app)
      .get(`/api/v1/hr/attendance/decisions/signals?${window}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const countBefore = (before.body.data as AttendanceDecisionSignalsDto).managers.reduce(
      (sum, m) => sum + m.total,
      0,
    );

    await request(app)
      .post(`/api/v1/hr/attendance/decisions/${decision.id}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'تراجع عن القرار', version: decision.version });

    const after = await request(app)
      .get(`/api/v1/hr/attendance/decisions/signals?${window}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const countAfter = (after.body.data as AttendanceDecisionSignalsDto).managers.reduce(
      (sum, m) => sum + m.total,
      0,
    );
    // The revocation wrote a row; it must not make the manager look busier for undoing their own
    // mistake than they would have looked leaving it standing.
    expect(countAfter).toBe(countBefore);
  });

  it('exports the decisions as CSV, behind attendance.export, with the reason in a column', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recompute(emp.id, workday);
    const reason = 'سبب يظهر في الملف';
    await decide({
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      type: 'markAbsent',
      reason,
    });

    const range = `from=${dateOnlyIso(addDays(workday, -2))}&to=${dateOnlyIso(workday)}&employeeId=${emp.id}`;
    const res = await request(app)
      .get(`/api/v1/hr/attendance/decisions/export?${range}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('employeeCode,employeeName,workDate,type,status');
    expect(res.text).toContain(reason);
    expect(res.text).toContain(emp.code);

    // Its own key: a caller who may read the screen but not take files off the system is refused.
    const refused = await request(app)
      .get(`/api/v1/hr/attendance/decisions/export?${range}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(refused.status).toBe(403);
  });

  it('caps the review and export windows, like every other range read here', async () => {
    const wide = `from=2026-01-01&to=2026-06-01`;
    for (const path of ['signals', 'export']) {
      const res = await request(app)
        .get(`/api/v1/hr/attendance/decisions/${path}?${wide}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status, path).toBe(400);
    }
  });

  it('refuses a markAbsent that tries to carry times, and a markPresent with none', async () => {
    const emp = await regEmployee();
    const workday = dateOnlyIso(recentWorkday());
    const withTimes = await decide({
      employeeId: emp.id,
      workDate: workday,
      type: 'markAbsent',
      inAt: new Date().toISOString(),
      reason: 'غير متسق',
    });
    expect(withTimes.status).toBe(400);
    const withoutTimes = await decide({
      employeeId: emp.id,
      workDate: workday,
      type: 'markPresent',
      reason: 'بدون وقت',
    });
    expect(withoutTimes.status).toBe(400);
  });
});

describe('AT-4 — freeze + the payroll feed seam', () => {
  /** The previous Cairo calendar month as `YYYY-MM`, plus a workday inside it. */
  const previousMonth = (): { period: string; workday: Date } => {
    const today = cairoToday();
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const period = `${String(first.getUTCFullYear())}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`;
    let workday = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 10));
    while ([5, 6].includes(isoWeekday(workday)) || HOLIDAY_ISO.has(dateOnlyIso(workday))) {
      workday = addDays(workday, 1);
    }
    return { period, workday };
  };

  it('refuses to freeze a period still being lived — no frozen rows for unlived days', async () => {
    const today = cairoToday();
    const current = `${String(today.getUTCFullYear())}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;
    await expect(dayRecordService.freezePeriod(current)).rejects.toThrow('after its last day');
  });

  it('refuses a malformed period', async () => {
    await expect(dayRecordService.freezePeriod('2026-7')).rejects.toThrow('not a period');
  });

  it('the feed refuses a period that is not fully frozen — complete or nothing', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const { period, workday } = previousMonth();
    await recompute(emp.id, workday); // a fluid row now exists in the period
    await expect(dayRecordService.readFrozenFeed(period)).rejects.toThrow('not frozen');
  });

  it('freeze derives, stamps, and is idempotent; frozen rows survive late punches and recomputes', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const { period, workday } = previousMonth();

    // A worked day inside the period, derived by the FREEZE itself (nobody recomputed first).
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:05').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });

    const first = await dayRecordService.freezePeriod(period);
    expect(first.frozen).toBeGreaterThan(0);
    expect(first.alreadyFrozen).toBe(false);

    const frozenRow = await dayRow(emp.id, workday);
    expect(frozenRow.status).toBe('present');
    expect(frozenRow.workedMinutes).toBe(475);
    expect(frozenRow.frozenAt).not.toBeNull();

    // Idempotent: the second freeze stamps nothing and reports the period already frozen.
    const second = await dayRecordService.freezePeriod(period);
    expect(second.frozen).toBe(0);
    expect(second.alreadyFrozen).toBe(true);

    // The truth "changes" after the freeze — a late punch lands, a recompute is demanded —
    // and the frozen row must not move a byte.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '20:00').toISOString() });
    const rec = await recompute(emp.id, workday);
    expect(rec.skippedFrozen).toBe(1);
    expect(rec.computed).toBe(0);
    const after = await dayRow(emp.id, workday);
    expect({ ...after }).toEqual({ ...frozenRow });
    // A MINUTE, not the default five seconds. `freezePeriod` walks every computable employee
    // across every day of the month — by this point in the file that is some fifty employees over
    // thirty-one days — and each day is a derivation with its own reads. It sat just inside the
    // default until the company working pattern was switched on, which gives every one of those
    // employees an expectation to resolve; the work is the same shape, there is simply more of it
    // per day. The three tests after this one read the feed it froze, so a timeout here fails them
    // too and the real cause is a long way from where they report it.
  }, 60_000);

  it('the feed returns EXACTLY the twelve §15.1 fields, schema-valid, frozen rows only', async () => {
    const { period } = previousMonth();
    const rows = await dayRecordService.readFrozenFeed(period);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).toEqual([...ATTENDANCE_FEED_FIELDS]);
      expect(AttendanceFeedRowSchema.safeParse(row).success).toBe(true);
      expect(row.frozenAt).toBeTruthy();
      expect('overtimeMinutes' in row).toBe(false);
      expect('computedAt' in row).toBe(false);
    }
  });

  it('the feed narrows to one employee when asked', async () => {
    const { period } = previousMonth();
    const all = await dayRecordService.readFrozenFeed(period);
    const someEmployee = all[0]?.employeeId as string;
    const one = await dayRecordService.readFrozenFeed(period, someEmployee);
    expect(one.length).toBeGreaterThan(0);
    expect(one.every((r) => r.employeeId === someEmployee)).toBe(true);
  });
});

// ── AT-5 — regularizations (two steps) + overtime approval ──────────────────
describe('AT-5 — regularizations and overtime approval', () => {
  /** ESS session for an auto-provisioned employee login (the leave-suite recipe). */
  const activateEssLogin = async (emp: EmployeeDto): Promise<{ userId: string; token: string }> => {
    const reread = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const userId = (reread.body.data as EmployeeDto).userId;
    expect(userId).not.toBeNull();
    await userService.setPassword(String(userId), PASSWORD, 'passwordReset');
    await userService.forceActivate(String(userId));
    return { userId: String(userId), token: await login(emp.code) };
  };

  const regManagedEmployee = async (
    managerUserId: string,
  ): Promise<{ emp: EmployeeDto; auth: { userId: string; token: string } }> => {
    const res = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: { fullNameAr: 'موظف التسويات', nationalId: nextNid(), nationality: 'Egyptian' },
          contact: { primaryPhone: nextPhone() },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH_ID,
          managerId: managerUserId,
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: '2024-01-01T00:00:00.000Z',
        },
        hiringDate: '2024-01-01T00:00:00.000Z',
      });
    expect(res.status).toBe(201);
    const emp = res.body.data as EmployeeDto;
    await assign(emp.id, GENERAL.id);
    const auth = await activateEssLogin(emp);
    const essExtra = await rbacService.ensureManagedRole(
      'at5-attendance-ess',
      { en: 'AT-5 test ESS extra', ar: 'صلاحيات اختبار' },
      ['attendance.requestRegularization'],
    );
    await rbacService.ensureAssignment(auth.userId, String(essExtra._id), 'own');
    // Role grants changed after login — refresh the session so the flags see the new key.
    return { emp, auth: { userId: auth.userId, token: await login(emp.code) } };
  };

  const file = (token: string, body: Record<string, unknown>) =>
    request(app)
      .post('/api/v1/hr/attendance/regularizations')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const decide = (token: string, id: string, verdict: 'approve' | 'reject', version: number) =>
    request(app)
      .post(`/api/v1/hr/attendance/regularizations/${id}/decide`)
      .set('Authorization', `Bearer ${token}`)
      .send({ verdict, version });

  let manager: EmployeeDto;
  let managerAuth: { userId: string; token: string };

  it('sets up a manager with an ESS login', async () => {
    manager = await regEmployee();
    managerAuth = await activateEssLogin(manager);
    expect(managerAuth.token).toBeTruthy();
  });

  it('walks the full two-step chain — no skipped step, no self-decision, recompute on approval', async () => {
    const { emp, auth } = await regManagedEmployee(managerAuth.userId);
    const workday = recentWorkday();

    // A check-in with no checkout. Still the case a regularization exists to correct — the
    // employee wants their real hours on the record — but no longer a day priced at nothing.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:05').toISOString() });
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('checkedIn');

    const filed = await file(auth.token, {
      workDate: dateOnlyIso(workday),
      proposedInAt: cairoInstant(workday, '09:00').toISOString(),
      proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
      reason: 'forgot to punch out',
    });
    expect(filed.status).toBe(201);
    const reg = filed.body.data as AttendanceRegularizationDto;
    expect(reg.status).toBe('pendingManager');

    // A second open request for the same day is refused.
    const dup = await file(auth.token, {
      workDate: dateOnlyIso(workday),
      proposedInAt: cairoInstant(workday, '09:00').toISOString(),
      proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
      reason: 'duplicate',
    });
    expect(dup.status).toBe(422);

    // The subject decides nothing; an outsider decides nothing.
    expect((await decide(auth.token, reg.id, 'approve', reg.version)).status).toBe(403);
    expect((await decide(outsiderToken, reg.id, 'approve', reg.version)).status).toBe(403);

    // Step 1 — the manager, by relationship. Lands on pendingHr, never approved.
    const step1 = await decide(managerAuth.token, reg.id, 'approve', reg.version);
    expect(step1.status).toBe(200);
    const afterStep1 = step1.body.data as AttendanceRegularizationDto;
    expect(afterStep1.status).toBe('pendingHr');

    // The manager does not reach step 2.
    expect(
      (await decide(managerAuth.token, reg.id, 'approve', afterStep1.version)).status,
    ).toBe(403);

    // Step 2 — HR by permission. Approval applies the proposal and recomputes the day.
    const step2 = await decide(adminToken, reg.id, 'approve', afterStep1.version);
    expect(step2.status).toBe(200);
    const final = step2.body.data as AttendanceRegularizationDto;
    expect(final.status).toBe('approved');
    expect(final.postFreeze).toBe(false);

    const day = await dayRow(emp.id, workday);
    expect(day.status).toBe('present');
    expect(day.workedMinutes).toBe(480);
    expect(day.firstInAt).toBe(cairoInstant(workday, '09:00').toISOString());
    // AT-D2 (D12.3): before the split this day raised `manualPunch`, so an approved two-step
    // correction and an HR hand-entry were indistinguishable in the derived row. Both halves are
    // asserted — the positive one alone would let the old conflation back in unnoticed.
    expect(day.flags).toContain('regularizedPunch');
    expect(day.flags).not.toContain('manualPunch');
  });

  it('rejects at either step, finally; HR may substitute at step 1 without skipping step 2', async () => {
    const { auth } = await regManagedEmployee(managerAuth.userId);
    const workday = recentWorkday();

    const filedA = await file(auth.token, {
      workDate: dateOnlyIso(workday),
      proposedInAt: cairoInstant(workday, '09:00').toISOString(),
      proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
      reason: 'wrong device day A',
    });
    const regA = filedA.body.data as AttendanceRegularizationDto;
    const rejected = await decide(managerAuth.token, regA.id, 'reject', regA.version);
    expect((rejected.body.data as AttendanceRegularizationDto).status).toBe('rejected');

    // A fresh request: HR acts at the MANAGER step (the R9 deadlock escape) — still two steps.
    const filedB = await file(auth.token, {
      workDate: dateOnlyIso(addDays(workday, -1)),
      proposedInAt: cairoInstant(addDays(workday, -1), '09:00').toISOString(),
      proposedOutAt: cairoInstant(addDays(workday, -1), '17:00').toISOString(),
      reason: 'wrong device day B',
    });
    const regB = filedB.body.data as AttendanceRegularizationDto;
    const hrStep1 = await decide(adminToken, regB.id, 'approve', regB.version);
    expect((hrStep1.body.data as AttendanceRegularizationDto).status).toBe('pendingHr');
  });

  it('HR direct edit (D7): one act, mandatory reason, applied immediately', async () => {
    const { emp } = await regManagedEmployee(managerAuth.userId);
    const workday = recentWorkday();
    const direct = await file(adminToken, {
      employeeId: emp.id,
      workDate: dateOnlyIso(workday),
      proposedInAt: cairoInstant(workday, '09:00').toISOString(),
      proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
      reason: 'device failure confirmed by branch manager',
    });
    expect(direct.status).toBe(201);
    const reg = direct.body.data as AttendanceRegularizationDto;
    expect(reg.direct).toBe(true);
    expect(reg.status).toBe('approved');
    expect((await dayRow(emp.id, workday)).status).toBe('present');
  });

  it('overtime approval: ceiling, idempotent assignment, authZ, and the recompute clamp', async () => {
    const { emp } = await regManagedEmployee(managerAuth.userId);
    const workday = recentWorkday();
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    const outPunch = await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(workday, '19:00').toISOString(),
    });
    await recompute(emp.id, workday);
    let day = await dayRow(emp.id, workday);
    expect(day.overtimeMinutes).toBe(120);
    expect(day.approvedOvertimeMinutes).toBe(0);

    const approve = (minutes: number, version: number, token = adminToken) =>
      request(app)
        .post(`/api/v1/hr/attendance/overtime/${day.id}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvedMinutes: minutes, version });

    expect((await approve(150, day.version)).status).toBe(422); // above the derived ceiling
    expect((await approve(90, day.version, outsiderToken)).status).toBe(403);

    const ok90 = await approve(90, day.version);
    expect(ok90.status).toBe(200);
    day = await dayRow(emp.id, workday);
    expect(day.approvedOvertimeMinutes).toBe(90);

    // Assignment, not accumulation: a re-approval sets, never adds.
    const ok60 = await approve(60, day.version);
    expect(ok60.status).toBe(200);
    day = await dayRow(emp.id, workday);
    expect(day.approvedOvertimeMinutes).toBe(60);

    // The derivation drops (the out-punch is superseded to 17:30) — the approved value clamps.
    await recordPunch({
      employeeId: emp.id,
      at: cairoInstant(workday, '17:30').toISOString(),
      supersedesId: (outPunch.body.data as { id: string }).id,
    });
    await recompute(emp.id, workday);
    day = await dayRow(emp.id, workday);
    expect(day.overtimeMinutes).toBe(30);
    expect(day.approvedOvertimeMinutes).toBe(30);
  });

  it('postFreeze: the frozen row is never touched; the correction is marked to flow forward', async () => {
    const { emp, auth } = await regManagedEmployee(managerAuth.userId);
    const today = cairoToday();
    const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const period = `${String(first.getUTCFullYear())}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`;
    let workday = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 12));
    while ([5, 6].includes(isoWeekday(workday)) || HOLIDAY_ISO.has(dateOnlyIso(workday))) {
      workday = addDays(workday, 1);
    }

    await recompute(emp.id, workday);
    await dayRecordService.freezePeriod(period); // stamps this employee's fresh rows
    const frozen = await dayRow(emp.id, workday);
    expect(frozen.frozenAt).not.toBeNull();
    expect(frozen.status).toBe('absent');

    const filed = await file(auth.token, {
      workDate: dateOnlyIso(workday),
      proposedInAt: cairoInstant(workday, '09:00').toISOString(),
      proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
      reason: 'worked that day, device was down',
    });
    const reg = filed.body.data as AttendanceRegularizationDto;
    const step1 = await decide(managerAuth.token, reg.id, 'approve', reg.version);
    const step2 = await decide(
      adminToken,
      reg.id,
      'approve',
      (step1.body.data as AttendanceRegularizationDto).version,
    );
    const final = step2.body.data as AttendanceRegularizationDto;
    expect(final.status).toBe('approved');
    expect(final.postFreeze).toBe(true);

    // The frozen row did not move a byte — no restatement, ever.
    const after = await dayRow(emp.id, workday);
    expect({ ...after }).toEqual({ ...frozen });

    // And overtime approval on a frozen day refuses outright.
    const ot = await request(app)
      .post(`/api/v1/hr/attendance/overtime/${after.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approvedMinutes: 0, version: after.version });
    expect(ot.status).toBe(422);

    /**
     * P-HR-08 — and now somebody can FIND it.
     *
     * The stamp above has existed since AT-5, and until this phase nothing could list it: no
     * filter, no screen, no reader outside this module. So the one case that needs a human — a
     * correction against a month that was already paid — was the one case nobody could see. The
     * filter is on the organization-wide read that already existed, behind the key that already
     * governed it.
     */
    const corrections = await request(app)
      .get('/api/v1/hr/attendance/regularizations')
      .query({ postFreeze: 'true', pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(corrections.status, JSON.stringify(corrections.body)).toBe(200);
    const listed = corrections.body.data as AttendanceRegularizationDto[];
    expect(listed.map((r) => r.id)).toContain(reg.id);
    expect(listed.every((r) => r.postFreeze)).toBe(true);

    // …and the complement is a real question too: this one must NOT appear among the normal ones.
    const normal = await request(app)
      .get('/api/v1/hr/attendance/regularizations')
      .query({ postFreeze: 'false', pageSize: 100 })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(normal.status).toBe(200);
    expect((normal.body.data as AttendanceRegularizationDto[]).map((r) => r.id)).not.toContain(
      reg.id,
    );
  }, 60_000);
});

// ── AT-6 — the reading surfaces: scoped lists, the ESS own-scope, the queue, the CSV ─────────
describe('AT-6 — screens, self-service and export', () => {
  /** An employee with an ESS login carrying exactly the two keys the ESS role grants. */
  const essEmployee = async (): Promise<{ emp: EmployeeDto; token: string }> => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const reread = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const userId = String((reread.body.data as EmployeeDto).userId);
    await userService.setPassword(userId, PASSWORD, 'passwordReset');
    await userService.forceActivate(userId);
    // The attendance migration widens the seeded ESS role; a login provisioned before it ran
    // still holds the leave-only set, so re-assert the grant the same way the migration does.
    await rbacService.addSystemRoleGrants('employee-self-service', [
      'attendance.view',
      'attendance.requestRegularization',
    ]);
    return { emp, token: await login(emp.code) };
  };

  const get = (path: string, token: string) =>
    request(app).get(`/api/v1/${path}`).set('Authorization', `Bearer ${token}`);

  it('the ESS role carries attendance.view and requestRegularization, at own scope only', async () => {
    const { token } = await essEmployee();
    const me = await get('auth/me', token);
    expect(me.status).toBe(200);
    const permissions = (me.body.data as { permissions: Record<string, string> }).permissions;
    expect(permissions['attendance.view']).toBe('own');
    expect(permissions['attendance.requestRegularization']).toBe('own');
    // Nothing wider, and no decision or export key — ESS decides and exports nothing.
    expect(permissions['attendance.decideRegularization']).toBeUndefined();
    expect(permissions['attendance.export']).toBeUndefined();
    expect(permissions['attendance.approveOvertime']).toBeUndefined();
  });

  it('own scope answers for the caller and NEVER for another employee', async () => {
    const mine = await essEmployee();
    const other = await regEmployee();
    await assign(other.id, GENERAL.id);
    const workday = recentWorkday();
    for (const employee of [mine.emp, other]) {
      await recordPunch({ employeeId: employee.id, at: cairoInstant(workday, '09:00').toISOString() });
      await recordPunch({ employeeId: employee.id, at: cairoInstant(workday, '17:00').toISOString() });
      await recompute(employee.id, workday);
    }
    const range = `from=${dateOnlyIso(workday)}&to=${dateOnlyIso(workday)}`;

    // /me: the caller's own row, whatever filters are attempted.
    const me = await get(`hr/attendance/days/me?${range}`, mine.token);
    expect(me.status).toBe(200);
    const mineRows = me.body.data as AttendanceDayDto[];
    expect(mineRows).toHaveLength(1);
    expect(mineRows[0]?.employeeId).toBe(mine.emp.id);

    // A forged employeeId on /me is DROPPED, never honoured: the controller rebuilds the query
    // from the caller's own link, so the answer is still exactly the caller's row.
    const forged = await get(`hr/attendance/days/me?${range}&employeeId=${other.id}`, mine.token);
    expect(forged.status).toBe(200);
    const forgedRows = forged.body.data as AttendanceDayDto[];
    expect(forgedRows).toHaveLength(1);
    expect(forgedRows[0]?.employeeId).toBe(mine.emp.id);

    // The scoped list under an `own` grant answers only for the caller — and asking for somebody
    // else returns NOTHING rather than their data, and rather than the caller's own rows dressed
    // as an answer about them.
    const scoped = await get(`hr/attendance/days?${range}&employeeId=${other.id}`, mine.token);
    expect(scoped.status).toBe(200);
    expect(scoped.body.data as AttendanceDayDto[]).toHaveLength(0);

    // Unfiltered, the same grant answers with the caller's own row.
    const unfiltered = await get(`hr/attendance/days?${range}`, mine.token);
    expect(unfiltered.status).toBe(200);
    const ownRows = unfiltered.body.data as AttendanceDayDto[];
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0]?.employeeId).toBe(mine.emp.id);
  });

  it('lists days for the daily sheet with the employee labels the screen renders', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);

    const res = await get(
      `hr/attendance/days?from=${dateOnlyIso(workday)}&to=${dateOnlyIso(workday)}&employeeId=${emp.id}`,
      adminToken,
    );
    expect(res.status).toBe(200);
    const row = (res.body.data as AttendanceDayDto[])[0];
    expect(row?.employeeCode).toBe(emp.code);
    expect(row?.employeeName).toBe(emp.personal.fullNameAr);
    // The row carries its concurrency token — the overtime approval rides it.
    expect(typeof row?.version).toBe('number');
  });

  it('filters the sheet by section through the employees, since a day row carries only a branch', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recompute(emp.id, workday);
    const range = `from=${dateOnlyIso(workday)}&to=${dateOnlyIso(workday)}`;

    // The employee sits in no section, so a section filter must exclude them rather than ignore it.
    const filtered = await get(`hr/attendance/days?${range}&sectionId=${DEPARTMENT_ID}`, adminToken);
    expect(filtered.status).toBe(200);
    expect((filtered.body.data as AttendanceDayDto[]).some((r) => r.employeeId === emp.id)).toBe(false);
    const unfiltered = await get(`hr/attendance/days?${range}&employeeId=${emp.id}`, adminToken);
    expect((unfiltered.body.data as AttendanceDayDto[]).some((r) => r.employeeId === emp.id)).toBe(true);
  });

  // «هنخلي كل الفلترز multi»: the sheet's branch and section each take several, ORed — and the CSV
  // reads the same filters. One value, every link written before, still answers as it did.
  it('the sheet and its CSV take several branches and several sections at once', async () => {
    const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
      const res = await request(app)
        .post(`/api/v1/platform/${path}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body);
      expect(res.status).toBe(201);
      return (res.body as { data: { id: string } }).data.id;
    };
    const place = async (n: string): Promise<{ branchId: string; departmentId: string; sectionId: string }> => {
      const branchId = await post('branches', { code: `05${n}`, name: { ar: `فرع ${n}`, en: `B${n}` } });
      const departmentId = await post('departments', {
        code: `DEP-AT-M${n}`,
        name: { ar: `إدارة ${n}`, en: `D${n}` },
        branchId,
      });
      const sectionId = await post('sections', {
        code: `SEC-AT-M${n}`,
        name: { ar: `قسم ${n}`, en: `S${n}` },
        departmentId,
      });
      return { branchId, departmentId, sectionId };
    };
    const a = await place('1');
    const b = await place('2');
    const empA = await regEmployee(a);
    const empB = await regEmployee(b);
    const workday = recentWorkday();
    for (const emp of [empA, empB]) {
      await assign(emp.id, GENERAL.id);
      await recompute(emp.id, workday);
    }
    const range = `from=${dateOnlyIso(workday)}&to=${dateOnlyIso(workday)}&pageSize=100`;
    const ids = async (query: string): Promise<string[]> => {
      const res = await get(`hr/attendance/days?${range}&${query}`, adminToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.data as AttendanceDayDto[]).map((r) => r.employeeId).sort();
    };
    const both = [empA.id, empB.id].sort();

    expect(await ids(`branchId=${a.branchId},${b.branchId}`)).toEqual(both);
    expect(await ids(`branchId=${b.branchId}`)).toEqual([empB.id]);
    expect(await ids(`sectionId=${a.sectionId},${b.sectionId}`)).toEqual(both);
    expect(await ids(`sectionId=${a.sectionId}`)).toEqual([empA.id]);

    const csv = async (query: string): Promise<string> => {
      const res = await get(`hr/attendance/export?${range.replace('&pageSize=100', '')}&${query}`, adminToken);
      expect(res.status).toBe(200);
      return res.text;
    };
    const several = await csv(`branchId=${a.branchId},${b.branchId}`);
    expect(several).toContain(empA.code);
    expect(several).toContain(empB.code);
    const one = await csv(`sectionId=${b.sectionId}`);
    expect(one).toContain(empB.code);
    expect(one).not.toContain(empA.code);
  });

  it('the queue shows the manager step to the manager and the HR step to the key-holder', async () => {
    const managerEmp = await regEmployee();
    const managerReread = await request(app)
      .get(`/api/v1/hr/employees/${managerEmp.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const managerUserId = String((managerReread.body.data as EmployeeDto).userId);
    await userService.setPassword(managerUserId, PASSWORD, 'passwordReset');
    await userService.forceActivate(managerUserId);
    const managerToken = await login(managerEmp.code);

    const subject = await request(app)
      .post('/api/v1/hr/employees/direct')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        personal: {
          identity: { fullNameAr: 'موظف الطابور', nationalId: nextNid(), nationality: 'Egyptian' },
          contact: { primaryPhone: nextPhone() },
          experience: [],
          drivingLicenses: [],
          certifications: [],
          references: [],
        },
        employment: {
          jobTitleId: JOB_TITLE_ID,
          departmentId: DEPARTMENT_ID,
          branchId: BRANCH_ID,
          managerId: managerUserId,
          employmentType: 'fullTime',
          probationMonths: 0,
          startDate: '2024-01-01T00:00:00.000Z',
        },
        hiringDate: '2024-01-01T00:00:00.000Z',
      });
    const subjectEmp = subject.body.data as EmployeeDto;
    await assign(subjectEmp.id, GENERAL.id);
    const subjectReread = await request(app)
      .get(`/api/v1/hr/employees/${subjectEmp.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const subjectUserId = String((subjectReread.body.data as EmployeeDto).userId);
    await userService.setPassword(subjectUserId, PASSWORD, 'passwordReset');
    await userService.forceActivate(subjectUserId);
    await rbacService.addSystemRoleGrants('employee-self-service', [
      'attendance.view',
      'attendance.requestRegularization',
    ]);
    const subjectToken = await login(subjectEmp.code);

    const workday = recentWorkday();
    const filed = await request(app)
      .post('/api/v1/hr/attendance/regularizations')
      .set('Authorization', `Bearer ${subjectToken}`)
      .send({
        workDate: dateOnlyIso(workday),
        proposedInAt: cairoInstant(workday, '09:00').toISOString(),
        proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
        reason: 'queue visibility case',
      });
    expect(filed.status).toBe(201);
    const reg = filed.body.data as AttendanceRegularizationDto;
    expect(reg.status).toBe('pendingManager');

    // The manager sees it in their worklist, with the employee label the screen prints.
    const managerQueue = await get('hr/attendance/regularizations/pending-decisions', managerToken);
    expect(managerQueue.status).toBe(200);
    const managerRows = managerQueue.body.data as AttendanceRegularizationDto[];
    expect(managerRows.some((r) => r.id === reg.id)).toBe(true);
    expect(managerRows.find((r) => r.id === reg.id)?.employeeCode).toBe(subjectEmp.code);

    // The subject never sees their own request as something to decide (C7).
    const subjectQueue = await get('hr/attendance/regularizations/pending-decisions', subjectToken);
    expect((subjectQueue.body.data as AttendanceRegularizationDto[]).some((r) => r.id === reg.id)).toBe(false);

    // An outsider with no relationship and no key sees nothing.
    const outsiderQueue = await get('hr/attendance/regularizations/pending-decisions', outsiderToken);
    expect(outsiderQueue.status).toBe(200);
    expect((outsiderQueue.body.data as AttendanceRegularizationDto[]).some((r) => r.id === reg.id)).toBe(false);

    // The administrative list needs the decision key; the subject's ESS login is refused.
    expect((await get('hr/attendance/regularizations', subjectToken)).status).toBe(403);
    const adminList = await get('hr/attendance/regularizations?status=pendingManager', adminToken);
    expect(adminList.status).toBe(200);
    expect((adminList.body.data as AttendanceRegularizationDto[]).some((r) => r.id === reg.id)).toBe(true);

    // My own requests are readable by the subject — and only their own.
    const mine = await get('hr/attendance/regularizations/me', subjectToken);
    expect(mine.status).toBe(200);
    const mineRows = mine.body.data as AttendanceRegularizationDto[];
    expect(mineRows.every((r) => r.employeeId === subjectEmp.id)).toBe(true);
  });

  // «هنخلي كل الفلترز multi»: the «all» tab's status takes several, ORed; one value still works.
  it('lists regularizations in several statuses at once', async () => {
    const workday = recentWorkday();
    // No manager: the employee's own request goes straight to the HR step.
    const ess = await essEmployee();
    const filed = await request(app)
      .post('/api/v1/hr/attendance/regularizations')
      .set('Authorization', `Bearer ${ess.token}`)
      .send({
        workDate: dateOnlyIso(workday),
        proposedInAt: cairoInstant(workday, '09:00').toISOString(),
        proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
        reason: 'several statuses, pending',
      });
    expect(filed.status).toBe(201);
    const pending = filed.body.data as AttendanceRegularizationDto;
    expect(pending.status).toBe('pendingHr');
    // HR's own filing is decided in the same act.
    const other = await regEmployee();
    await assign(other.id, GENERAL.id);
    const direct = await request(app)
      .post('/api/v1/hr/attendance/regularizations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        employeeId: other.id,
        workDate: dateOnlyIso(workday),
        proposedInAt: cairoInstant(workday, '09:00').toISOString(),
        proposedOutAt: cairoInstant(workday, '17:00').toISOString(),
        reason: 'several statuses, approved',
      });
    expect(direct.status).toBe(201);
    const approved = direct.body.data as AttendanceRegularizationDto;
    expect(approved.status).toBe('approved');

    const ids = async (status: string): Promise<string[]> => {
      const res = await get(`hr/attendance/regularizations?status=${status}&pageSize=100`, adminToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.data as AttendanceRegularizationDto[]).map((r) => r.id);
    };
    const several = await ids('pendingHr,approved');
    expect(several).toContain(pending.id);
    expect(several).toContain(approved.id);
    const one = await ids('approved');
    expect(one).toContain(approved.id);
    expect(one).not.toContain(pending.id);
    // A status the vocabulary lacks is refused, not read as «all».
    expect((await get('hr/attendance/regularizations?status=pendingHr,nonsense', adminToken)).status).toBe(400);
  });

  it('exports a report a person can read, behind attendance.export, audited', async () => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const workday = recentWorkday();
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:00').toISOString() });
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '17:00').toISOString() });
    await recompute(emp.id, workday);
    const range = `from=${dateOnlyIso(workday)}&to=${dateOnlyIso(workday)}`;

    // Reading is not exporting: the ESS login holds attendance.view and is still refused.
    const ess = await essEmployee();
    expect((await get(`hr/attendance/export?${range}`, ess.token)).status).toBe(403);
    expect((await get(`hr/attendance/export?${range}`, outsiderToken)).status).toBe(403);

    const res = await get(`hr/attendance/export?${range}&employeeId=${emp.id}`, adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    // Named after the DATES, not the moment of export.
    expect(res.headers['content-disposition']).toContain(`attendance-${dateOnlyIso(workday)}.csv`);

    // EXCEL OPENS IT AS UTF-8 because of this, and Arabic is unreadable without it.
    expect(res.text.startsWith('\ufeff')).toBe(true);

    const lines = res.text.replace('\ufeff', '').trim().split('\r\n');
    // The English headers, in the owner's order — this admin's locale is `en`. Every value quoted,
    // which is also what stops a spreadsheet eating the leading zero of an employee code.
    expect(lines[0]).toBe(
      [
        'Employee code',
        'Name',
        'Branch',
        'Department',
        'Job title',
        'Date',
        'Status',
        'Check-in',
        'Check-out',
        'Worked',
        'Required',
        'Late',
        'Shortfall',
        'Early leave',
        'Overtime (calculated)',
        'Overtime (approved)',
        'Punches',
        // «مرات تسجيل الحضور» / «مرات تسجيل الانصراف» — how many times the person PRESSED each,
        // which is not the same as how many scans the readers saw: a repeat press counts here and
        // changes none of the times, because only the first check-in and the first check-out after
        // it are counted. They sit beside the scan count and before the notes.
        'Times checked in',
        'Times checked out',
        'Notes',
      ]
        .map((header) => `"${header}"`)
        .join(','),
    );

    const row = (lines.find((line) => line.includes(emp.code)) ?? '')
      .split('","')
      .map((cell) => cell.replace(/^"|"$/g, ''));
    expect(row).toHaveLength(20);
    expect(row[0]).toBe(emp.code);
    // dd/mm/yyyy, his words — read, not parsed.
    const [y, m, d] = dateOnlyIso(workday).split('-');
    expect(row[5]).toBe(`${d}/${m}/${y}`);
    expect(row[6]).toBe('Present');
    // THE TIMES, which the old file did not carry at all, on a twelve-hour clock.
    expect(row[7]).toBe('9:00 am');
    expect(row[8]).toBe('5:00 pm');
    // Durations as h:mm. The seeded GENERAL shift is 09:00–17:00 with no break, so a day worked
    // end to end is exactly the eight hours it required.
    expect(row[9]).toBe('8:00');
    expect(row[10]).toBe('8:00');
    // Late, shortfall, early leave, calculated overtime, approved overtime — all empty rather
    // than «0:00», because nothing was wrong with this day and five zeros per row is noise.
    expect(row.slice(11, 16)).toEqual(['', '', '', '', '']);
    expect(row[16]).toBe('2');
    // Pressed once each, so one check-in and one check-out — no repeats on this day.
    expect(row[17]).toBe('1');
    expect(row[18]).toBe('1');

    // A MISSING CHECK-OUT IS BLANK, NEVER 0:00 — the defect the owner reported by name.
    const half = await regEmployee();
    await assign(half.id, GENERAL.id);
    await recordPunch({ employeeId: half.id, at: cairoInstant(workday, '09:40').toISOString() });
    await recompute(half.id, workday);
    const halfRes = await get(`hr/attendance/export?${range}&employeeId=${half.id}`, adminToken);
    const halfRow = (halfRes.text.split('\r\n').find((line) => line.includes(half.code)) ?? '')
      .split('","')
      .map((cell) => cell.replace(/^"|"$/g, ''));
    expect(halfRow[6]).toBe('Checked in only');
    expect(halfRow[7]).toBe('9:40 am');
    expect(halfRow[8]).toBe('');
    // Worked, late, shortfall, early leave and overtime: all five blank, none of them zero.
    expect(halfRow.slice(9, 10)).toEqual(['']);
    expect(halfRow.slice(11, 16)).toEqual(['', '', '', '', '']);
    expect(halfRow[19]).toContain('Check-out missing');
    // One press of Check-in, none of Check-out — which is why every figure above is blank.
    expect(halfRow[17]).toBe('1');
    expect(halfRow[18]).toBe('0');

    // The window is capped like recompute: an export is a report, not a dump. 92 days for the
    // sheet, a year for one employee.
    expect((await get('hr/attendance/export?from=2024-01-01&to=2025-01-01', adminToken)).status).toBe(400);
    expect(
      (await get(`hr/attendance/export?from=2026-01-01&to=2026-06-01&employeeId=${emp.id}`, adminToken))
        .status,
    ).toBe(200);

    // The export audits ITSELF — once the download has ended (`streamAttendanceExport`: the audit
    // never holds up the file), so on a busy machine the next request can be answered before that
    // row lands. Asked again until it has.
    await expect
      .poll(
        async () => {
          const audit = await get(
            'platform/audit-logs?entityType=attendanceDay&action=export',
            adminToken,
          );
          expect(audit.status).toBe(200);
          return (audit.body.data as { action: string }[]).length;
        },
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);
  });
});

// ── AT-7 — the two morning sweeps: notices that repeat safely and escalate nothing ───────────
describe('AT-7 — absence and missing-checkout sweeps', () => {
  /**
   * YESTERDAY IS MADE A WORKING DAY FOR THIS BLOCK, and that is the whole of this setup.
   *
   * The sweeps read ONE date and only one: `previousDayRows` in the service is
   * `addDays(cairoToday(), -1)`. That is the behaviour under test, so these cases cannot move to
   * some other day — they must use yesterday, whatever weekday CI happens to run on.
   *
   * But the derivation turns yesterday into `weekend` whenever `isoWeekday` is in the calendar's
   * weekend set, and the seeded set is Fri+Sat. So a run on a Saturday or a Sunday derived
   * `weekend` where the case expects `incomplete` or `absent` — a green suite on a Thursday and a
   * red one on a Sunday, from the same commit. That is exactly what happened on `main`.
   *
   * The fix is to control the calendar rather than the date: drop yesterday's weekday from the
   * weekend set for this block, and put it back afterwards. Nothing in production changes — the
   * weekend set is an organization setting that the calendar reads, and this block already sets
   * another setting the same way.
   */
  const DEFAULT_WEEKEND_DAYS = [5, 6];

  /**
   * The two dates a sweep in this block can possibly read.
   *
   * `beforeAll` prepares the calendar for one date and the cases derive another, and between them
   * the Cairo day can roll over — a suite that starts at 23:59 prepares Monday and asserts on
   * Tuesday. That is not hypothetical: a run that began at 23:59:39 Cairo prepared Monday, and the
   * cases six minutes later derived Tuesday 2026-08-25 — المولد النبوي الشريف in the seeded
   * calendar — and `holiday` beats every status these cases assert. Preparing BOTH candidates
   * costs nothing and closes the window, because a rollover can only ever move yesterday forward
   * by one day.
   */
  const sweepCandidates = (): Date[] => [addDays(cairoToday(), -1), cairoToday()];
  const settingCtx = (): AuthContext => ({
    // `settingsService.set` stamps `updatedBy`, so this has to be a real ObjectId.
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
  const setWeekendDays = async (days: number[]): Promise<void> => {
    await settingsService.set(settingCtx(), {
      key: HrLeaveSettingKeys.WeekendDays,
      scope: 'organization',
      value: days,
    });
  };

  /** Seeded public holidays lifted off the candidate dates, put back when the block is done. */
  let parkedHolidays: HolidayDoc[] = [];

  beforeAll(async () => {
    const candidates = sweepCandidates();
    const weekdays = new Set(candidates.map(isoWeekday));
    await setWeekendDays(DEFAULT_WEEKEND_DAYS.filter((day) => !weekdays.has(day)));
    // The weekend set was already handled here; a public holiday on the same date was not, and it
    // outranks weekend, dayOff and absent alike in the derivation.
    parkedHolidays = await HolidayModel.find({ date: { $in: candidates } }).lean<HolidayDoc[]>();
    await HolidayModel.deleteMany({ date: { $in: candidates } });
  }, 60_000);

  // Restored so the earlier case that asserts a Friday derives as `weekend` keeps its calendar,
  // whatever order a future refactor puts these blocks in.
  afterAll(async () => {
    await setWeekendDays(DEFAULT_WEEKEND_DAYS);
    if (parkedHolidays.length > 0) await HolidayModel.insertMany(parkedHolidays);
  }, 60_000);

  /** Notices sent to one employee's login, by template key. */
  const noticesFor = async (userId: string, template: string): Promise<number> =>
    NotificationModel.countDocuments({
      recipientUserId: new Types.ObjectId(userId),
      templateKey: template,
    }).exec();

  /** An employee with a login, a shift, and yesterday derived into the status we want. */
  const employeeWithYesterday = async (
    punches: string[],
  ): Promise<{ emp: EmployeeDto; userId: string; workDate: Date }> => {
    const emp = await regEmployee();
    await assign(emp.id, GENERAL.id);
    const reread = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const userId = String((reread.body.data as EmployeeDto).userId);

    const workDate = addDays(cairoToday(), -1);
    for (const at of punches) {
      await recordPunch({ employeeId: emp.id, at: cairoInstant(workDate, at).toISOString() });
    }
    await recompute(emp.id, workDate);
    return { emp, userId, workDate };
  };

  /**
   * THE SWEEP SAYS NOTHING ABOUT A CHECK-IN-ONLY DAY, and that is the point of this test.
   *
   * It queries yesterday's `incomplete` rows, and nothing derives `incomplete` any more: a single
   * punch is `checkedIn`. So the sweep is inert from the day after this change — deliberately.
   * Most of this workforce never scans out, so pointing this notice at `checkedIn` would tell
   * 70–90% of employees every single morning that they had forgotten to do something nobody here
   * does, and a notice that arrives for almost everybody every day is not read by anybody.
   *
   * The test is written as the guarantee rather than as the absence of one, so that re-aiming the
   * sweep at `checkedIn` fails here and has to be argued for.
   */
  it('says NOTHING about a check-in-only day — that is the normal day here, not a fault', async () => {
    const { emp, userId, workDate } = await employeeWithYesterday(['09:00']);
    expect((await dayRow(emp.id, workDate)).status).toBe('checkedIn');

    const notified = await attendanceSweepService.sweepMissingCheckouts();
    expect(notified).toBe(0);
    expect(await noticesFor(userId, HrAttendanceTemplates.MissingCheckout)).toBe(0);
  });

  it('still notifies once for a legacy incomplete row, however many times it runs', async () => {
    // A row derived before the ruling above. The sweep may still meet one on the first day after
    // the deploy, so its idempotency is still a promise worth holding.
    const { emp, userId, workDate } = await employeeWithYesterday(['09:00']);
    await AttendanceDayModel.updateOne(
      { employeeId: new Types.ObjectId(emp.id), workDate },
      { $set: { status: 'incomplete' } },
    ).exec();

    const first = await attendanceSweepService.sweepMissingCheckouts();
    expect(first).toBeGreaterThan(0);
    expect(await noticesFor(userId, HrAttendanceTemplates.MissingCheckout)).toBe(1);

    // The idempotency claim: run it again, and again — still exactly one notice.
    await attendanceSweepService.sweepMissingCheckouts();
    await attendanceSweepService.sweepMissingCheckouts();
    expect(await noticesFor(userId, HrAttendanceTemplates.MissingCheckout)).toBe(1);
  });

  it('notifies a recorded absence once, and says nothing about consequences', async () => {
    const { emp, userId, workDate } = await employeeWithYesterday([]);
    expect((await dayRow(emp.id, workDate)).status).toBe('absent');

    await attendanceSweepService.sweepAbsenceNotices();
    await attendanceSweepService.sweepAbsenceNotices();
    expect(await noticesFor(userId, HrAttendanceTemplates.AbsenceRecorded)).toBe(1);

    // The notice states the fact and the remedy — nothing about a penalty, a warning or a count.
    const notice = await NotificationModel.findOne({
      recipientUserId: new Types.ObjectId(userId),
      templateKey: HrAttendanceTemplates.AbsenceRecorded,
    })
      .lean<{ body: { ar: string; en: string }; data: Record<string, string> }>()
      .exec();
    expect(notice?.data.workDate).toBe(dateOnlyIso(workDate));
    expect(`${notice?.body.ar ?? ''} ${notice?.body.en ?? ''}`).not.toMatch(
      /warning|penalt|deduct|discipl|إنذار|خصم|جزاء/i,
    );
  });

  it('records NOTHING on the day itself — a sweep notifies, it never escalates', async () => {
    const { emp, workDate } = await employeeWithYesterday([]);
    const before = await dayRow(emp.id, workDate);
    await attendanceSweepService.sweepAbsenceNotices();
    await attendanceSweepService.sweepMissingCheckouts();
    const after = await dayRow(emp.id, workDate);
    // Byte-identical: no flag, no counter, no status change, not even a new computedAt.
    expect(after).toEqual(before);
  });

  it('sends no absence notice while hr.attendance.absenceNotify is off', async () => {
    const ctx: AuthContext = {
      // `settingsService.set` stamps `updatedBy`, so this has to be a real ObjectId.
      userId: new Types.ObjectId().toString(),
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
      key: HrAttendanceSettingKeys.AbsenceNotify,
      scope: 'organization',
      value: false,
    });
    const { userId } = await employeeWithYesterday([]);
    expect(await attendanceSweepService.sweepAbsenceNotices()).toBe(0);
    expect(await noticesFor(userId, HrAttendanceTemplates.AbsenceRecorded)).toBe(0);

    // Back on, and the same day now notifies — the switch silences the notice, not the record.
    await settingsService.set(ctx, {
      key: HrAttendanceSettingKeys.AbsenceNotify,
      scope: 'organization',
      value: true,
    });
    await attendanceSweepService.sweepAbsenceNotices();
    expect(await noticesFor(userId, HrAttendanceTemplates.AbsenceRecorded)).toBe(1);
  });

  it('leaves a frozen day alone — its correction can no longer land', async () => {
    const { emp, userId } = await employeeWithYesterday([]);
    const workDate = addDays(cairoToday(), -1);
    await AttendanceDayModel.updateOne(
      { employeeId: new Types.ObjectId(emp.id), workDate },
      { $set: { frozenAt: new Date() } },
    ).exec();

    await attendanceSweepService.sweepAbsenceNotices();
    expect(await noticesFor(userId, HrAttendanceTemplates.AbsenceRecorded)).toBe(0);
  });
});
