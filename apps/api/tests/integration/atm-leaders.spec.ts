// /atm/leaders — the names the leader pickers offer, over real HTTP, real RBAC and a real HR roster.
//
// The owner (2026-11-01): «تظهر أسماء الموظفين اللى فى ATM في Drop Down القائد في الصيانة والتغذية
// .. وخصوصاً عند تقفيل ماكينات الصيانة». The list shipped empty — the department setting was empty
// and no screen set it — so the maintenance close offered nobody. Pinned here: with nothing ticked
// the list is the department NAMED for ATM (the legacy rule); the /atm/settings card ticks other
// departments, and `[]` returns to the name rule; a department that is not active is a 400; the
// card is `atmSettings.manage` company-wide while either board's readers read the names; and the
// close takes a name from the list.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type AtmLeaderDepartmentsDto,
  type AtmLeaderOptionDto,
  type AtmMaintenanceDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { hrPermissions } from '../../src/modules/hr/hr.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let replenishmentToken: string; // atmReplenishment.view only — reads the names, not the card
let branchHolderToken: string; // atmSettings.manage at BRANCH scope — refused the card
let branchId: string;
let atmDepartmentId: string;
let cashDepartmentId: string;
let jobTitleId: string;
const atmPeople: string[] = [];

let nidCounter = 0;
let phoneCounter = 0;
const nextNid = (): string => `290010101${String(80_000 + nidCounter++).padStart(5, '0')}`;
const nextPhone = (): string => `012${String(phoneCounter++).padStart(8, '0')}`;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-leaders-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const mkUser = async (email: string, homeBranchId: string | null = null): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: {
        branchId: homeBranchId,
        departmentId: null,
        sectionId: null,
        jobTitleId: null,
      },
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

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

const call = (
  method: 'get' | 'put' | 'post',
  path: string,
  token: string,
  body?: Record<string, unknown>,
) => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};

const mkEmployee = async (fullNameAr: string, departmentId: string): Promise<string> => {
  const res = await call('post', '/hr/employees/direct', adminToken, {
    personal: {
      identity: { fullNameAr, nationalId: nextNid(), nationality: 'Egyptian' },
      contact: { primaryPhone: nextPhone() },
      experience: [],
      drivingLicenses: [],
      certifications: [],
      references: [],
    },
    employment: {
      jobTitleId,
      departmentId,
      branchId,
      employmentType: 'fullTime',
      probationMonths: 0,
      startDate: '2026-07-01T00:00:00.000Z',
    },
    entryStatus: 'active',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

const optionNames = async (token: string, path = '/atm/leaders/options'): Promise<string[]> => {
  const res = await call('get', path, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmLeaderOptionDto[]>(res).map((option) => option.name);
};

const card = async (): Promise<AtmLeaderDepartmentsDto> => {
  const res = await call('get', '/atm/leaders/departments', adminToken);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmLeaderDepartmentsDto>(res);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...hrPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-leaders-admin@ecms.local');
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
  adminToken = await login('atm-leaders-admin@ecms.local');

  const branch = await call('post', '/platform/branches', adminToken, {
    code: '90',
    name: { ar: 'المهندسين', en: 'Mohandessin' },
  });
  expect(branch.status).toBe(201);
  branchId = data<{ id: string }>(branch).id;

  const mkDepartment = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await call('post', '/platform/departments', adminToken, {
      code,
      name: { ar, en },
      branchId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<{ id: string }>(res).id;
  };
  // The legacy wrote «الصراف الالى»; HR spells it with the hamza — the name rule reads both.
  atmDepartmentId = await mkDepartment('ATM-1', 'الصراف الآلي', 'ATM');
  cashDepartmentId = await mkDepartment('CIT-1', 'نقل الأموال', 'Cash Transfer');

  const title = await call('post', '/platform/job-titles', adminToken, {
    code: 'ATM-TECH',
    name: { ar: 'فني صراف', en: 'ATM Technician' },
    jobGrade: 'G1',
  });
  expect(title.status).toBe(201);
  jobTitleId = data<{ id: string }>(title).id;

  atmPeople.push(await mkEmployee('محمود علي حسن', atmDepartmentId));
  atmPeople.push(await mkEmployee('أحمد سعيد محمد', atmDepartmentId));
  await mkEmployee('كريم عادل فتحي', cashDepartmentId);

  const replenishmentRole = await rbacService.createRole(
    { name: { en: 'Repl viewer', ar: 'مشاهد التغذية' }, permissionKeys: ['atmReplenishment.view'] },
    adminId,
  );
  const replenishmentUser = await mkUser('atm-leaders-repl@ecms.local', branchId);
  await rbacService.ensureAssignment(replenishmentUser, String(replenishmentRole._id), 'branch');
  replenishmentToken = await login('atm-leaders-repl@ecms.local');

  const settingsRole = await rbacService.createRole(
    { name: { en: 'ATM settings', ar: 'إعدادات' }, permissionKeys: ['atmSettings.manage'] },
    adminId,
  );
  const holder = await mkUser('atm-leaders-holder@ecms.local', branchId);
  await rbacService.ensureAssignment(holder, String(settingsRole._id), 'branch');
  branchHolderToken = await login('atm-leaders-holder@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('with nothing ticked, the department named for ATM', () => {
  it('offers its employees — in Arabic order — on both routes, and nobody from another department', async () => {
    expect(await optionNames(adminToken)).toEqual(['أحمد سعيد محمد', 'محمود علي حسن']);
    // The route the close modal always read answers the same list.
    expect(await optionNames(adminToken, '/atm/maintenances/leader-options')).toEqual([
      'أحمد سعيد محمد',
      'محمود علي حسن',
    ]);
  });

  it('carries each employee’s HR code', async () => {
    const res = await call('get', '/atm/leaders/options', adminToken);
    for (const option of data<AtmLeaderOptionDto[]>(res)) expect(option.code).not.toBe('');
  });

  it('says so on the card: the ATM department selected by its name, with its people counted', async () => {
    const dto = await card();
    expect(dto.configuredIds).toEqual([]);
    expect(dto.source).toBe('byName');
    expect(dto.employees).toBe(2);
    const atm = dto.departments.find((row) => row.id === atmDepartmentId);
    expect(atm).toMatchObject({
      selected: true,
      matchesName: true,
      employees: 2,
      name: { ar: 'الصراف الآلي', en: 'ATM' },
      branchName: { ar: 'المهندسين', en: 'Mohandessin' },
    });
    expect(dto.departments.find((row) => row.id === cashDepartmentId)).toMatchObject({
      selected: false,
      matchesName: false,
      employees: 1,
    });
    // Selected first.
    expect(dto.departments[0]?.id).toBe(atmDepartmentId);
  });
});

describe('the card ticks departments', () => {
  it('draws the list from the ticked ones only, and `[]` returns to the name rule', async () => {
    const saved = await call('put', '/atm/leaders/departments', adminToken, {
      departmentIds: [cashDepartmentId],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const dto = data<AtmLeaderDepartmentsDto>(saved);
    expect(dto.source).toBe('configured');
    expect(dto.configuredIds).toEqual([cashDepartmentId]);
    expect(dto.employees).toBe(1);
    expect(dto.departments.find((row) => row.id === atmDepartmentId)?.selected).toBe(false);
    expect(await optionNames(replenishmentToken)).toEqual(['كريم عادل فتحي']);

    const both = await call('put', '/atm/leaders/departments', adminToken, {
      departmentIds: [atmDepartmentId, cashDepartmentId, cashDepartmentId],
    });
    expect(both.status).toBe(200);
    // Each id once.
    expect(data<AtmLeaderDepartmentsDto>(both).configuredIds).toEqual([
      atmDepartmentId,
      cashDepartmentId,
    ]);
    expect(await optionNames(adminToken)).toHaveLength(3);

    const reset = await call('put', '/atm/leaders/departments', adminToken, { departmentIds: [] });
    expect(reset.status).toBe(200);
    expect(data<AtmLeaderDepartmentsDto>(reset).source).toBe('byName');
    expect(await optionNames(adminToken)).toEqual(['أحمد سعيد محمد', 'محمود علي حسن']);
  });

  it('refuses a department that does not exist, naming the index, and stores nothing', async () => {
    const res = await call('put', '/atm/leaders/departments', adminToken, {
      departmentIds: [cashDepartmentId, '64b7f9c2e13b4a00123456ff'],
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('body.departmentIds.1');
    expect((await card()).configuredIds).toEqual([]);

    // The index is the body's own, before duplicates are folded away.
    const later = await call('put', '/atm/leaders/departments', adminToken, {
      departmentIds: [cashDepartmentId, cashDepartmentId.toUpperCase(), '64b7f9c2e13b4a00123456ff'],
    });
    expect(later.status).toBe(400);
    expect(JSON.stringify(later.body)).toContain('body.departmentIds.2');
    expect(JSON.stringify(later.body)).not.toContain('body.departmentIds.1');
  });

  it('refuses a body that is not the list', async () => {
    const res = await call('put', '/atm/leaders/departments', adminToken, {
      departmentIds: ['not-an-id'],
    });
    expect(res.status).toBe(400);
  });
});

describe('who may read and change it', () => {
  it('lets a replenishment reader read the names, but not the card', async () => {
    expect(await optionNames(replenishmentToken)).toHaveLength(2);
    expect((await call('get', '/atm/leaders/departments', replenishmentToken)).status).toBe(403);
    expect(
      (
        await call('put', '/atm/leaders/departments', replenishmentToken, {
          departmentIds: [cashDepartmentId],
        })
      ).status,
    ).toBe(403);
  });

  it('refuses the card to atmSettings.manage held for one branch — who staffs ATM is company-wide', async () => {
    expect((await call('get', '/atm/leaders/departments', branchHolderToken)).status).toBe(403);
    expect(
      (
        await call('put', '/atm/leaders/departments', branchHolderToken, {
          departmentIds: [cashDepartmentId],
        })
      ).status,
    ).toBe(403);
    expect((await card()).configuredIds).toEqual([]);
  });

  it('refuses the names to a caller with neither board', async () => {
    expect((await call('get', '/atm/leaders/options', branchHolderToken)).status).toBe(403);
  });
});

describe('the maintenance close takes a name from the list', () => {
  it('closes with the picked employee and writes their HR name as the leader', async () => {
    // An org-wide admin files ATM work where the top bar points (GM-20) — Mohandessin here.
    const machine = await request(app)
      .post('/api/v1/atm/machines/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-active-branch', branchId)
      .send({
        bankName: 'SYN BANK',
        area: 'SYN AREA',
        machines: [{ machineCode: '9101', name: 'SYN 9101' }],
      });
    expect(machine.status, JSON.stringify(machine.body)).toBe(200);
    const opened = await request(app)
      .post('/api/v1/atm/maintenances/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-active-branch', branchId)
      .send({ rows: [{ machineCode: '9101', serviceType: 'عطل', referenceNumber: null }] });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const row = data<{ opened: AtmMaintenanceDto[] }>(opened).opened[0];
    expect(row).toBeDefined();

    const options = data<AtmLeaderOptionDto[]>(
      await call('get', '/atm/leaders/options', adminToken),
    );
    const picked = options.find((option) => option.employeeId === atmPeople[0]);
    expect(picked).toBeDefined();
    const closed = await call('post', '/atm/maintenances/close', adminToken, {
      ids: [row?.id],
      leaderEmployeeId: picked?.employeeId,
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const after = data<AtmMaintenanceDto[]>(closed)[0];
    expect(after?.leaderName).toBe('محمود علي حسن');
    expect(after?.closedAt).not.toBeNull();
    expect(after?.leaderEmployeeId).toBe(atmPeople[0]);
  });
});
