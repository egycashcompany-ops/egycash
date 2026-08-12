// Attendance AT-1..3 integration suite (frozen design v1.1). Exercises the shifts catalog and
// its coherence rules, dated assignments with the one-open-interval guard, immutable punches
// (record / supersede / idempotent device import with quarantine), and the §4 derivation engine
// over HTTP: absent / present / late / weekend / incomplete, the own-scope /days/me read, the
// freeze guard refusing recomputation, and authorization on every surface.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  ATTENDANCE_FEED_FIELDS,
  AttendanceFeedRowSchema,
  type AttendanceDayDto,
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
import { addDays, cairoToday, dateOnlyIso, isoWeekday } from '../../src/modules/hr/shared/business-date';
import { cairoInstant, dayRecordService, AttendanceDayModel } from '../../src/modules/hr/attendance';
import { type AttendanceRegularizationDto } from '@ecms/contracts';
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
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const nextPhone = (): string => `011${String(phoneCounter++).padStart(8, '0')}`;
const nextNid = (): string => `290010101${String(100 + nidCounter++)}10`;

const regEmployee = async (): Promise<EmployeeDto> => {
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
        departmentId: DEPARTMENT_ID,
        branchId: BRANCH_ID,
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

    // One punch → incomplete (D6), never a guessed day.
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:05').toISOString() });
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('incomplete');

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

// ── AT-4 — the freeze + the §15.1 feed seam (D-PR-07 Option A) ──────────────
//
// `freezePeriod` and `readFrozenFeed` are INTERNAL: no route mounts them, so the suite calls the
// service directly — exactly what the Payroll Run will do in P-HR-09. Everything runs against
// the PREVIOUS Cairo month (the freeze refuses a period still being lived), which stays inside
// the 90-day punch sanity window.
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
  });

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

    // An incomplete day: one punch, no checkout (the D6 headline case).
    await recordPunch({ employeeId: emp.id, at: cairoInstant(workday, '09:05').toISOString() });
    await recompute(emp.id, workday);
    expect((await dayRow(emp.id, workday)).status).toBe('incomplete');

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
    expect(day.flags).toContain('manualPunch');
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
  });
});
