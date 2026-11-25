// The approvals engine against a real database (R12's baseline, PX-1.1 of
// docs/12-planning/administration-module-phase-px1.md §7; exit criteria 3 and 5): a chain written
// through `PUT /api/v1/platform/approvals`, and an HR leave request — the engine's only host —
// driven through it to approved and to rejected. PX-1.1's cases hold across the fixes; PX-1.2,
// PX-1.3, PX-1.4 and PX-1.6 add theirs here, and PX-1.5 keeps the audit case green.
//
// The leave suite's helpers are copied rather than shared, because exit criterion 5 keeps
// `hr-leave.spec.ts` unchanged. Nobody here holds `super-admin`: the boot sync hands that role every
// key, so its holder would stand on every organization rung and hold `approval.override`
// everywhere. The administrator holds every platform and HR key but those two, and each approver
// holds only the grant a case names.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  platformPermissions,
  SettingKeys,
  type ApprovalWorkflowDto,
  type EmployeeDto,
  type LeaveBalanceDto,
  type LeaveEligibilityDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import {
  APPROVAL_OVERRIDE_KEY,
  approvalService,
  type ChainStatus,
} from '../../src/platform/approvals';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { rbacService } from '../../src/platform/rbac';
import { roleAssignmentRepository } from '../../src/platform/rbac/rbac.repository';
import { LeaveRequestModel } from '../../src/modules/hr/leave-management/leave-requests/leave-request.model';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { addDays, cairoToday } from '../../src/modules/hr/shared/business-date';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let ADMIN_ID = '';
let BRANCH_ID = '';
/** The second branch, where nobody files: the place an override that misses the request reaches. */
let OTHER_BRANCH_ID = '';
let CATALOG_ID = '';
/** The branch's copy of the company department `CATALOG_ID`, where the requesters work. */
let DEPARTMENT_ID = '';
let JOB_TITLE_ID = '';
let ANNUAL_ID = '';
/** The role behind every `leave.approve` grant, for cases that empty a rung and fill it again. */
let APPROVER_ROLE_ID = '';
let phoneCounter = 71_000_000;
let nidCounter = 0;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-approvals-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (
  email: string,
  branchId: string | null = null,
  departmentId: string | null = null,
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: { branchId, departmentId, sectionId: null, jobTitleId: null },
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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const nextPhone = (): string => `010${String(phoneCounter++).padStart(8, '0')}`;

/** Structurally-valid Egyptian NID; the serial's last digit encodes gender (odd = male). */
const nextNid = (male: boolean): string => {
  const serial3 = String(100 + nidCounter++);
  return `290010101${serial3}${male ? '1' : '2'}0`;
};

// Offsets from the CAIRO business "today", which is what the leave engine validates against.
const dayOffsetIso = (n: number): string => addDays(cairoToday(), n).toISOString().slice(0, 10);

/** Direct-register an employee hired well in the past, in the department the chains are about. */
const regEmployee = async (): Promise<EmployeeDto> => {
  const res = await request(app)
    .post('/api/v1/hr/employees/direct')
    .set(auth(adminToken))
    .send({
      personal: {
        identity: {
          fullNameAr: 'موظف الاعتمادات',
          nationalId: nextNid(true),
          nationality: 'Egyptian',
        },
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
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
    });
  expect(res.status).toBe(201);
  const emp = res.body.data as EmployeeDto;
  // The grant-on-hire handler is fire-and-forget in-process: wait for the annual grant to land.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${emp.id}/leave-balances`)
      .set(auth(adminToken));
    const rows = res.body.data as LeaveBalanceDto[];
    if (rows.some((b) => b.typeCode === 'ANNUAL' && b.granted > 0)) return emp;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`hire-time grant never landed for ${emp.code}`);
};

/** A working self-service session for the employee's auto-provisioned account. */
const activateEssLogin = async (emp: EmployeeDto): Promise<{ userId: string; token: string }> => {
  const reread = await request(app).get(`/api/v1/hr/employees/${emp.id}`).set(auth(adminToken));
  const userId = (reread.body.data as EmployeeDto).userId;
  expect(userId).not.toBeNull();
  await userService.setPassword(String(userId), PASSWORD, 'passwordReset');
  await userService.forceActivate(String(userId));
  const full = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: emp.code, password: PASSWORD });
  expect(full.status).toBe(200);
  return { userId: String(userId), token: (full.body.data as { accessToken: string }).accessToken };
};

/** The first day from offset `from` that annual leave counts (fixed offsets land on weekends). */
const countableDay = async (employeeId: string, from: number): Promise<string> => {
  for (let off = from; off < from + 10; off += 1) {
    const day = dayOffsetIso(off);
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/leave-eligibility`)
      .query({ typeId: ANNUAL_ID, start: day, end: day })
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    if ((res.body.data as LeaveEligibilityDto).days > 0) return day;
  }
  throw new Error(`no countable day within 10 days of offset ${String(from)}`);
};

/** Next leave-year headroom, for a run late in the year whose spans spill past Dec 31. */
const grantNextYearHeadroom = async (employeeId: string): Promise<void> => {
  const res = await request(app)
    .post(`/api/v1/hr/employees/${employeeId}/leave-balances/adjust`)
    .set(auth(adminToken))
    .send({
      typeId: ANNUAL_ID,
      year: new Date().getUTCFullYear() + 1,
      days: 15,
      reason: 'test headroom across the year boundary',
    });
  expect(res.status).toBe(200);
};

const decide = (id: string, verdict: 'approve' | 'reject', version: number, token: string) =>
  request(app)
    .post(`/api/v1/hr/leave-requests/${id}/${verdict}`)
    .set(auth(token))
    .send({ version });

const readAs = async (id: string, token: string): Promise<LeaveRequestDto> => {
  const res = await request(app).get(`/api/v1/hr/leave-requests/${id}`).set(auth(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as LeaveRequestDto;
};

const audited = (filter: Record<string, unknown>) =>
  AuditLogModel.find(filter).sort({ at: 1, _id: 1 }).lean().exec();

interface Person {
  userId: string;
  token: string;
}

let emp: EmployeeDto;
let ess: Person;
/** Rung 0: `leave.approve` over the department's copy in this branch only — the `unit` level. */
let unitApprover: Person;
/** Rung 1: `leave.approve` company-wide — the `organization` level. */
let hrApprover: Person;
/** `leave.view` company-wide, and an organization-scope `approval.override` that ended yesterday. */
let lapsedOverride: Person;
/** `leave.view` company-wide, and `approval.override` at organization scope. */
let orgOverride: Person;
/** `leave.view` company-wide, and `approval.override` over the requesters' whole branch. */
let branchOverride: Person;
/** `leave.view` company-wide, and `approval.override` over the other branch only. */
let otherBranchOverride: Person;
/** Placed in the requesters' branch, holding nothing until a case grants it a `branch` rung. */
let branchApproverId = '';

/** One single-day annual leave, filed by the employee on the first countable day from `from`. */
const file = async (from: number): Promise<LeaveRequestDto> => {
  const day = await countableDay(emp.id, from);
  const res = await request(app)
    .post('/api/v1/hr/leave-requests')
    .set(auth(ess.token))
    .send({ typeId: ANNUAL_ID, startDate: day, endDate: day });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as LeaveRequestDto;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const adminId = await mkUser('admin@ecms.local');
  ADMIN_ID = adminId;
  const adminRole = await rbacService.createRole(
    {
      name: { ar: 'مسؤول مسارات الاعتماد', en: 'Approvals administrator' },
      permissionKeys: [...platformPermissions, ...hrPermissions]
        .map((p) => p.key)
        .filter((key) => key !== 'leave.approve' && key !== APPROVAL_OVERRIDE_KEY),
    },
    adminId,
  );
  await rbacService.ensureAssignment(adminId, String(adminRole._id), 'organization');
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

  const created = async (path: string, body: object): Promise<string> => {
    const res = await request(app)
      .post(`/api/v1/platform/${path}`)
      .set(auth(adminToken))
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  BRANCH_ID = await created('branches', { code: '001', name: { ar: 'المركز', en: 'HQ' } });
  OTHER_BRANCH_ID = await created('branches', {
    code: '002',
    name: { ar: 'أكتوبر', en: 'October' },
  });
  CATALOG_ID = await created('department-catalog', {
    code: 'DC-AP-1',
    name: { ar: 'العمليات', en: 'Operations' },
  });
  DEPARTMENT_ID = await created('departments', {
    code: 'DEP-AP-1',
    branchId: BRANCH_ID,
    catalogId: CATALOG_ID,
  });
  JOB_TITLE_ID = await created('job-titles', {
    code: 'JT-AP-1',
    name: { ar: 'أخصائي', en: 'Specialist' },
    jobGrade: 'G5',
  });
  const types = await request(app).get('/api/v1/hr/leave-types').set(auth(adminToken));
  ANNUAL_ID = (types.body.data as LeaveTypeDto[]).find((t) => t.code === 'ANNUAL')?.id ?? '';
  expect(ANNUAL_ID).not.toBe('');

  const roleOf = async (en: string, ar: string, key: string): Promise<string> =>
    String(
      (await rbacService.createRole({ name: { ar, en }, permissionKeys: [key] }, adminId))._id,
    );
  const approverRole = await roleOf('Leave approver', 'معتمد الإجازات', 'leave.approve');
  APPROVER_ROLE_ID = approverRole;
  const overrideRole = await roleOf(
    'Approval override',
    'تجاوز مسار الاعتماد',
    APPROVAL_OVERRIDE_KEY,
  );
  const viewerRole = await roleOf('Leave viewer', 'عرض الإجازات', 'leave.view');

  // `ensureAssignment` writes no placement, so the department grant, which needs one, is written
  // the way an administrator writes it; so is the expired grant, as `platform.spec.ts` writes one.
  const unitId = await mkUser('unit@ecms.local', BRANCH_ID, DEPARTMENT_ID);
  await rbacService.assignRole(
    { userId: unitId, roleId: approverRole, scope: 'department', departmentCatalogId: CATALOG_ID },
    adminId,
  );
  const hrId = await mkUser('hr@ecms.local');
  await rbacService.ensureAssignment(hrId, approverRole, 'organization');
  const lapsedId = await mkUser('lapsed@ecms.local');
  await rbacService.ensureAssignment(lapsedId, viewerRole, 'organization');
  await rbacService.assignRole(
    {
      userId: lapsedId,
      roleId: overrideRole,
      scope: 'organization',
      validFrom: new Date(Date.now() - 2 * 86_400_000),
      validTo: new Date(Date.now() - 86_400_000),
    },
    adminId,
  );
  unitApprover = { userId: unitId, token: await login('unit@ecms.local') };
  hrApprover = { userId: hrId, token: await login('hr@ecms.local') };
  lapsedOverride = { userId: lapsedId, token: await login('lapsed@ecms.local') };

  // The overrides PX-1.2 reads by reach. A branch grant reaches its holder's home branch, so each
  // is placed in the branch it is about, and written as an administrator writes it.
  const overrider = async (
    email: string,
    branchId: string | null,
    scope: 'organization' | 'branch',
  ): Promise<Person> => {
    const userId = await mkUser(email, branchId);
    await rbacService.ensureAssignment(userId, viewerRole, 'organization');
    await rbacService.assignRole({ userId, roleId: overrideRole, scope }, adminId);
    return { userId, token: await login(email) };
  };
  orgOverride = await overrider('override@ecms.local', null, 'organization');
  branchOverride = await overrider('override-branch@ecms.local', BRANCH_ID, 'branch');
  otherBranchOverride = await overrider('override-other@ecms.local', OTHER_BRANCH_ID, 'branch');
  branchApproverId = await mkUser('branch@ecms.local', BRANCH_ID);

  emp = await regEmployee();
  ess = await activateEssLogin(emp);
  await grantNextYearHeadroom(emp.id);
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
});

describe('a leave chain written through the API, and leave run on it (R12)', () => {
  const CHAIN = {
    requestType: 'hr.leave',
    departmentCatalogId: null,
    branchId: null,
    steps: [
      {
        permissionKey: 'leave.approve',
        level: 'unit',
        label: { ar: 'مدير الإدارة في الفرع', en: 'Unit manager' },
      },
      {
        permissionKey: 'leave.approve',
        level: 'organization',
        label: { ar: 'الموارد البشرية', en: 'Human resources' },
      },
    ],
    isActive: true,
  };

  it('PUT writes an hr.leave company default of two rungs, and GET lists it (exit criterion 3)', async () => {
    const put = await request(app)
      .put('/api/v1/platform/approvals')
      .set(auth(adminToken))
      .send(CHAIN);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const saved = put.body.data as ApprovalWorkflowDto;
    expect(saved).toMatchObject({
      requestType: 'hr.leave',
      department: null,
      branch: null,
      steps: CHAIN.steps,
    });

    const listed = await request(app).get('/api/v1/platform/approvals').set(auth(adminToken));
    expect(listed.status).toBe(200);
    expect(
      (listed.body.data as ApprovalWorkflowDto[]).filter((w) => w.requestType === 'hr.leave'),
    ).toEqual([saved]);
  });

  it('takes a request through pendingApproval to approved, each decision audited by leave and by the engine (R5’s leave baseline, exit criterion 5)', async () => {
    const created = await file(14);
    expect(created.status).toBe('pendingApproval');

    const first = await decide(created.id, 'approve', created.version, unitApprover.token);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const half = first.body.data as LeaveRequestDto;
    expect(half.status).toBe('pendingApproval');
    expect(half.approvalTrail?.steps.map((s) => s.outcome)).toEqual(['approved', 'pending']);
    expect(half.approvalTrail?.steps[0]?.decidedBy?.id).toBe(unitApprover.userId);
    expect(half.approvalTrail?.currentStep).toBe(1);

    const second = await decide(created.id, 'approve', half.version, hrApprover.token);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const done = second.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(done.approvalTrail?.steps.map((s) => s.outcome)).toEqual(['approved', 'approved']);
    expect(done.approvalTrail?.currentStep).toBeNull();

    // One `leaveDecision` row per decision, and the engine's own row from the same HTTP request,
    // which is all that ties `hr.leave:<rung>` to this request.
    const leaveRows = await audited({
      'entityRef.moduleId': 'hr',
      'entityRef.entityType': 'leaveRequest',
      'entityRef.entityId': created.id,
      action: 'leaveDecision',
    });
    expect(leaveRows.map((r) => r.changes.find((c) => c.field === 'status')?.new)).toEqual([
      'pendingApproval',
      'approved',
    ]);
    for (const [rung, leaveRow] of leaveRows.entries()) {
      expect(leaveRow.requestId).not.toBeNull();
      const engineRows = await audited({
        'entityRef.moduleId': 'platform',
        'entityRef.entityType': 'approval',
        requestId: leaveRow.requestId,
      });
      expect(engineRows.map((r) => r.entityRef.entityId)).toEqual([`hr.leave:${String(rung)}`]);
    }
  });

  it('rejects a second request at rung 0, and rung 1 reads unreached', async () => {
    const created = await file(21);
    const res = await decide(created.id, 'reject', created.version, unitApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rejected = res.body.data as LeaveRequestDto;
    expect(rejected.status).toBe('rejected');
    expect(rejected.approvalTrail?.steps.map((s) => s.outcome)).toEqual(['rejected', 'unreached']);
    expect(rejected.approvalTrail?.currentStep).toBeNull();
  });

  it('R4 guard: an organization-scope override that ended yesterday is offered nothing and refused approvals.notYourStep', async () => {
    // Passes before PX-1.2 too: an override is read from the actor's context, which holds grants
    // in force only, so the expired one reaches nothing either way.
    const created = await file(28);
    expect((await readAs(created.id, lapsedOverride.token)).approvalTrail).toMatchObject({
      currentStep: 0,
      viewerMayDecide: false,
      viewerMayOverride: false,
    });

    const res = await decide(created.id, 'approve', created.version, lapsedOverride.token);
    expect(res.status).toBe(422);
    expect((res.body as { error: { message: string } }).error.message).toBe(
      'approvals.notYourStep',
    );
    expect((await readAs(created.id, adminToken)).status).toBe('pendingApproval');
  });
});

describe('no staffed rung is an answer, and an override decides within its reach (PX-1.2: R2, R4)', () => {
  const UNIT_RUNG = {
    permissionKey: 'leave.approve',
    level: 'unit',
    label: { ar: 'مدير الإدارة في الفرع', en: 'Unit manager' },
  };
  const BRANCH_RUNG = {
    permissionKey: 'leave.approve',
    level: 'branch',
    label: { ar: 'مدير الفرع', en: 'Branch manager' },
  };
  const DEPARTMENT_RUNG = {
    permissionKey: 'leave.approve',
    level: 'department',
    label: { ar: 'مدير عام الإدارة', en: 'General department manager' },
  };
  const ORGANIZATION_RUNG = {
    permissionKey: 'leave.approve',
    level: 'organization',
    label: { ar: 'الموارد البشرية', en: 'Human resources' },
  };

  /** The company default, replaced: every request below files under it. */
  const writeChain = async (steps: object[]): Promise<void> => {
    const res = await request(app).put('/api/v1/platform/approvals').set(auth(adminToken)).send({
      requestType: 'hr.leave',
      departmentCatalogId: null,
      branchId: null,
      steps,
      isActive: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };

  /**
   * The engine's own answer for a request, read in-process: no DTO carries it. The Unit is the
   * one the requesters were placed in.
   */
  const chainStatus = async (id: string): Promise<ChainStatus> => {
    const row = await LeaveRequestModel.findById(id).lean().exec();
    expect(row).not.toBeNull();
    return approvalService.statusFor({
      requestType: 'hr.leave',
      unit: { branchId: BRANCH_ID, departmentCatalogId: CATALOG_ID, departmentId: DEPARTMENT_ID },
      decisions: (row?.approvalSteps ?? []).map((entry) => ({
        stepIndex: entry.stepIndex,
        outcome: entry.outcome,
        deciderUserId: entry.deciderUserId === null ? null : String(entry.deciderUserId),
        decidedAt: entry.decidedAt,
        comment: entry.comment,
        overriddenWith: entry.overriddenWith,
      })),
    });
  };

  const refusedWith = (res: request.Response, key: string): void => {
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect((res.body as { error: { message: string } }).error.message).toBe(key);
  };

  const outcomes = (dto: LeaveRequestDto) =>
    dto.approvalTrail?.steps.map((s) => [s.outcome, s.overriddenWith]);

  it('R2, R4: a request whose only rung nobody holds waits unstaffed; an override over the other branch is refused, an organization-scope one approves it', async () => {
    // Nobody holds `leave.approve` over a whole branch. Before PX-1.2 this request read approved
    // to the engine while leave kept it pending, and nobody could decide it.
    await writeChain([BRANCH_RUNG]);
    const created = await file(35);
    expect(created.status).toBe('pendingApproval');
    expect(await chainStatus(created.id)).toBe('unstaffed');

    expect((await readAs(created.id, otherBranchOverride.token)).approvalTrail).toMatchObject({
      currentStep: 0,
      viewerMayDecide: false,
      viewerMayOverride: false,
    });
    refusedWith(
      await decide(created.id, 'approve', created.version, otherBranchOverride.token),
      'approvals.notYourStep',
    );

    expect((await readAs(created.id, orgOverride.token)).approvalTrail).toMatchObject({
      currentStep: 0,
      viewerMayOverride: true,
    });
    const res = await decide(created.id, 'approve', created.version, orgOverride.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = res.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(outcomes(done)).toEqual([['approved', APPROVAL_OVERRIDE_KEY]]);
    expect(done.approvalTrail?.steps[0]?.decidedBy?.id).toBe(orgOverride.userId);
  });

  it('R2, R4: the unit holder’s approval leaves a request with nobody on its organization rung waiting unstaffed; an override over the branch is refused there, an organization-scope one approves it', async () => {
    // The HR approver is the organization rung's only holder; this case needs that rung empty,
    // and gives the grant back after it.
    const held = await roleAssignmentRepository.findActiveForUser(hrApprover.userId);
    for (const grant of held) await rbacService.revokeAssignment(String(grant._id), ADMIN_ID);
    try {
      await writeChain([UNIT_RUNG, ORGANIZATION_RUNG]);
      const created = await file(42);
      expect(await chainStatus(created.id)).toBe('pending');

      // Before PX-1.2 this approval closed the empty rung above it and approved the request.
      const first = await decide(created.id, 'approve', created.version, unitApprover.token);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const half = first.body.data as LeaveRequestDto;
      expect(half.status).toBe('pendingApproval');
      expect(outcomes(half)).toEqual([
        ['approved', null],
        ['pending', null],
      ]);
      expect(half.approvalTrail?.currentStep).toBe(1);
      expect(await chainStatus(created.id)).toBe('unstaffed');

      expect((await readAs(created.id, branchOverride.token)).approvalTrail).toMatchObject({
        currentStep: 1,
        viewerMayOverride: false,
      });
      refusedWith(
        await decide(created.id, 'approve', half.version, branchOverride.token),
        'approvals.notYourStep',
      );

      const res = await decide(created.id, 'approve', half.version, orgOverride.token);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const done = res.body.data as LeaveRequestDto;
      expect(done.status).toBe('approved');
      expect(outcomes(done)).toEqual([
        ['approved', null],
        ['approved', APPROVAL_OVERRIDE_KEY],
      ]);
    } finally {
      await rbacService.ensureAssignment(hrApprover.userId, APPROVER_ROLE_ID, 'organization');
    }
  });

  it('R4: on a staffed chain, an override over the request’s branch decides its branch rung and is refused on its organization rung', async () => {
    // Both rungs are staffed: the branch rung by an approver granted for this case, the
    // organization rung by HR. Before PX-1.2 the branch-wide override decided both.
    const grant = await rbacService.assignRole(
      { userId: branchApproverId, roleId: APPROVER_ROLE_ID, scope: 'branch' },
      ADMIN_ID,
    );
    try {
      await writeChain([BRANCH_RUNG, ORGANIZATION_RUNG]);
      const created = await file(49);
      expect((await readAs(created.id, branchOverride.token)).approvalTrail).toMatchObject({
        currentStep: 0,
        viewerMayDecide: false,
        viewerMayOverride: true,
      });
      const first = await decide(created.id, 'approve', created.version, branchOverride.token);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const half = first.body.data as LeaveRequestDto;
      expect(half.status).toBe('pendingApproval');
      expect(outcomes(half)).toEqual([
        ['approved', APPROVAL_OVERRIDE_KEY],
        ['pending', null],
      ]);

      expect((await readAs(created.id, branchOverride.token)).approvalTrail).toMatchObject({
        currentStep: 1,
        viewerMayOverride: false,
      });
      refusedWith(
        await decide(created.id, 'approve', half.version, branchOverride.token),
        'approvals.notYourStep',
      );
      const done = await decide(created.id, 'approve', half.version, hrApprover.token);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect((done.body.data as LeaveRequestDto).status).toBe('approved');
    } finally {
      await rbacService.revokeAssignment(String(grant._id), ADMIN_ID);
    }
  });

  it('leave’s trail offers no decision on a cancelled request, whether its waiting rung is staffed or it is unstaffed', async () => {
    const cancel = async (dto: LeaveRequestDto): Promise<void> => {
      const res = await request(app)
        .post(`/api/v1/hr/leave-requests/${dto.id}/cancel`)
        .set(auth(ess.token))
        .send({ version: dto.version });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((res.body.data as LeaveRequestDto).status).toBe('cancelled');
    };

    // Waiting on HR, who holds that rung: cancelled, it offers HR nothing.
    await writeChain([UNIT_RUNG, ORGANIZATION_RUNG]);
    const staffed = await file(56);
    const first = await decide(staffed.id, 'approve', staffed.version, unitApprover.token);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const waiting = first.body.data as LeaveRequestDto;
    expect((await readAs(staffed.id, hrApprover.token)).approvalTrail).toMatchObject({
      viewerMayDecide: true,
      viewerStep: 1,
    });
    await cancel(waiting);
    // Only the reader's flags are leave's to clear off `pendingApproval` (re-detail §6.1). Which
    // rung, if any, the panel marks on a cancelled request is a question for the plan, so
    // `currentStep` is not pinned here.
    expect((await readAs(staffed.id, hrApprover.token)).approvalTrail).toMatchObject({
      viewerMayDecide: false,
      viewerStep: null,
      viewerCovers: [],
      viewerMayOverride: false,
    });

    // Left with nobody on the department rung: cancelled, it offers the override nothing.
    await writeChain([UNIT_RUNG, DEPARTMENT_RUNG]);
    const stuck = await file(63);
    const decided = await decide(stuck.id, 'approve', stuck.version, unitApprover.token);
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const unstaffed = decided.body.data as LeaveRequestDto;
    expect(unstaffed.status).toBe('pendingApproval');
    expect(await chainStatus(stuck.id)).toBe('unstaffed');
    expect((await readAs(stuck.id, orgOverride.token)).approvalTrail?.viewerMayOverride).toBe(true);
    await cancel(unstaffed);
    expect((await readAs(stuck.id, orgOverride.token)).approvalTrail).toMatchObject({
      viewerMayDecide: false,
      viewerMayOverride: false,
    });
  });
});
