// Leave Management integration suite (frozen design docs/12-planning/leave-management-design.md).
// Employees enter via Direct Registration (D4) with back-dated hire dates so entitlement
// steps are deterministic year-round. Exercises: seeded catalog + calendar, hire-time
// pro-rated grants, the eligibility preflight, the request lifecycle (self-service submit →
// relationship-based manager approval → HR override), the atomic reservation gate + release
// on reject/cancel, casual-deducts-annual accounting (R11), the sick certificate gate +
// tiered paidBreakdown on backdated completion (R4/R7), soft-vs-hard rules (L8), the
// own scope (C1-R), status-affecting unpaid leave driving onLeave and back (R5/§1.2),
// holiday-aware day counting, and exit settlement (R12).
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type EmployeeDto,
  type LeaveBalanceDto,
  type LeaveEligibilityDto,
  type LeaveLedgerEntryDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
  type WorkCalendarDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let BRANCH_ID = '';
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';
let TYPES: LeaveTypeDto[] = [];
let phoneCounter = 70_000_000;
let nidCounter = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-hr-leave-test-${Date.now()}`;
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

const login = async (email: string): Promise<string> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.body as { data: { accessToken: string } }).data.accessToken;
};

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

/** Structurally-valid Egyptian NID; the serial's last digit encodes gender (odd = male). */
const nextNid = (male: boolean): string => {
  const serial3 = String(100 + nidCounter++);
  return `290010101${serial3}${male ? '1' : '2'}0`;
};

const dayOffsetIso = (n: number): string =>
  new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** In-process event handlers (grant-on-hire) are fire-and-forget — let them land. */
const settle = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200));

const typeId = (code: string): string => {
  const t = TYPES.find((x) => x.code === code);
  expect(t).toBeDefined();
  return (t as LeaveTypeDto).id;
};

/** Direct-register an employee hired well in the past (entitlement steps deterministic). */
const regEmployee = async (over: Record<string, unknown> = {}, male = true): Promise<EmployeeDto> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      personal: {
        identity: { fullNameAr: 'موظف الإجازات', nationalId: nextNid(male), nationality: 'Egyptian' },
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
        probationMonths: 3,
        startDate: '2024-01-01T00:00:00.000Z',
        ...over,
      },
    });
  expect(res.status).toBe(201);
  await settle();
  return res.body.data as EmployeeDto;
};

/** Give an employee an ACTIVATED login + the own-scoped self-service grants (L7). */
const activateEssLogin = async (emp: EmployeeDto, essRoleId: string): Promise<{ userId: string; token: string }> => {
  const email = `leave-${emp.code}@ecms.local`;
  const loginRes = await request(app)
    .post(`/api/v1/hr/employees/${emp.id}/login`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email, firstName: { ar: 'م', en: 'E' }, lastName: { ar: 'م', en: 'E' } });
  expect(loginRes.status).toBe(201);
  const account = loginRes.body.data as { user: { id: string }; activationToken: string };
  const activated = await request(app)
    .post('/api/v1/auth/activate')
    .send({ token: account.activationToken, password: PASSWORD });
  expect(activated.status).toBe(204);
  await rbacService.ensureAssignment(account.user.id, essRoleId, 'own');
  return { userId: account.user.id, token: await login(email) };
};

const balances = async (employeeId: string, year?: number): Promise<LeaveBalanceDto[]> => {
  const res = await request(app)
    .get(`/api/v1/hr/employees/${employeeId}/leave-balances${year === undefined ? '' : `?year=${String(year)}`}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body.data as LeaveBalanceDto[];
};

const annualBalance = async (employeeId: string, year?: number): Promise<LeaveBalanceDto> => {
  const rows = await balances(employeeId, year);
  const row = rows.find((b) => b.typeCode === 'ANNUAL');
  expect(row).toBeDefined();
  return row as LeaveBalanceDto;
};

const eligibility = async (
  employeeId: string,
  params: Record<string, string>,
  token = adminToken,
): Promise<LeaveEligibilityDto> => {
  const qs = new URLSearchParams(params).toString();
  const res = await request(app)
    .get(`/api/v1/hr/employees/${employeeId}/leave-eligibility?${qs}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data as LeaveEligibilityDto;
};

const submit = (body: Record<string, unknown>, token = adminToken) =>
  request(app).post('/api/v1/hr/leave-requests').set('Authorization', `Bearer ${token}`).send(body);

const decide = (id: string, verdict: 'approve' | 'reject', version: number, token: string) =>
  request(app)
    .post(`/api/v1/hr/leave-requests/${id}/${verdict}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ version });

const rereadRequest = async (id: string): Promise<LeaveRequestDto> => {
  const res = await request(app)
    .get(`/api/v1/hr/leave-requests/${id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res.body.data as LeaveRequestDto;
};

const rereadEmployee = async (id: string): Promise<EmployeeDto> =>
  (await request(app).get(`/api/v1/hr/employees/${id}`).set('Authorization', `Bearer ${adminToken}`)).body
    .data as EmployeeDto;

/** Year-boundary guard: give the NEXT leave-year some annual headroom so spans that spill past
 *  Dec 31 (when CI runs late in the year) can still reserve their split portions. */
const grantNextYearHeadroom = async (employeeId: string): Promise<void> => {
  const res = await request(app)
    .post(`/api/v1/hr/employees/${employeeId}/leave-balances/adjust`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      typeId: typeId('ANNUAL'),
      year: new Date().getUTCFullYear() + 1,
      days: 15,
      reason: 'test headroom across the year boundary',
    });
  expect(res.status).toBe(200);
};

let ESS_ROLE_ID = '';
let manager: EmployeeDto;
let managerAuth: { userId: string; token: string };

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
  await settingsService.set(ctx, { key: SettingKeys.TotpEnforcedForPrivileged, scope: 'organization', value: false });
  adminToken = await login('admin@ecms.local');

  const branchRes = await request(app)
    .post('/api/v1/platform/branches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: '001', name: { ar: 'المركز', en: 'HQ' } });
  expect(branchRes.status).toBe(201);
  BRANCH_ID = (branchRes.body as { data: { id: string } }).data.id;
  const depRes = await request(app)
    .post('/api/v1/platform/departments')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'DEP-LV-1', name: { ar: 'إدارة', en: 'Ops' }, branchId: BRANCH_ID });
  expect(depRes.status).toBe(201);
  DEPARTMENT_ID = (depRes.body as { data: { id: string } }).data.id;
  const titleRes = await request(app)
    .post('/api/v1/platform/job-titles')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ code: 'JT-LV-1', name: { ar: 'أخصائي', en: 'Specialist' }, jobGrade: 'G5' });
  expect(titleRes.status).toBe(201);
  JOB_TITLE_ID = (titleRes.body as { data: { id: string } }).data.id;

  const typesRes = await request(app)
    .get('/api/v1/hr/leave-types')
    .set('Authorization', `Bearer ${adminToken}`);
  expect(typesRes.status).toBe(200);
  TYPES = typesRes.body.data as LeaveTypeDto[];

  // The self-service role: own-scoped view + request (mirrors the seeded ESS role, L7).
  const essRole = await rbacService.createRole(
    { name: { en: 'ESS test', ar: 'خدمة ذاتية' }, permissionKeys: ['leave.view', 'leave.request'] },
    adminId,
  );
  ESS_ROLE_ID = String(essRole._id);

  manager = await regEmployee();
  managerAuth = await activateEssLogin(manager, ESS_ROLE_ID);
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('seeded catalog + work calendar (§2/§5, L4)', () => {
  it('seeds the six Egyptian-law defaults as editable configuration', () => {
    const codes = TYPES.map((t) => t.code);
    for (const code of ['ANNUAL', 'CASUAL', 'SICK', 'MATERNITY', 'HAJJ', 'UNPAID']) {
      expect(codes).toContain(code);
    }
    const casual = TYPES.find((t) => t.code === 'CASUAL');
    expect(casual?.balanceSource).toBe('otherType');
    expect(casual?.balanceTypeId).toBe(typeId('ANNUAL'));
    const sick = TYPES.find((t) => t.code === 'SICK');
    expect(sick?.payModel).toBe('tiered');
    expect(sick?.requiresAttachment).toBe(true);
  });

  it('serves the merged work calendar (Fri+Sat weekend + seeded holidays)', async () => {
    const year = new Date().getUTCFullYear();
    const res = await request(app)
      .get(`/api/v1/hr/work-calendar?from=${String(year)}-01-01&to=${String(year)}-12-31`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const cal = res.body.data as WorkCalendarDto;
    expect(cal.weekendDays).toEqual([5, 6]);
  });
});

describe('grants (§4, L3) + eligibility preflight', () => {
  it('grants the current year pro-rata at hire time (service ≥ 1y → 21 days)', async () => {
    const bal = await annualBalance(manager.id);
    expect(bal.granted).toBe(21);
    expect(bal.available).toBe(21);
  });

  it('previews days, balance-after and violations without writing', async () => {
    const res = await eligibility(manager.id, {
      typeId: typeId('ANNUAL'),
      start: dayOffsetIso(14),
      end: dayOffsetIso(20),
    });
    // A 7-calendar-day span holds at most 5 workdays (Fri+Sat excluded; holidays may trim more).
    expect(res.days).toBeGreaterThan(0);
    expect(res.days).toBeLessThanOrEqual(5);
    expect(res.available).toBe(21);
    expect(res.balanceAfter).toBe(21 - res.days);
    expect(res.violations).toEqual([]);
  });

  it('counts a freshly-added holiday out of the span (workdays mode)', async () => {
    // Find a non-weekend day inside a far-future window and declare it a holiday.
    let probe = 60;
    while ([5, 6].includes(((new Date(Date.now() + probe * 86_400_000).getUTCDay() + 6) % 7) + 1)) {
      probe += 1;
    }
    const day = dayOffsetIso(probe);
    const before = await eligibility(manager.id, { typeId: typeId('ANNUAL'), start: day, end: day });
    expect(before.days).toBe(1);
    const created = await request(app)
      .post('/api/v1/hr/holidays')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: day, name: { ar: 'عطلة اختبار', en: 'Test holiday' } });
    expect(created.status).toBe(201);
    const after = await eligibility(manager.id, { typeId: typeId('ANNUAL'), start: day, end: day });
    expect(after.days).toBe(0);
    await request(app)
      .delete(`/api/v1/hr/holidays/${(created.body as { data: { id: string } }).data.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });
});

describe('request lifecycle — self-service + relationship approvals (§3, R9, C1-R)', () => {
  let emp: EmployeeDto;
  let ess: { userId: string; token: string };

  beforeAll(async () => {
    emp = await regEmployee({ managerId: managerAuth.userId });
    ess = await activateEssLogin(emp, ESS_ROLE_ID);
    await grantNextYearHeadroom(emp.id);
  });

  it('walks submit → pendingManager → manager approves by RELATIONSHIP (no leave permission)', async () => {
    const probe = await eligibility(emp.id, {
      typeId: typeId('ANNUAL'),
      start: dayOffsetIso(14),
      end: dayOffsetIso(15),
    }, ess.token);
    const res = await submit(
      { typeId: typeId('ANNUAL'), startDate: dayOffsetIso(14), endDate: dayOffsetIso(15) },
      ess.token,
    );
    expect(res.status).toBe(201);
    const created = res.body.data as LeaveRequestDto;
    expect(created.status).toBe('pendingManager');
    expect(created.days).toBe(probe.days);

    // The reservation went through the atomic gate (R1).
    const reserved = await annualBalance(emp.id);
    expect(reserved.reserved).toBe(created.days);

    // The manager holds NO leave permission — the relationship authorizes the step (R9).
    const inbox = await request(app)
      .get('/api/v1/hr/leave-requests/pending-approvals')
      .set('Authorization', `Bearer ${managerAuth.token}`);
    expect(inbox.status).toBe(200);
    expect((inbox.body.data as LeaveRequestDto[]).map((r) => r.id)).toContain(created.id);

    const approved = await decide(created.id, 'approve', created.version, managerAuth.token);
    expect(approved.status).toBe(200);
    expect((approved.body.data as LeaveRequestDto).status).toBe('approved');
    // Reservation stays until the leave completes.
    expect((await annualBalance(emp.id)).reserved).toBe(created.days);
  });

  it('rejects overlapping submissions (R2)', async () => {
    const res = await submit(
      { typeId: typeId('ANNUAL'), startDate: dayOffsetIso(14), endDate: dayOffsetIso(16) },
      ess.token,
    );
    expect(res.status).toBe(422);
  });

  it('blocks the subject from deciding their own request (C7)', async () => {
    const res = await submit(
      { typeId: typeId('ANNUAL'), startDate: dayOffsetIso(30), endDate: dayOffsetIso(31) },
      ess.token,
    );
    expect(res.status).toBe(201);
    const created = res.body.data as LeaveRequestDto;
    const own = await decide(created.id, 'approve', created.version, ess.token);
    expect(own.status).toBe(403);
    // HR override decides any pending step (deadlock prevention).
    const hr = await decide(created.id, 'reject', created.version, adminToken);
    expect(hr.status).toBe(200);
  });

  it('releases the reservation on rejection (§4)', async () => {
    const before = await annualBalance(emp.id);
    const res = await submit(
      { typeId: typeId('ANNUAL'), startDate: dayOffsetIso(40), endDate: dayOffsetIso(41) },
      ess.token,
    );
    expect(res.status).toBe(201);
    const created = res.body.data as LeaveRequestDto;
    expect((await annualBalance(emp.id)).reserved).toBeGreaterThan(before.reserved);
    const rejected = await decide(created.id, 'reject', created.version, managerAuth.token);
    expect(rejected.status).toBe(200);
    expect((await annualBalance(emp.id)).reserved).toBe(before.reserved);
  });

  it('lets the requester cancel a pending request, releasing days', async () => {
    const before = await annualBalance(emp.id);
    const res = await submit(
      { typeId: typeId('ANNUAL'), startDate: dayOffsetIso(50), endDate: dayOffsetIso(51) },
      ess.token,
    );
    expect(res.status).toBe(201);
    const created = res.body.data as LeaveRequestDto;
    const cancelled = await request(app)
      .post(`/api/v1/hr/leave-requests/${created.id}/cancel`)
      .set('Authorization', `Bearer ${ess.token}`)
      .send({ version: created.version });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body.data as LeaveRequestDto).status).toBe('cancelled');
    expect((await annualBalance(emp.id)).reserved).toBe(before.reserved);
  });

  it('scopes self-service reads to OWN requests and balances (C1-R)', async () => {
    const mine = await request(app)
      .get('/api/v1/hr/leave-requests')
      .set('Authorization', `Bearer ${ess.token}`);
    expect(mine.status).toBe(200);
    const rows = (mine.body.data as LeaveRequestDto[]) ?? [];
    for (const row of rows) expect(row.employeeId).toBe(emp.id);
    // Another employee's balances are invisible to the own scope.
    const foreign = await request(app)
      .get(`/api/v1/hr/employees/${manager.id}/leave-balances`)
      .set('Authorization', `Bearer ${ess.token}`);
    expect(foreign.status).toBe(404);
  });

  it('blocks an over-balance request through the atomic gate (L5)', async () => {
    const res = await submit(
      { typeId: typeId('ANNUAL'), startDate: dayOffsetIso(60), endDate: dayOffsetIso(200), employeeId: emp.id },
      adminToken,
    );
    expect(res.status).toBe(422);
  });
});

describe('policy rules — casual/annual accounting, soft overrides, gender (R11, L8)', () => {
  let emp: EmployeeDto;
  let ess: { userId: string; token: string };

  beforeAll(async () => {
    emp = await regEmployee({ managerId: managerAuth.userId });
    ess = await activateEssLogin(emp, ESS_ROLE_ID);
    await grantNextYearHeadroom(emp.id);
  });

  it('deducts casual leave from the ANNUAL balance (R11) and enforces per-occasion softly (L8)', async () => {
    // Grow the span until it holds MORE than 2 countable days, whatever the weekend/holiday
    // alignment — that makes maxPerOccasion (2) bite deterministically.
    const start = dayOffsetIso(7);
    let endOffset = 9;
    let days = 0;
    while (days <= 2 && endOffset <= 16) {
      const probe = await eligibility(emp.id, {
        typeId: typeId('CASUAL'),
        start,
        end: dayOffsetIso(endOffset),
      });
      days = probe.days;
      if (days <= 2) endOffset += 1;
    }
    expect(days).toBeGreaterThan(2);
    const end = dayOffsetIso(endOffset);

    // Over-per-occasion is SOFT (L8): blocks self-service…
    const selfOver = await submit({ typeId: typeId('CASUAL'), startDate: start, endDate: end }, ess.token);
    expect(selfOver.status).toBe(422);
    // …but HR on-behalf overrides soft rules (never hard ones).
    const hrOver = await submit(
      { typeId: typeId('CASUAL'), startDate: start, endDate: end, employeeId: emp.id },
      adminToken,
    );
    expect(hrOver.status).toBe(201);
    const created = hrOver.body.data as LeaveRequestDto;
    // R11 — the casual request reserves against the ANNUAL balance (whichever leave-year the
    // span falls into).
    const year = new Date().getUTCFullYear();
    const thisYear = await annualBalance(emp.id, year);
    const nextYear = (await balances(emp.id, year + 1)).find((b) => b.typeCode === 'ANNUAL');
    expect(thisYear.reserved + (nextYear?.reserved ?? 0)).toBeGreaterThan(0);
    expect(created.days).toBeGreaterThan(2);
  });

  it('enforces the gender restriction from the personal snapshot', async () => {
    const res = await submit(
      { typeId: typeId('MATERNITY'), startDate: dayOffsetIso(30), endDate: dayOffsetIso(45), employeeId: emp.id },
      adminToken,
    );
    expect(res.status).toBe(422);
  });
});

describe('sick leave — certificate gate + tiered pay on backdated completion (R4/R7)', () => {
  it('refuses approval without an attachment, then completes a fully-past span with 75% tiers', async () => {
    const emp = await regEmployee({ managerId: managerAuth.userId });
    const ess = await activateEssLogin(emp, ESS_ROLE_ID);
    const res = await submit(
      { typeId: typeId('SICK'), startDate: dayOffsetIso(-2), endDate: dayOffsetIso(-1) },
      ess.token,
    );
    expect(res.status).toBe(201);
    const created = res.body.data as LeaveRequestDto;

    const blocked = await decide(created.id, 'approve', created.version, managerAuth.token);
    expect(blocked.status).toBe(422);

    const attached = await request(app)
      .post(`/api/v1/hr/leave-requests/${created.id}/attachments`)
      .set('Authorization', `Bearer ${ess.token}`)
      .attach('file', Buffer.from('%PDF-1.4 certificate'), 'certificate.pdf');
    expect(attached.status).toBe(200);

    const approved = await decide(
      created.id,
      'approve',
      (attached.body.data as LeaveRequestDto).version,
      managerAuth.token,
    );
    expect(approved.status).toBe(200);
    // R4 — the span is fully past: catch-up transitions straight through to completed.
    const final = await rereadRequest(created.id);
    expect(final.status).toBe('completed');

    const ledger = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}/leave-ledger?typeId=${typeId('SICK')}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ledger.status).toBe(200);
    const entries = ledger.body.data as LeaveLedgerEntryDto[];
    const consume = entries.filter((e) => e.kind === 'consume');
    expect(consume.length).toBeGreaterThan(0);
    for (const entry of consume) {
      expect(entry.paidBreakdown[0]?.payRate).toBe(75);
    }
  });
});

describe('status-affecting leave (L2/R5) + exit settlement (R12)', () => {
  it('drives the employee to onLeave for long unpaid leave and back on early return', async () => {
    const emp = await regEmployee({ managerId: managerAuth.userId });
    const ess = await activateEssLogin(emp, ESS_ROLE_ID);
    // 20 calendar days from today — over the 14-day unpaid threshold (managerThenHr chain).
    const res = await submit(
      { typeId: typeId('UNPAID'), startDate: dayOffsetIso(0), endDate: dayOffsetIso(19) },
      ess.token,
    );
    expect(res.status).toBe(201);
    let reqDto = res.body.data as LeaveRequestDto;

    const managerStep = await decide(reqDto.id, 'approve', reqDto.version, managerAuth.token);
    expect(managerStep.status).toBe(200);
    expect((managerStep.body.data as LeaveRequestDto).status).toBe('pendingHr');
    reqDto = managerStep.body.data as LeaveRequestDto;

    const hrStep = await decide(reqDto.id, 'approve', reqDto.version, adminToken);
    expect(hrStep.status).toBe(200);
    // Start = today → immediate activation (R4) + leaveStart drive (§1.2).
    const active = await rereadRequest(reqDto.id);
    expect(active.status).toBe('active');
    expect(active.statusDriveOutcome).toBe('applied');
    expect((await rereadEmployee(emp.id)).status).toBe('onLeave');

    // Early return tomorrow: completed + status projected back (base status).
    const returned = await request(app)
      .post(`/api/v1/hr/leave-requests/${active.id}/return`)
      .set('Authorization', `Bearer ${managerAuth.token}`)
      .send({ actualReturnDate: dayOffsetIso(1), version: active.version });
    expect(returned.status).toBe(200);
    expect((returned.body.data as LeaveRequestDto).status).toBe('completed');
    expect((await rereadEmployee(emp.id)).status).not.toBe('onLeave');
  });

  it('settles open leave and expires balances when the employee exits (R12)', async () => {
    const emp = await regEmployee({ managerId: managerAuth.userId });
    const ess = await activateEssLogin(emp, ESS_ROLE_ID);
    const res = await submit(
      { typeId: typeId('ANNUAL'), startDate: dayOffsetIso(30), endDate: dayOffsetIso(31) },
      ess.token,
    );
    expect(res.status).toBe(201);
    const created = res.body.data as LeaveRequestDto;

    const fresh = await rereadEmployee(emp.id);
    const exited = await request(app)
      .post(`/api/v1/hr/employees/${emp.id}/actions/exit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'resignation', eligibleForRehire: true, version: fresh.version });
    expect(exited.status).toBe(201);
    await settle();

    expect((await rereadRequest(created.id)).status).toBe('cancelled');
    const rows = await balances(emp.id);
    for (const row of rows) expect(row.available).toBe(0);
  });
});
