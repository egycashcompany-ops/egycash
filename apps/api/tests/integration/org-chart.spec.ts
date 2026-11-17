// The company org chart and job places, against a real database and over HTTP (P-ORG-3, ADR-038).
//
// Rows that stand for legacy "never linked" data are inserted through the MODELS, not the services:
// since P-ORG-3 the services link a new row when they create it (design §5.6), so the only way to
// have an unlinked row is to write one the way history did.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { Types } from 'mongoose';
import { type Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SettingKeys,
  platformPermissions,
  type JobTitleDto,
  type OrgChartDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import {
  branchService,
  departmentCatalogService,
  DepartmentCatalogModel,
  DepartmentModel,
  JobPlaceModel,
  jobTitleService,
  sectionCatalogService,
  SectionCatalogModel,
  SectionModel,
} from '../../src/platform/organization';
import { JobTitleModel } from '../../src/platform/organization/job-titles/job-title.model';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let viewerToken: string; // department.view only
let jobEditorToken: string; // jobTitle.edit only
let nobodyToken: string; // no key at all

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-org-chart-test-${Date.now()}`;
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

const withRole = async (email: string, keys: string[]): Promise<string> => {
  const role = await rbacService.createRole(
    { name: { en: `Role ${email}`, ar: `دور ${email}` }, permissionKeys: keys },
    adminId,
  );
  const userId = await mkUser(email);
  await rbacService.ensureAssignment(userId, String(role._id), 'organization');
  return login(email);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
export const errorCode = (res: request.Response): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';

let seq = 0;
const nextCode = (prefix: string): string => `${prefix}${String(++seq).padStart(4, '0')}`;

const branches: string[] = [];

/** A department entry with a linked row in each given branch, written as P-ORG-2 left them. */
const linkedDepartment = async (name: { ar: string; en: string }, branchIds: readonly string[]) => {
  const entry = await departmentCatalogService.create({ code: nextCode('DC-'), name }, adminId);
  const rows = [];
  for (const branchId of branchIds) {
    const _id = new Types.ObjectId();
    rows.push(
      await DepartmentModel.create({
        _id,
        branchId: new Types.ObjectId(branchId),
        code: nextCode('D-'),
        name,
        catalogId: entry._id,
        status: 'active',
        path: `${branchId}/${String(_id)}`,
      }),
    );
  }
  return { entry, rows };
};

/** A department row never linked to any entry — legacy data. */
const unlinkedDepartment = async (name: { ar: string; en: string }, branchId: string) => {
  const _id = new Types.ObjectId();
  return DepartmentModel.create({
    _id,
    branchId: new Types.ObjectId(branchId),
    code: nextCode('D-'),
    name,
    catalogId: null,
    status: 'active',
    path: `${branchId}/${String(_id)}`,
  });
};

const linkedSection = async (
  name: { ar: string; en: string },
  departmentCatalogId: Types.ObjectId,
  departmentRows: readonly { _id: Types.ObjectId; branchId: Types.ObjectId }[],
  status: 'active' | 'inactive' = 'active',
) => {
  const entry = await sectionCatalogService.create(
    { code: nextCode('SC-'), name, departmentCatalogId: String(departmentCatalogId) },
    adminId,
  );
  for (const department of departmentRows) {
    const _id = new Types.ObjectId();
    await SectionModel.create({
      _id,
      branchId: department.branchId,
      departmentId: department._id,
      code: nextCode('S-'),
      name,
      catalogId: entry._id,
      status,
      path: `${String(department.branchId)}/${String(department._id)}/${String(_id)}`,
    });
  }
  return entry;
};

const job = async (en: string, ar: string) =>
  jobTitleService.create({ code: nextCode('J-'), name: { ar, en }, jobGrade: 'G1' }, adminId);

const chart = async (token = adminToken): Promise<OrgChartDto> => {
  const res = await request(app).get('/api/v1/platform/org-chart').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return data<OrgChartDto>(res);
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  adminId = await mkUser('chart-admin@ecms.local');
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
  adminToken = await login('chart-admin@ecms.local');
  viewerToken = await withRole('chart-viewer@ecms.local', ['department.view']);
  jobEditorToken = await withRole('chart-job-editor@ecms.local', ['jobTitle.edit']);
  nobodyToken = await withRole('chart-nobody@ecms.local', ['branch.view']);

  for (let i = 0; i < 7; i += 1) {
    const branch = await branchService.create(
      { code: nextCode('B'), name: { ar: `فرع ${i}`, en: `Branch ${i}` } },
      adminId,
    );
    branches.push(String(branch._id));
  }
}, 180_000);

afterAll(async () => {
  await disconnectMongo();
  await replSet?.stop();
});

beforeEach(async () => {
  await Promise.all([
    DepartmentModel.deleteMany({}),
    SectionModel.deleteMany({}),
    DepartmentCatalogModel.deleteMany({}),
    SectionCatalogModel.deleteMany({}),
    JobPlaceModel.deleteMany({}),
    JobTitleModel.deleteMany({}),
  ]);
});

describe('GET /platform/org-chart — reading (P-ORG-3 §4)', () => {
  it('folds seven branch copies into one department, and an unlinked copy joins it by name', async () => {
    const { entry } = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 6));
    await unlinkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches[6] ?? '');
    const dto = await chart();
    expect(dto.departments).toHaveLength(1);
    const [ops] = dto.departments;
    expect(ops?.departmentCatalogId).toBe(String(entry._id));
    expect(ops?.branches).toHaveLength(7);
    expect(ops?.linkedBranchIds).toHaveLength(6);
    expect(ops?.editable).toBe(true);
  });

  it('keeps sections inside their department: one name under two departments is two sections', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const sec = await linkedDepartment({ ar: 'الأمن', en: 'Security' }, branches.slice(0, 1));
    await linkedSection({ ar: 'الإدارة', en: 'Admin' }, ops.entry._id, ops.rows);
    await linkedSection({ ar: 'الإدارة', en: 'Admin' }, sec.entry._id, sec.rows);
    const dto = await chart();
    for (const department of dto.departments) {
      expect(department.sections).toHaveLength(1);
      expect(department.sections[0]?.editable).toBe(true);
    }
  });

  it('hides a stopped section, and its places come back shown:false on the chart and on the job', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 2));
    const treasury = await linkedSection({ ar: 'الخزينة', en: 'Treasury' }, ops.entry._id, ops.rows, 'inactive');
    const cashier = await job('Cashier', 'أمين خزينة');
    await JobPlaceModel.create([
      { jobTitleId: cashier._id, departmentCatalogId: ops.entry._id, sectionCatalogId: treasury._id },
      { jobTitleId: cashier._id, departmentCatalogId: ops.entry._id, sectionCatalogId: null },
    ]);

    const dto = await chart();
    expect(dto.departments[0]?.sections).toHaveLength(0);
    const placed = dto.jobs.find((j) => j.id === String(cashier._id));
    expect(placed?.places.map((p) => p.shown).sort()).toEqual([false, true]);

    const res = await request(app)
      .get(`/api/v1/platform/job-titles/${String(cashier._id)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const places = data<JobTitleDto>(res).places;
    expect(places).toHaveLength(2);
    const inTreasury = places.find((p) => p.section !== null);
    expect(inTreasury?.section?.name.en).toBe('Treasury');
    expect(inTreasury?.shown).toBe(false);
    expect(places.find((p) => p.section === null)?.shown).toBe(true);
  });

  it('shows a department with no company entry read-only', async () => {
    await unlinkedDepartment({ ar: 'إدارة قديمة', en: 'Legacy' }, branches[0] ?? '');
    const [legacy] = (await chart()).departments;
    expect(legacy?.departmentCatalogId).toBeNull();
    expect(legacy?.editable).toBe(false);
  });

  it('lists only active jobs, each with its version', async () => {
    const active = await job('Driver', 'سائق');
    const stopped = await job('Old', 'قديم');
    await JobTitleModel.updateOne({ _id: stopped._id }, { $set: { status: 'inactive' } });
    const dto = await chart();
    expect(dto.jobs.map((j) => j.id)).toEqual([String(active._id)]);
    expect(dto.jobs[0]?.version).toBe(0);
  });

  it('is open to department.view and to job editors, and closed to anyone else', async () => {
    await chart(viewerToken);
    await chart(jobEditorToken);
    const denied = await request(app).get('/api/v1/platform/org-chart').set('Authorization', `Bearer ${nobodyToken}`);
    expect(denied.status).toBe(403);
    const anonymous = await request(app).get('/api/v1/platform/org-chart');
    expect(anonymous.status).toBe(401);
  });
});
