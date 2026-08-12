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
import { cairoInstant, AttendanceDayModel } from '../../src/modules/hr/attendance';
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
