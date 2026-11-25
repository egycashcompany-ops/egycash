// The approvals engine against a real database (R12's baseline, PX-1.1 of
// docs/12-planning/administration-module-phase-px1.md §7; exit criteria 3 and 5): a chain written
// through `PUT /api/v1/platform/approvals`, and an HR leave request — the engine's only host —
// driven through it to approved and to rejected. PX-1.1's cases hold across the fixes; PX-1.2,
// PX-1.3, PX-1.4 and PX-1.6 add theirs here, and PX-1.5 keeps the audit case green. From PX-1.6
// every `PUT` names the chain row it replaces (`basedOn`), as the chain screen does. Leave's answer
// to PXQ-1 (leave design §16) adds its cases last: a request nobody on its chain can approve goes
// to HR, so the earlier cases that waited `unstaffed` reach that state after submission instead.
//
// The leave suite's helpers are copied rather than shared, because exit criterion 5 keeps
// `hr-leave.spec.ts` unchanged. Nobody here holds `super-admin`: the boot sync hands that role every
// key, so its holder would stand on every organization rung and hold `approval.override`
// everywhere. The administrator holds every platform and HR key but those two, and each approver
// holds only the grant a case names.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  HrLeaveTemplates,
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
  readApprovalPin,
  type ChainStatus,
} from '../../src/platform/approvals';
import { ApprovalWorkflowModel } from '../../src/platform/approvals/workflow.model';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { NotificationModel } from '../../src/platform/notifications/notification.model';
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
/** Sick leave: `requiresAttachment` at the default `beforeApproval` stage, and reserves nothing. */
let SICK_ID = '';
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

/**
 * Direct-register an employee hired well in the past, in the department the chains are about;
 * `employment` is spread into the body, as the leave suite gives an employee a manager.
 */
const regEmployee = async (employment: Record<string, unknown> = {}): Promise<EmployeeDto> => {
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
        ...employment,
      },
      hiringDate: '2024-01-01T00:00:00.000Z',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
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
/** `leave.view` company-wide, and an organization-scope `leave.approve` that ended yesterday. */
let lapsedApprover: Person;
/** Placed in the requesters' branch and suspended; holds nothing until a case grants it a rung. */
let suspendedApproverId = '';

/**
 * One single-day leave, filed by the employee on the first countable day from `from`: annual, by
 * the suite's shared employee, unless `by` names another employee, their session or another type.
 */
const file = async (
  from: number,
  by: { emp?: EmployeeDto; ess?: Person; typeId?: string } = {},
): Promise<LeaveRequestDto> => {
  const day = await countableDay((by.emp ?? emp).id, from);
  const res = await request(app)
    .post('/api/v1/hr/leave-requests')
    .set(auth((by.ess ?? ess).token))
    .send({ typeId: by.typeId ?? ANNUAL_ID, startDate: day, endDate: day });
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
  SICK_ID = (types.body.data as LeaveTypeDto[]).find((t) => t.code === 'SICK')?.id ?? '';
  expect(SICK_ID).not.toBe('');

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

  // PX-1.3's two: a grant out of force (R3) and an account that is not active (R8).
  const lapsedApproverId = await mkUser('lapsed-approver@ecms.local');
  await rbacService.ensureAssignment(lapsedApproverId, viewerRole, 'organization');
  await rbacService.assignRole(
    {
      userId: lapsedApproverId,
      roleId: approverRole,
      scope: 'organization',
      validFrom: new Date(Date.now() - 2 * 86_400_000),
      validTo: new Date(Date.now() - 86_400_000),
    },
    adminId,
  );
  lapsedApprover = { userId: lapsedApproverId, token: await login('lapsed-approver@ecms.local') };
  suspendedApproverId = await mkUser('suspended@ecms.local', BRANCH_ID);
  const suspended = await userService.findByIdSystem(suspendedApproverId);
  await userService.changeStatus(
    suspendedApproverId,
    { status: 'suspended', version: suspended?.__v ?? 0 },
    adminId,
  );

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
    // The first chain written in this database, so the screen would have seen none at its place.
    basedOn: null,
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

// The rungs and readers the fix cases share, PX-1.2's and every later pull request's.
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

/**
 * The `hr.leave` chain the screen lists at a place, named as a save names the row it replaces, or
 * null where it lists none (PX-1.6).
 */
const basisAt = async (
  departmentCatalogId: string | null,
  branchId: string | null,
): Promise<{ id: string; version: number } | null> => {
  const res = await request(app).get('/api/v1/platform/approvals').set(auth(adminToken));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const row = (res.body.data as ApprovalWorkflowDto[]).find(
    (w) =>
      w.requestType === 'hr.leave' &&
      (w.department?.id ?? null) === departmentCatalogId &&
      (w.branch?.id ?? null) === branchId,
  );
  return row === undefined ? null : { id: row.id, version: row.version };
};

/** The company default, written over whatever is there: every request below files under it. */
const putChain = async (steps: object[]): Promise<ApprovalWorkflowDto> => {
  const res = await request(app)
    .put('/api/v1/platform/approvals')
    .set(auth(adminToken))
    .send({
      requestType: 'hr.leave',
      departmentCatalogId: null,
      branchId: null,
      steps,
      isActive: true,
      basedOn: await basisAt(null, null),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as ApprovalWorkflowDto;
};

/** The company default, replaced: every request below files under it. */
const writeChain = async (steps: object[]): Promise<void> => {
  await putChain(steps);
};

/**
 * The engine's own answer for a request, read in-process: no DTO carries it. The Unit is the
 * one the requesters were placed in, and the pin is the one leave stored, as leave hands it over.
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
    pin: row === null ? null : readApprovalPin(row),
  });
};

const refusedWith = (res: request.Response, key: string): void => {
  expect(res.status, JSON.stringify(res.body)).toBe(422);
  expect((res.body as { error: { message: string } }).error.message).toBe(key);
};

const outcomes = (dto: LeaveRequestDto) =>
  dto.approvalTrail?.steps.map((s) => [s.outcome, s.overriddenWith]);

/** The notices of one template about one request, to one recipient or, with null, to anybody. */
const told = (userId: string | null, template: string, requestId: string): Promise<number> =>
  NotificationModel.countDocuments({
    ...(userId === null ? {} : { recipientUserId: new Types.ObjectId(userId) }),
    templateKey: template,
    'entityRef.entityId': requestId,
  }).exec();

/**
 * A `branch` grant of `leave.approve` to the account placed in the requesters' branch, and a session
 * opened after it, so the session reads and decides as the holder of the branch rung.
 */
const grantBranchRung = async (): Promise<{ grantId: string; token: string }> => {
  const grant = await rbacService.assignRole(
    { userId: branchApproverId, roleId: APPROVER_ROLE_ID, scope: 'branch' },
    ADMIN_ID,
  );
  return { grantId: String(grant._id), token: await login('branch@ecms.local') };
};

/**
 * A request filed while the branch rung's holder is granted, the grant revoked once it is filed:
 * on the chain, it then reads `unstaffed` with no decision taken. Since PXQ-1 a request is left
 * `unstaffed` on its chain only when a rung's holders leave after it was filed or decided (leave
 * design §16.2, §16.3 LQ-1).
 */
const fileThenEmptyBranchRung = async (
  from: number,
  by: { emp?: EmployeeDto; ess?: Person } = {},
): Promise<LeaveRequestDto> => {
  const { grantId } = await grantBranchRung();
  try {
    const created = await file(from, by);
    expect(created.status).toBe('pendingApproval');
    return created;
  } finally {
    await rbacService.revokeAssignment(grantId, ADMIN_ID);
  }
};

describe('no staffed rung is an answer, and an override decides within its reach (PX-1.2: R2, R4)', () => {
  it('R2, R4: a request whose only rung loses its holder after submission waits unstaffed; an override over the other branch is refused, an organization-scope one approves it', async () => {
    // The branch rung's only holder loses the grant once the request is filed. Before PX-1.2 such
    // a request read approved to the engine while leave kept it pending, and nobody could decide
    // it. Filed on a branch rung nobody holds, it would take the manager and HR path (PXQ-1).
    await writeChain([BRANCH_RUNG]);
    const created = await fileThenEmptyBranchRung(35);
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

  it('R2, PXQ-1: the unit holder’s approval, with nobody on the organization rung, hands the request to HR’s step, where no override decides', async () => {
    // The HR approver is the organization rung's only holder; this case needs that rung empty,
    // and gives the grant back after it. The R4 rule by level stays with the staffed-chain case
    // below, and an override's decision that hands a request over with the PXQ-1 cases.
    const held = await roleAssignmentRepository.findActiveForUser(hrApprover.userId);
    for (const grant of held) await rbacService.revokeAssignment(String(grant._id), ADMIN_ID);
    try {
      await writeChain([UNIT_RUNG, ORGANIZATION_RUNG]);
      const created = await file(42);
      expect(await chainStatus(created.id)).toBe('pending');

      // Before PX-1.2 this approval closed the empty rung above it and approved the request; from
      // PX-1.2 to PXQ-1 the request waited unstaffed for an override.
      const first = await decide(created.id, 'approve', created.version, unitApprover.token);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const half = first.body.data as LeaveRequestDto;
      expect(half.status).toBe('pendingHr');
      expect(outcomes(half)).toEqual([
        ['approved', null],
        ['pending', null],
      ]);
      expect(half.approvalTrail?.currentStep).toBeNull();
      expect(await chainStatus(created.id)).toBe('unstaffed');

      // HR's step is not a rung: no override reads a flag on it, and its check refuses both.
      for (const override of [branchOverride, orgOverride]) {
        expect((await readAs(created.id, override.token)).approvalTrail).toMatchObject({
          currentStep: null,
          viewerMayDecide: false,
          viewerMayOverride: false,
        });
        const res = await decide(created.id, 'approve', half.version, override.token);
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      }
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
    // Off `pendingApproval` leave clears the reader's flags (re-detail §6.1) and marks no rung as
    // waiting: nothing waits on a cancelled request.
    expect((await readAs(staffed.id, hrApprover.token)).approvalTrail).toMatchObject({
      currentStep: null,
      viewerMayDecide: false,
      viewerStep: null,
      viewerCovers: [],
      viewerMayOverride: false,
    });

    // Left with nobody on its branch rung while it waits there: cancelled, it offers the override
    // nothing. The rung loses its holder after the unit holder's approval rather than before it,
    // because since PXQ-1 a decision that leaves nobody on the rungs left hands the request to
    // HR's step, and a request with no entry has no trail once it is off the chain.
    await writeChain([UNIT_RUNG, BRANCH_RUNG]);
    const { grantId } = await grantBranchRung();
    let stuck: LeaveRequestDto;
    try {
      const filed = await file(63);
      const decided = await decide(filed.id, 'approve', filed.version, unitApprover.token);
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      stuck = decided.body.data as LeaveRequestDto;
      expect(stuck.status).toBe('pendingApproval');
    } finally {
      await rbacService.revokeAssignment(grantId, ADMIN_ID);
    }
    expect(await chainStatus(stuck.id)).toBe('unstaffed');
    expect((await readAs(stuck.id, orgOverride.token)).approvalTrail?.viewerMayOverride).toBe(true);
    await cancel(stuck);
    expect((await readAs(stuck.id, orgOverride.token)).approvalTrail).toMatchObject({
      currentStep: null,
      viewerMayDecide: false,
      viewerMayOverride: false,
    });
  });
});

describe('only grants in force decide, and only active accounts staff a rung (PX-1.3: R3, R8)', () => {
  it('R3: a person whose only grant at the waiting rung’s level ended yesterday is offered nothing and refused approvals.notYourStep, while HR’s grant in force keeps the rung staffed', async () => {
    // Before PX-1.3 the reader's own rungs were read from every assignment, in force or not, so the
    // expired grant stood on the organization rung: its holder was offered the decision, and took it.
    await writeChain([ORGANIZATION_RUNG]);
    const created = await file(70);
    expect(await chainStatus(created.id)).toBe('pending');

    expect((await readAs(created.id, lapsedApprover.token)).approvalTrail).toMatchObject({
      currentStep: 0,
      viewerMayDecide: false,
      viewerStep: null,
      viewerMayOverride: false,
    });
    refusedWith(
      await decide(created.id, 'approve', created.version, lapsedApprover.token),
      'approvals.notYourStep',
    );

    expect((await readAs(created.id, hrApprover.token)).approvalTrail).toMatchObject({
      currentStep: 0,
      viewerMayDecide: true,
      viewerStep: 0,
    });
    const res = await decide(created.id, 'approve', created.version, hrApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = res.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(done.approvalTrail?.steps[0]?.decidedBy?.id).toBe(hrApprover.userId);
  });

  it('R8: a rung whose only holder is suspended is passed when a staffed rung follows, and as the only rung sends the request down the manager and HR path', async () => {
    // The branch rung's only holder is a suspended account. Before PX-1.3 its grant kept the rung
    // staffed: the request waited on it, and HR's approval covered it rather than passing it.
    const grant = await rbacService.assignRole(
      { userId: suspendedApproverId, roleId: APPROVER_ROLE_ID, scope: 'branch' },
      ADMIN_ID,
    );
    try {
      await writeChain([BRANCH_RUNG, ORGANIZATION_RUNG]);
      const passed = await file(77);
      expect(passed.status).toBe('pendingApproval');
      expect(await chainStatus(passed.id)).toBe('pending');
      expect((await readAs(passed.id, hrApprover.token)).approvalTrail).toMatchObject({
        currentStep: 1,
        viewerMayDecide: true,
        viewerStep: 1,
        viewerCovers: [],
      });
      const res = await decide(passed.id, 'approve', passed.version, hrApprover.token);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const done = res.body.data as LeaveRequestDto;
      expect(done.status).toBe('approved');
      expect(outcomes(done)).toEqual([
        ['skipped', null],
        ['approved', null],
      ]);

      // Alone, the rung leaves the chain unstaffed, so the request takes the manager and HR path
      // (PXQ-1); this employee has no manager, so it waits on HR, with no trail and no pin.
      await writeChain([BRANCH_RUNG]);
      const routed = await file(84);
      expect(routed.status).toBe('pendingHr');
      expect((await readAs(routed.id, adminToken)).approvalTrail).toBeNull();
      const row = await LeaveRequestModel.findById(routed.id).lean().exec();
      expect(row?.approvalWorkflowId).toBeNull();
      expect(row?.approvalChainShape).toEqual([]);
    } finally {
      await rbacService.revokeAssignment(String(grant._id), ADMIN_ID);
    }
  });
});

describe('a request keeps the chain it was submitted on (PX-1.4: R1)', () => {
  const UNIT_RUNG = {
    permissionKey: 'leave.approve',
    level: 'unit',
    label: { ar: 'مدير الإدارة في الفرع', en: 'Unit manager' },
  };
  const ORGANIZATION_RUNG = {
    permissionKey: 'leave.approve',
    level: 'organization',
    label: { ar: 'الموارد البشرية', en: 'Human resources' },
  };

  const rungsOf = (dto: LeaveRequestDto) =>
    dto.approvalTrail?.steps.map((s) => [s.level, s.label?.en ?? null, s.outcome]);

  it('R1: a pinned request keeps its rungs and captions when its chain is edited, is decided on them, and is still decided to approved once the chain is deleted; a request filed after the delete takes the manager and HR path', async () => {
    const saved = await putChain([UNIT_RUNG, ORGANIZATION_RUNG]);
    const created = await file(91);
    expect(created.status).toBe('pendingApproval');

    // Edited in place to one rung nobody holds, under another caption. Read live, as before
    // PX-1.4, the request would now wait unstaffed on it, and the unit approver would stand on
    // nothing.
    const edited = await putChain([
      {
        permissionKey: 'leave.approve',
        level: 'branch',
        label: { ar: 'مدير الفرع', en: 'Branch manager' },
      },
    ]);
    expect(edited.id).toBe(saved.id);
    const pinned = await readAs(created.id, adminToken);
    expect(rungsOf(pinned)).toEqual([
      ['unit', 'Unit manager', 'pending'],
      ['organization', 'Human resources', 'pending'],
    ]);
    expect(pinned.approvalTrail).toMatchObject({ workflowId: saved.id, currentStep: 0 });

    // What leave stored at submission (re-detail §5): the row it chose, and its rungs as they were.
    const row = await LeaveRequestModel.findById(created.id).lean().exec();
    expect(String(row?.approvalWorkflowId)).toBe(saved.id);
    expect(row?.approvalChainShape).toEqual([UNIT_RUNG, ORGANIZATION_RUNG]);

    // The notice to the next approvers follows the pin as well: the pinned organization rung's
    // holder is told, where the edited chain's branch rung has nobody to tell.
    const toHr = () =>
      NotificationModel.countDocuments({
        recipientUserId: new Types.ObjectId(hrApprover.userId),
        templateKey: HrLeaveTemplates.RequestSubmitted,
      }).exec();
    const toldBefore = await toHr();
    const first = await decide(created.id, 'approve', created.version, unitApprover.token);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(await toHr()).toBe(toldBefore + 1);
    const half = first.body.data as LeaveRequestDto;
    expect(half.status).toBe('pendingApproval');
    expect(rungsOf(half)).toEqual([
      ['unit', 'Unit manager', 'approved'],
      ['organization', 'Human resources', 'pending'],
    ]);
    expect(half.approvalTrail?.currentStep).toBe(1);

    // Deleted: no chain applies any more, and the pinned request is still decided on its own.
    const removed = await request(app)
      .delete(`/api/v1/platform/approvals/${saved.id}`)
      .set(auth(adminToken));
    expect(removed.status, JSON.stringify(removed.body)).toBe(204);
    const second = await decide(created.id, 'approve', half.version, hrApprover.token);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const done = second.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(rungsOf(done)).toEqual([
      ['unit', 'Unit manager', 'approved'],
      ['organization', 'Human resources', 'approved'],
    ]);

    // A new request finds no chain, so leave's own rule sends it down the manager and HR path;
    // this employee has no manager, so it waits on HR.
    const after = await file(98);
    expect(after.status).toBe('pendingHr');
    expect((await readAs(after.id, adminToken)).approvalTrail).toBeNull();
  });

  it('criterion 4 guard: a request whose pin fields are unset, the shape of one filed before the deploy, reads the current chain', async () => {
    // Passes before PX-1.4 too, where no request has the fields: that is the behavior it keeps.
    await putChain([UNIT_RUNG, ORGANIZATION_RUNG]);
    const created = await file(105);
    const _id = new Types.ObjectId(created.id);
    await LeaveRequestModel.collection.updateOne(
      { _id },
      { $unset: { approvalWorkflowId: '', approvalChainShape: '' } },
    );
    const raw = await LeaveRequestModel.collection.findOne({ _id });
    expect(raw).not.toHaveProperty('approvalWorkflowId');
    expect(raw).not.toHaveProperty('approvalChainShape');

    // Edited in place, the chain moves the unpinned request with it: it now waits on HR alone.
    await putChain([{ ...ORGANIZATION_RUNG, label: { ar: 'شؤون العاملين', en: 'Personnel' } }]);
    const live = await readAs(created.id, adminToken);
    expect(rungsOf(live)).toEqual([['organization', 'Personnel', 'pending']]);
    expect(live.approvalTrail?.currentStep).toBe(0);

    const res = await decide(created.id, 'approve', live.version, hrApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = res.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(rungsOf(done)).toEqual([['organization', 'Personnel', 'approved']]);
  });
});

describe('a chain save names its type’s keys and the row it replaces (PX-1.6: R9)', () => {
  /** A save of an `hr.leave` chain at a place, naming the row it replaces. */
  const save = (
    place: { departmentCatalogId: string | null; branchId: string | null },
    steps: object[],
    basedOn: { id: string; version: number } | null,
  ) =>
    request(app)
      .put('/api/v1/platform/approvals')
      .set(auth(adminToken))
      .send({ requestType: 'hr.leave', ...place, steps, isActive: true, basedOn });

  const staleWith = (res: request.Response): void => {
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('STALE_DOCUMENT');
  };

  const removeChain = async (id: string): Promise<void> => {
    const res = await request(app).delete(`/api/v1/platform/approvals/${id}`).set(auth(adminToken));
    expect(res.status, JSON.stringify(res.body)).toBe(204);
  };

  const COMPANY = { departmentCatalogId: null, branchId: null };

  it('R9: a PUT naming approval.configure, a registered key that is not hr.leave’s, is refused approvals.unknownPermissionKey, and a PUT without basedOn is 400', async () => {
    // Before PX-1.6 a save checked its keys against the permission registry alone, which holds
    // `approval.configure`, and took a body that named no row.
    const before = await basisAt(null, null);
    refusedWith(
      await save(
        COMPANY,
        [{ permissionKey: 'approval.configure', level: 'organization', label: null }],
        before,
      ),
      'approvals.unknownPermissionKey',
    );

    const missing = await request(app)
      .put('/api/v1/platform/approvals')
      .set(auth(adminToken))
      .send({ requestType: 'hr.leave', ...COMPANY, steps: [ORGANIZATION_RUNG], isActive: true });
    expect(missing.status, JSON.stringify(missing.body)).toBe(400);
    const error = (missing.body as { error: { code: string; details: { field: string }[] } }).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details.map((detail) => detail.field)).toEqual(['body.basedOn']);

    // Neither save wrote anything: the company default is the row it was, at the version it was.
    expect(await basisAt(null, null)).toEqual(before);
  });

  it('R9: a stale version, a null over a chain, a basedOn where no chain exists and one naming a chain deleted and recreated at the same place are each 409 STALE_DOCUMENT; the right basedOn saves, one version higher', async () => {
    // The other branch, where nobody files: a chain there decides none of the requests here.
    const PLACE = { departmentCatalogId: null, branchId: OTHER_BRANCH_ID };
    expect(await basisAt(null, OTHER_BRANCH_ID)).toBeNull();
    let current = '';
    try {
      // No chain there yet: a basis naming one is refused, and null writes the first.
      staleWith(
        await save(PLACE, [ORGANIZATION_RUNG], { id: String(new Types.ObjectId()), version: 0 }),
      );
      const first = await save(PLACE, [ORGANIZATION_RUNG], null);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const deleted = first.body.data as ApprovalWorkflowDto;
      expect(deleted.version).toBe(0);

      // Deleted and written again at the place: the new row starts at version 0 as the old one
      // did, and only its id tells them apart, so a save based on the old row is refused.
      await removeChain(deleted.id);
      const second = await save(PLACE, [ORGANIZATION_RUNG], null);
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const recreated = second.body.data as ApprovalWorkflowDto;
      current = recreated.id;
      expect(recreated.id).not.toBe(deleted.id);
      expect(recreated.version).toBe(0);
      staleWith(await save(PLACE, [UNIT_RUNG], { id: deleted.id, version: 0 }));

      // A null over the chain that is there, as a first save of a screen that saw none.
      staleWith(await save(PLACE, [UNIT_RUNG], null));

      // The right basis saves, and the answer carries the next version.
      const right = await save(PLACE, [UNIT_RUNG, ORGANIZATION_RUNG], {
        id: recreated.id,
        version: 0,
      });
      expect(right.status, JSON.stringify(right.body)).toBe(200);
      expect(right.body.data as ApprovalWorkflowDto).toMatchObject({
        id: recreated.id,
        version: 1,
        steps: [UNIT_RUNG, ORGANIZATION_RUNG],
      });

      // A second save from the same screen, still on version 0, is stale now.
      staleWith(await save(PLACE, [BRANCH_RUNG], { id: recreated.id, version: 0 }));

      // None of the refused saves wrote anything.
      const listed = await request(app).get('/api/v1/platform/approvals').set(auth(adminToken));
      const there = (listed.body.data as ApprovalWorkflowDto[]).filter(
        (w) => w.requestType === 'hr.leave' && w.branch?.id === OTHER_BRANCH_ID,
      );
      expect(there).toHaveLength(1);
      expect(there[0]).toMatchObject({
        id: recreated.id,
        version: 1,
        steps: [UNIT_RUNG, ORGANIZATION_RUNG],
      });
    } finally {
      if (current !== '') await removeChain(current);
    }
  });

  it('R9: a chain row stored with a rung on another key leaves that rung unstaffed, so a new request on it alone takes the manager and HR path, and its next save is refused until the rung is removed', async () => {
    // Written past the save's checks, as a row saved before PX-1.6 could be: the department's own
    // chain in the requesters' branch, so it answers their requests ahead of the company default.
    // Every override holder and the administrator hold `leave.view` company-wide, so before PX-1.6
    // that rung was staffed, and its holders decided it as their own.
    const OFF_TYPE_RUNG = { permissionKey: 'leave.view', level: 'organization', label: null };
    const stored = await ApprovalWorkflowModel.create({
      requestType: 'hr.leave',
      departmentCatalogId: new Types.ObjectId(CATALOG_ID),
      branchId: new Types.ObjectId(BRANCH_ID),
      steps: [OFF_TYPE_RUNG],
      isActive: true,
    });
    try {
      // The chain reads unstaffed, nobody's grants putting them on the rung, and with no other
      // rung staffed the request takes the manager and HR path (PXQ-1): this employee has no
      // manager, so it waits on HR, with no trail and no pin. That a holder of the other key is
      // offered nothing on such a rung stays with the staffed-chain case below.
      const created = await file(112);
      expect(created.status).toBe('pendingHr');
      expect(await chainStatus(created.id)).toBe('unstaffed');
      expect((await readAs(created.id, adminToken)).approvalTrail).toBeNull();
      const row = await LeaveRequestModel.findById(created.id).lean().exec();
      expect(row?.approvalWorkflowId).toBeNull();

      // The stored chain is refused at its next save while it keeps the rung, and taken once the
      // rung is removed.
      const place = { departmentCatalogId: CATALOG_ID, branchId: BRANCH_ID };
      const basis = await basisAt(CATALOG_ID, BRANCH_ID);
      expect(basis).toEqual({ id: String(stored._id), version: 0 });
      refusedWith(await save(place, [OFF_TYPE_RUNG], basis), 'approvals.unknownPermissionKey');
      const fixed = await save(place, [ORGANIZATION_RUNG], basis);
      expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
      expect((fixed.body.data as ApprovalWorkflowDto).version).toBe(1);
    } finally {
      await removeChain(String(stored._id));
    }
  });

  it('R9: on a staffed chain, a holder of a stored rung’s other key does not decide it early over the unit rung, and the unit holder’s approval, with nobody able to stand on that rung, hands the request to HR’s step', async () => {
    // The department's own chain in the requesters' branch: the unit rung, staffed, and above it a
    // rung on `leave.view`, which every override holder holds company-wide. Before PX-1.6 a reader
    // was measured against every rung, so a `leave.view` holder stood on rung 1, above the waiting
    // rung, and decided it early, covering the unit rung and approving the request.
    const OFF_TYPE_RUNG = { permissionKey: 'leave.view', level: 'organization', label: null };
    const stored = await ApprovalWorkflowModel.create({
      requestType: 'hr.leave',
      departmentCatalogId: new Types.ObjectId(CATALOG_ID),
      branchId: new Types.ObjectId(BRANCH_ID),
      steps: [UNIT_RUNG, OFF_TYPE_RUNG],
      isActive: true,
    });
    try {
      const created = await file(119);
      expect(created.status).toBe('pendingApproval');
      expect(await chainStatus(created.id)).toBe('pending');

      // `leave.view` company-wide, and an override that ended yesterday: on no rung, and no reach.
      expect((await readAs(created.id, lapsedOverride.token)).approvalTrail).toMatchObject({
        currentStep: 0,
        viewerMayDecide: false,
        viewerStep: null,
        viewerCovers: [],
        viewerMayOverride: false,
      });
      refusedWith(
        await decide(created.id, 'approve', created.version, lapsedOverride.token),
        'approvals.notYourStep',
      );

      // The unit rung's holder decides it. The rung left is one nobody can stand on, so the chain
      // reads unstaffed rather than approved past it, and leave hands the request to HR's step
      // (PXQ-1), where the chain marks no rung as waiting.
      const res = await decide(created.id, 'approve', created.version, unitApprover.token);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const decided = res.body.data as LeaveRequestDto;
      expect(decided.status).toBe('pendingHr');
      expect(outcomes(decided)).toEqual([
        ['approved', null],
        ['pending', null],
      ]);
      expect(decided.approvalTrail?.currentStep).toBeNull();
      expect(await chainStatus(created.id)).toBe('unstaffed');
    } finally {
      await removeChain(String(stored._id));
    }
  });
});

describe('a leave request nobody on its chain can approve goes to HR (PXQ-1, leave design §16)', () => {
  // Its own employee, with no manager, so its requests leave the shared employee's days alone;
  // N2 registers one with a manager.
  let nEmp: EmployeeDto;
  let nEss: Person;
  const byN = (): { emp: EmployeeDto; ess: Person } => ({ emp: nEmp, ess: nEss });

  beforeAll(async () => {
    nEmp = await regEmployee();
    nEss = await activateEssLogin(nEmp);
    await grantNextYearHeadroom(nEmp.id);
  });

  /** The `leaveDecision` rows of a request, oldest first. */
  const decisionsOf = (id: string) =>
    audited({
      'entityRef.moduleId': 'hr',
      'entityRef.entityType': 'leaveRequest',
      'entityRef.entityId': id,
      action: 'leaveDecision',
    });

  /** The engine's own rows written by the HTTP request that wrote one leave audit row. */
  const engineRowsUnder = async (requestId: string | null): Promise<string[]> => {
    expect(requestId).not.toBeNull();
    const rows = await audited({
      'entityRef.moduleId': 'platform',
      'entityRef.entityType': 'approval',
      requestId,
    });
    return rows.map((r) => r.entityRef.entityId);
  };

  /** The days the employee's annual balance holds reserved in the leave year of `day`. */
  const reservedIn = async (employeeId: string, day: string): Promise<number> => {
    const res = await request(app)
      .get(`/api/v1/hr/employees/${employeeId}/leave-balances`)
      .query({ year: Number(day.slice(0, 4)) })
      .set(auth(adminToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = (res.body.data as LeaveBalanceDto[]).find((b) => b.typeCode === 'ANNUAL');
    expect(row).toBeDefined();
    return row?.reserved ?? 0;
  };

  /**
   * N3's way to the hand-over: `[UNIT_RUNG, BRANCH_RUNG]`, filed for `nEmp`, and the unit holder's
   * approval, after which nobody holds the branch rung that is left.
   */
  const handedOver = async (from: number, typeId?: string): Promise<LeaveRequestDto> => {
    await writeChain([UNIT_RUNG, BRANCH_RUNG]);
    const created = await file(from, { ...byN(), ...(typeId === undefined ? {} : { typeId }) });
    expect(created.status).toBe('pendingApproval');
    const res = await decide(created.id, 'approve', created.version, unitApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const handed = res.body.data as LeaveRequestDto;
    expect(handed.status).toBe('pendingHr');
    return handed;
  };

  it('N1: a chain whose only rung nobody holds sends a new request down the manager and HR path, to HR when the employee has no manager, and HR decides it with no engine row', async () => {
    // Before PXQ-1 the request was stamped pendingApproval on the chain, and nobody who could
    // decide it was told.
    const chain = await putChain([BRANCH_RUNG]);
    const created = await file(7, byN());
    expect(created.status).toBe('pendingHr');
    expect(created.pendingStep).toBe('hr');
    expect((await readAs(created.id, adminToken)).approvalTrail).toBeNull();
    const row = await LeaveRequestModel.findById(created.id).lean().exec();
    expect(row?.approvalWorkflowId).toBeNull();
    expect(row?.approvalChainShape).toEqual([]);

    // The submission names the chain that applied and that nobody staffs.
    const submitted = await audited({
      'entityRef.moduleId': 'hr',
      'entityRef.entityType': 'leaveRequest',
      'entityRef.entityId': created.id,
      action: 'leaveRequest',
    });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.changes.find((c) => c.field === 'unstaffedChain')).toEqual({
      field: 'unstaffedChain',
      old: null,
      new: chain.id,
    });
    expect(await told(hrApprover.userId, HrLeaveTemplates.RequestSubmitted, created.id)).toBe(1);

    const res = await decide(created.id, 'approve', created.version, hrApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = res.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(done.approvals).toHaveLength(1);
    expect(done.approvals[0]).toMatchObject({ step: 'hr', deciderUserId: hrApprover.userId });
    expect((await LeaveRequestModel.findById(created.id).lean().exec())?.approvalSteps).toEqual([]);
    const decisions = await decisionsOf(created.id);
    expect(decisions).toHaveLength(1);
    expect(await engineRowsUnder(decisions[0]?.requestId ?? null)).toEqual([]);
  });

  it('N2: the same chain, for an employee with a manager, sends the request to the manager, who approves it by relationship', async () => {
    const managerId = await mkUser('n2-manager@ecms.local', BRANCH_ID);
    const managerToken = await login('n2-manager@ecms.local');
    const managed = await regEmployee({ managerId });
    const managedEss = await activateEssLogin(managed);
    await grantNextYearHeadroom(managed.id);

    await writeChain([BRANCH_RUNG]);
    const created = await file(7, { emp: managed, ess: managedEss });
    expect(created.status).toBe('pendingManager');
    expect(created.pendingStep).toBe('manager');
    expect(await told(managerId, HrLeaveTemplates.RequestSubmitted, created.id)).toBe(1);

    // Annual leave is `managerOnly`, so the manager's approval finishes it.
    const res = await decide(created.id, 'approve', created.version, managerToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const done = res.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(done.approvals).toHaveLength(1);
    expect(done.approvals[0]).toMatchObject({ step: 'manager', deciderUserId: managerId });
  });

  it('N3: the unit holder’s approval, with nobody on the branch rung left, hands the request to HR’s step, where no override decides and HR approves it with no engine row', async () => {
    // Before PXQ-1 the approval left the request waiting unstaffed on the chain for an override.
    await writeChain([UNIT_RUNG, BRANCH_RUNG]);
    const created = await file(14, byN());
    expect(created.status).toBe('pendingApproval');
    const toldBefore = await told(hrApprover.userId, HrLeaveTemplates.RequestSubmitted, created.id);

    const first = await decide(created.id, 'approve', created.version, unitApprover.token);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const handed = first.body.data as LeaveRequestDto;
    expect(handed.status).toBe('pendingHr');
    expect(handed.pendingStep).toBe('hr');
    expect(outcomes(handed)).toEqual([
      ['approved', null],
      ['pending', null],
    ]);
    expect(handed.approvalTrail?.currentStep).toBeNull();
    expect(await chainStatus(created.id)).toBe('unstaffed');
    expect(await told(hrApprover.userId, HrLeaveTemplates.RequestSubmitted, created.id)).toBe(
      toldBefore + 1,
    );

    // The hand-over is one decision: leave's row moves the status to HR's step, and the engine's
    // row from the same HTTP request is rung 0's.
    const atHandOver = await decisionsOf(created.id);
    expect(atHandOver.map((r) => r.changes.find((c) => c.field === 'status')?.new)).toEqual([
      'pendingHr',
    ]);
    expect(await engineRowsUnder(atHandOver[0]?.requestId ?? null)).toEqual(['hr.leave:0']);

    // HR's step is not a rung: the company-wide override reads nothing to decide, and is refused.
    expect((await readAs(created.id, orgOverride.token)).approvalTrail?.viewerMayOverride).toBe(
      false,
    );
    const overridden = await decide(created.id, 'approve', handed.version, orgOverride.token);
    expect(overridden.status, JSON.stringify(overridden.body)).toBe(403);

    const second = await decide(created.id, 'approve', handed.version, hrApprover.token);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const done = second.body.data as LeaveRequestDto;
    expect(done.status).toBe('approved');
    expect(done.approvals).toHaveLength(1);
    expect(done.approvals[0]).toMatchObject({ step: 'hr', deciderUserId: hrApprover.userId });
    expect(
      (await LeaveRequestModel.findById(created.id).lean().exec())?.approvalSteps,
    ).toHaveLength(1);
    const decisions = await decisionsOf(created.id);
    expect(decisions.map((r) => r.changes.find((c) => c.field === 'status')?.new)).toEqual([
      'pendingHr',
      'approved',
    ]);
    expect(decisions[1]?.changes.find((c) => c.field === 'step')?.new).toBe('hr');
    expect(await engineRowsUnder(decisions[1]?.requestId ?? null)).toEqual([]);
  });

  it('N4: a handed-over request stays on HR’s step when its branch rung is staffed again, and that rung’s holder decides it as HR’s step', async () => {
    const handed = await handedOver(21);
    const { grantId, token } = await grantBranchRung();
    try {
      // The chain could go on now, and the request does not go back to it.
      expect(await chainStatus(handed.id)).toBe('pending');
      const reread = await readAs(handed.id, token);
      expect(reread.status).toBe('pendingHr');
      expect(reread.approvalTrail).toMatchObject({
        currentStep: null,
        viewerMayDecide: false,
        viewerStep: null,
        viewerCovers: [],
        viewerMayOverride: false,
      });

      // A branch-wide `leave.approve` covers the employee, so its holder decides HR's step.
      const res = await decide(handed.id, 'approve', reread.version, token);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const done = res.body.data as LeaveRequestDto;
      expect(done.status).toBe('approved');
      expect(done.approvals).toHaveLength(1);
      expect(done.approvals[0]).toMatchObject({ step: 'hr', deciderUserId: branchApproverId });
      expect(outcomes(done)).toEqual([
        ['approved', null],
        ['pending', null],
      ]);
    } finally {
      await rbacService.revokeAssignment(grantId, ADMIN_ID);
    }
  });

  it('N5: HR’s rejection of a handed-over request releases its day and tells the employee', async () => {
    const day = await countableDay(nEmp.id, 28);
    const before = await reservedIn(nEmp.id, day);
    const handed = await handedOver(28);
    expect(handed.startDate).toBe(day);
    expect(await reservedIn(nEmp.id, day)).toBe(before + 1);

    const res = await decide(handed.id, 'reject', handed.version, hrApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as LeaveRequestDto).status).toBe('rejected');
    expect(await reservedIn(nEmp.id, day)).toBe(before);
    expect(await told(nEss.userId, HrLeaveTemplates.RequestRejected, handed.id)).toBe(1);
  });

  it('N6: the employee cancels a handed-over request: its trail offers nothing, its day is released and HR is told', async () => {
    const day = await countableDay(nEmp.id, 35);
    const before = await reservedIn(nEmp.id, day);
    const handed = await handedOver(35);

    const res = await request(app)
      .post(`/api/v1/hr/leave-requests/${handed.id}/cancel`)
      .set(auth(nEss.token))
      .send({ version: handed.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as LeaveRequestDto).status).toBe('cancelled');
    expect((await readAs(handed.id, hrApprover.token)).approvalTrail).toMatchObject({
      currentStep: null,
      viewerMayDecide: false,
      viewerMayOverride: false,
    });
    expect(await reservedIn(nEmp.id, day)).toBe(before);
    // No manager, so the cancellation goes to company-wide holders of `leave.approve`.
    expect(await told(hrApprover.userId, HrLeaveTemplates.RequestCancelled, handed.id)).toBe(1);
  });

  it('N7, LQ-2 until answered: the branch holder who approved rung 0 decides HR’s step too, and with nobody holding leave.approve company-wide nobody is told at the hand-over', async () => {
    // HR is the organization rung's only holder, and the only company-wide holder in force of
    // `leave.approve`; the case needs both empty, and gives the grant back after it.
    const held = await roleAssignmentRepository.findActiveForUser(hrApprover.userId);
    for (const grant of held) await rbacService.revokeAssignment(String(grant._id), ADMIN_ID);
    const { grantId, token } = await grantBranchRung();
    try {
      await writeChain([BRANCH_RUNG, ORGANIZATION_RUNG]);
      const created = await file(42, byN());
      expect(created.status).toBe('pendingApproval');
      const toldBefore = await told(null, HrLeaveTemplates.RequestSubmitted, created.id);

      const first = await decide(created.id, 'approve', created.version, token);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const handed = first.body.data as LeaveRequestDto;
      expect(handed.status).toBe('pendingHr');
      // The notice goes to company-wide holders, as on the manager and HR path, and there are
      // none in force (leave design §16.12, LR-2).
      expect(await told(null, HrLeaveTemplates.RequestSubmitted, created.id)).toBe(toldBefore);

      // LQ-2 option 1, today's rule: HR's step is decided by any holder of `leave.approve` whose
      // scope covers the employee, whoever decided a rung before.
      const second = await decide(created.id, 'approve', handed.version, token);
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const done = second.body.data as LeaveRequestDto;
      expect(done.status).toBe('approved');
      expect(done.approvals[0]).toMatchObject({ step: 'hr', deciderUserId: branchApproverId });
    } finally {
      await rbacService.revokeAssignment(grantId, ADMIN_ID);
      await rbacService.ensureAssignment(hrApprover.userId, APPROVER_ROLE_ID, 'organization');
    }
  });

  it('N9: an override’s decision that leaves nobody on the rungs left hands the request to HR’s step', async () => {
    await writeChain([BRANCH_RUNG, DEPARTMENT_RUNG]);
    const created = await fileThenEmptyBranchRung(70, byN());
    expect(await chainStatus(created.id)).toBe('unstaffed');

    const first = await decide(created.id, 'approve', created.version, orgOverride.token);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const handed = first.body.data as LeaveRequestDto;
    expect(handed.status).toBe('pendingHr');
    expect(outcomes(handed)).toEqual([
      ['approved', APPROVAL_OVERRIDE_KEY],
      ['pending', null],
    ]);
    const decisions = await decisionsOf(created.id);
    expect(decisions.map((r) => r.changes.find((c) => c.field === 'status')?.new)).toEqual([
      'pendingHr',
    ]);
    expect(await told(hrApprover.userId, HrLeaveTemplates.RequestSubmitted, created.id)).toBe(1);

    const res = await decide(created.id, 'approve', handed.version, hrApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as LeaveRequestDto).status).toBe('approved');
  });

  it('N10: a request with no pin, filed before PX-1.4, is handed to HR’s step on its live chain', async () => {
    const live = await putChain([UNIT_RUNG, BRANCH_RUNG]);
    const created = await file(77, byN());
    const _id = new Types.ObjectId(created.id);
    await LeaveRequestModel.collection.updateOne(
      { _id },
      { $unset: { approvalWorkflowId: '', approvalChainShape: '' } },
    );

    const first = await decide(created.id, 'approve', created.version, unitApprover.token);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const handed = first.body.data as LeaveRequestDto;
    expect(handed.status).toBe('pendingHr');
    expect(handed.approvalTrail?.workflowId).toBe(live.id);
    expect(outcomes(handed)).toEqual([
      ['approved', null],
      ['pending', null],
    ]);

    const res = await decide(created.id, 'approve', handed.version, hrApprover.token);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as LeaveRequestDto).status).toBe('approved');
  });

  it('N11: the hand-over of sick leave needs no certificate, and HR’s approval waits for one', async () => {
    // A hand-over is not an approval: a `beforeApproval` type is gated at the approval that
    // finishes it, which here is HR's.
    const handed = await handedOver(84, SICK_ID);
    const refused = await decide(handed.id, 'approve', handed.version, hrApprover.token);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect((refused.body as { error: { message: string } }).error.message).toBe(
      'an attachment is required before approval',
    );

    const attached = await request(app)
      .post(`/api/v1/hr/leave-requests/${handed.id}/attachments`)
      .set(auth(nEss.token))
      .attach('file', Buffer.from('%PDF-1.4 certificate'), 'certificate.pdf');
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);
    const res = await decide(
      handed.id,
      'approve',
      (attached.body.data as LeaveRequestDto).version,
      hrApprover.token,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as LeaveRequestDto).status).toBe('approved');
  });
});
