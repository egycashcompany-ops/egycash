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
  JOB_PLACES_MAX,
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
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { fillJobPlacesFromHolders, JobPlaceFillModel } from '../../src/platform/organization';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { JobOfferModel } from '../../src/modules/hr/recruitment/job-offers/job-offer.model';
import { employeeRepository } from '../../src/modules/hr/employee-management/employees/employee.repository';
import { jobOfferRepository } from '../../src/modules/hr/recruitment/job-offers/job-offer.repository';
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
    JobPlaceFillModel.deleteMany({}),
    EmployeeModel.collection.deleteMany({}),
    JobOfferModel.collection.deleteMany({}),
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


describe('job places, saved with the job (P-ORG-3 §5.2)', () => {
  const setup = async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 2));
    const treasury = await linkedSection({ ar: 'الخزينة', en: 'Treasury' }, ops.entry._id, ops.rows);
    const counting = await linkedSection({ ar: 'العد', en: 'Counting' }, ops.entry._id, ops.rows);
    return {
      ops: String(ops.entry._id),
      treasury: String(treasury._id),
      counting: String(counting._id),
      opsEntry: ops,
    };
  };
  const place = (departmentCatalogId: string, sectionCatalogId: string | null = null) => ({
    departmentCatalogId,
    sectionCatalogId,
  });
  const createJob = async (places: unknown[]) =>
    request(app)
      .post('/api/v1/platform/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: nextCode('JT-'), name: { ar: 'أمين خزينة', en: 'Cashier' }, jobGrade: 'G2', places });
  const patchJob = async (id: string, body: object, token = adminToken) =>
    request(app).patch(`/api/v1/platform/job-titles/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  it('creates a job with its places, and the detail lists them named', async () => {
    const { ops, treasury } = await setup();
    const res = await createJob([place(ops, treasury), place(ops)]);
    expect(res.status).toBe(201);
    const dto = data<JobTitleDto>(res);
    expect(dto.places.map((p) => p.section?.name.en ?? 'direct').sort()).toEqual(['Treasury', 'direct']);
    expect(dto.places.every((p) => p.shown)).toBe(true);
    // …and the chart reads the same rows.
    const job = (await chart()).jobs.find((j) => j.id === dto.id);
    expect(job?.places).toHaveLength(2);
  });

  it('an update replaces the whole set; an update without places keeps it', async () => {
    const { ops, treasury, counting } = await setup();
    const created = data<JobTitleDto>(await createJob([place(ops, treasury)]));
    const moved = await patchJob(created.id, { version: created.version, places: [place(ops, counting)] });
    expect(moved.status).toBe(200);
    expect(data<JobTitleDto>(moved).places.map((p) => p.section?.name.en)).toEqual(['Counting']);
    const renamed = await patchJob(created.id, {
      version: data<JobTitleDto>(moved).version,
      name: { ar: 'أمين', en: 'Keeper' },
    });
    expect(data<JobTitleDto>(renamed).places.map((p) => p.section?.name.en)).toEqual(['Counting']);
  });

  it('merges duplicates — a move onto a place the job already has leaves one', async () => {
    const { ops, treasury, counting } = await setup();
    const created = data<JobTitleDto>(await createJob([place(ops, treasury), place(ops, counting)]));
    const res = await patchJob(created.id, {
      version: created.version,
      places: [place(ops, counting), place(ops, counting)],
    });
    expect(res.status).toBe(200);
    expect(await JobPlaceModel.countDocuments({ jobTitleId: created.id, isDeleted: false })).toBe(1);
  });

  it('a stale version is refused, and the places it carried are rolled back with no audit row', async () => {
    const { ops, treasury, counting } = await setup();
    const created = data<JobTitleDto>(await createJob([place(ops, treasury)]));
    await patchJob(created.id, { version: created.version, jobGrade: 'G3' });
    const audits = await AuditLogModel.countDocuments({ 'entityRef.entityId': created.id });
    const stale = await patchJob(created.id, { version: created.version, places: [place(ops, counting)] });
    expect(stale.status).toBe(409);
    expect(errorCode(stale)).toBe('STALE_DOCUMENT');
    const live = await JobPlaceModel.find({ jobTitleId: created.id, isDeleted: false }).lean();
    expect(live.map((p) => String(p.sectionCatalogId))).toEqual([treasury]);
    expect(await AuditLogModel.countDocuments({ 'entityRef.entityId': created.id })).toBe(audits);
  });

  it('keeps a place under a stopped section when the form sends it back, and refuses a new one there', async () => {
    const { ops, treasury, counting } = await setup();
    const created = data<JobTitleDto>(await createJob([place(ops, treasury)]));
    await SectionModel.updateMany({ catalogId: new Types.ObjectId(treasury) }, { $set: { status: 'inactive' } });
    const kept = await patchJob(created.id, {
      version: created.version,
      places: [place(ops, treasury), place(ops, counting)],
    });
    expect(kept.status).toBe(200);
    const places = data<JobTitleDto>(kept).places;
    expect(places.find((p) => p.section?.sectionCatalogId === treasury)?.shown).toBe(false);

    const other = data<JobTitleDto>(await createJob([]));
    const refused = await patchJob(other.id, { version: other.version, places: [place(ops, treasury)] });
    expect(refused.status).toBe(422);
    expect(errorCode(refused)).toBe('JOB_PLACE_NOT_ALLOWED');
  });

  it('refuses a new place under an entry with no rows, with another department\'s section, or for an inactive job', async () => {
    const { ops, opsEntry } = await setup();
    const empty = await departmentCatalogService.create({ code: nextCode('DC-'), name: { ar: 'فارغة', en: 'Empty' } }, adminId);
    const sec = await linkedDepartment({ ar: 'الأمن', en: 'Security' }, branches.slice(0, 1));
    const guards = await linkedSection({ ar: 'الحراسة', en: 'Guards' }, sec.entry._id, sec.rows);
    void opsEntry;
    const created = data<JobTitleDto>(await createJob([]));
    for (const places of [[place(String(empty._id))], [place(ops, String(guards._id))]]) {
      const res = await patchJob(created.id, { version: created.version, places });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('JOB_PLACE_NOT_ALLOWED');
    }
    const stopping = await patchJob(created.id, { version: created.version, status: 'inactive', places: [place(ops)] });
    expect(stopping.status).toBe(422);
    expect(errorCode(stopping)).toBe('JOB_PLACE_NOT_ALLOWED');
  });

  it('needs jobTitle.edit', async () => {
    const { ops } = await setup();
    const created = data<JobTitleDto>(await createJob([]));
    const res = await patchJob(created.id, { version: created.version, places: [place(ops)] }, viewerToken);
    expect(res.status).toBe(403);
  });

  it('deleting a job removes its places, and a catalog entry with places cannot be deleted', async () => {
    const { ops, treasury } = await setup();
    const kept = data<JobTitleDto>(await createJob([place(ops, treasury)]));
    // Entries no branch declares, but a job is placed in: only the places stand in the way. (The
    // place is written through the model — the API refuses a NEW place under an entry with no rows.)
    const lone = await departmentCatalogService.create({ code: nextCode('DC-'), name: { ar: 'وحيدة', en: 'Lone' } }, adminId);
    const loneSection = await sectionCatalogService.create(
      { code: nextCode('SC-'), name: { ar: 'قسم وحيد', en: 'Lone section' }, departmentCatalogId: String(lone._id) },
      adminId,
    );
    await JobPlaceModel.create({ jobTitleId: new Types.ObjectId(kept.id), departmentCatalogId: lone._id, sectionCatalogId: loneSection._id });
    await expect(departmentCatalogService.softDelete(String(lone._id), adminId)).rejects.toMatchObject({
      code: 'ORG_CATALOG_ENTRY_IN_USE',
    });
    await expect(sectionCatalogService.softDelete(String(loneSection._id), adminId)).rejects.toMatchObject({
      code: 'ORG_CATALOG_ENTRY_IN_USE',
    });
    const res = await request(app)
      .delete(`/api/v1/platform/job-titles/${kept.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
    expect(await JobPlaceModel.countDocuments({ jobTitleId: kept.id, isDeleted: false })).toBe(0);
  });

  it('audits the places as labels on the job', async () => {
    const { ops, treasury } = await setup();
    const created = data<JobTitleDto>(await createJob([]));
    await patchJob(created.id, { version: created.version, places: [place(ops, treasury)] });
    const update = await AuditLogModel.findOne({ 'entityRef.entityId': created.id, action: 'update' }).lean();
    const change = update?.changes.find((c) => c.field === 'places');
    expect(change?.new).toEqual(['العمليات › الخزينة']);
  });
});

/**
 * «لما باجي أشد حاجة عشان أغير ترتيبها مش بتتشد» — a column's jobs in the order the editor sets
 * (P-ORG-3 §5.7). The order is the PLACE's: one job in two columns stands where each puts it.
 */
describe('the order of a column\'s jobs (P-ORG-3 §5.7)', () => {
  const setup = async () => {
    const marketing = await linkedDepartment({ ar: 'التسويق', en: 'Marketing' }, branches.slice(0, 1));
    const sales = await linkedSection({ ar: 'المبيعات', en: 'Sales' }, marketing.entry._id, marketing.rows);
    const senior = await job('Senior marketer', 'أخصائي أول تسويق');
    const manager = await job('Marketing manager', 'مدير التسويق');
    const consultant = await job('Marketing consultant', 'استشاري تسويق');
    const dept = String(marketing.entry._id);
    for (const j of [senior, manager, consultant]) {
      await JobPlaceModel.create({ jobTitleId: j._id, departmentCatalogId: marketing.entry._id, sectionCatalogId: null });
    }
    // The manager is in Sales too, so one job stands in two columns.
    await JobPlaceModel.create({ jobTitleId: manager._id, departmentCatalogId: marketing.entry._id, sectionCatalogId: sales._id });
    return { dept, sales: String(sales._id), senior: String(senior._id), manager: String(manager._id), consultant: String(consultant._id) };
  };
  const order = (body: object, token = adminToken) =>
    request(app).put('/api/v1/platform/org-chart/order').set('Authorization', `Bearer ${token}`).send(body);
  /** The column as the page sorts it: by position, unpositioned after, else the chart's job order. */
  const columnOf = (dto: OrgChartDto, dept: string, section: string | null): string[] => {
    const jobOrder = new Map(dto.jobs.map((j, i) => [j.id, i]));
    return dto.jobs
      .flatMap((j) =>
        j.places
          .filter((p) => p.departmentCatalogId === dept && p.sectionCatalogId === section)
          .map((p) => ({ id: j.id, position: p.position })),
      )
      .sort(
        (a, b) =>
          (a.position ?? Infinity) - (b.position ?? Infinity) ||
          (jobOrder.get(a.id) ?? 0) - (jobOrder.get(b.id) ?? 0),
      )
      .map((entry) => entry.id);
  };

  it('saves the new order, answers with the chart in it, and keeps the other column as it was', async () => {
    const { dept, sales, senior, manager, consultant } = await setup();
    const res = await order({ departmentCatalogId: dept, sectionCatalogId: null, jobTitleIds: [manager, senior, consultant] });
    expect(res.status).toBe(200);
    const answered = data<OrgChartDto>(res);
    expect(columnOf(answered, dept, null)).toEqual([manager, senior, consultant]);
    expect(columnOf(await chart(), dept, null)).toEqual([manager, senior, consultant]);
    // The manager's place in Sales was not touched.
    const managerInSales = answered.jobs.find((j) => j.id === manager)?.places.find((p) => p.sectionCatalogId === sales);
    expect(managerInSales?.position).toBeNull();
  });

  it('orders a section column on its own', async () => {
    const { dept, sales, manager } = await setup();
    const res = await order({ departmentCatalogId: dept, sectionCatalogId: sales, jobTitleIds: [manager] });
    expect(res.status).toBe(200);
    expect(data<OrgChartDto>(res).jobs.find((j) => j.id === manager)?.places.find((p) => p.sectionCatalogId === sales)?.position).toBe(0);
  });

  it('keeps the order through the job\'s own update, and a job added later follows the ordered ones', async () => {
    const { dept, senior, manager, consultant } = await setup();
    await order({ departmentCatalogId: dept, sectionCatalogId: null, jobTitleIds: [consultant, manager, senior] });
    // A rename of the manager sends its places back unchanged: its position stays.
    const current = await request(app).get(`/api/v1/platform/job-titles/${manager}`).set('Authorization', `Bearer ${adminToken}`);
    const dto = data<JobTitleDto>(current);
    const renamed = await request(app)
      .patch(`/api/v1/platform/job-titles/${manager}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        version: dto.version,
        name: { ar: 'مدير التسويق والتعاقدات', en: 'Marketing and contracts manager' },
        places: dto.places.map((p) => ({ departmentCatalogId: p.department.departmentCatalogId, sectionCatalogId: p.section?.sectionCatalogId ?? null })),
      });
    expect(renamed.status).toBe(200);
    const later = await job('Marketing analyst', 'محلل تسويق');
    await JobPlaceModel.create({ jobTitleId: later._id, departmentCatalogId: new Types.ObjectId(dept), sectionCatalogId: null });
    expect(columnOf(await chart(), dept, null)).toEqual([consultant, manager, senior, String(later._id)]);
  });

  it('refuses a list made from an older chart — a job missing, or one the column does not have', async () => {
    const { dept, sales, senior, manager, consultant } = await setup();
    const missing = await order({ departmentCatalogId: dept, sectionCatalogId: null, jobTitleIds: [manager, senior] });
    expect(missing.status).toBe(409);
    expect(errorCode(missing)).toBe('STALE_DOCUMENT');
    const extra = await order({ departmentCatalogId: dept, sectionCatalogId: sales, jobTitleIds: [manager, consultant] });
    expect(extra.status).toBe(409);
    // Nothing was written.
    expect(await JobPlaceModel.countDocuments({ position: { $ne: null } })).toBe(0);
  });

  it('refuses a list that names a job twice, and a section of another department', async () => {
    const { dept, senior, manager } = await setup();
    const twice = await order({ departmentCatalogId: dept, sectionCatalogId: null, jobTitleIds: [manager, manager, senior] });
    expect(twice.status).toBe(400);
    const other = await linkedDepartment({ ar: 'المالية', en: 'Finance' }, branches.slice(0, 1));
    const audit = await linkedSection({ ar: 'المراجعة', en: 'Audit' }, other.entry._id, other.rows);
    const foreign = await order({ departmentCatalogId: dept, sectionCatalogId: String(audit._id), jobTitleIds: [manager] });
    expect(foreign.status).toBe(422);
    expect(errorCode(foreign)).toBe('ORG_UNIT_NOT_EDITABLE');
  });

  it('needs jobTitle.edit: a job editor may, a chart viewer may not', async () => {
    const { dept, senior, manager, consultant } = await setup();
    const body = { departmentCatalogId: dept, sectionCatalogId: null, jobTitleIds: [consultant, senior, manager] };
    expect((await order(body, viewerToken)).status).toBe(403);
    expect((await order(body, nobodyToken)).status).toBe(403);
    expect((await order(body, jobEditorToken)).status).toBe(200);
  });

  it('audits the order on the department, before and after, by name', async () => {
    const { dept, senior, manager, consultant } = await setup();
    await order({ departmentCatalogId: dept, sectionCatalogId: null, jobTitleIds: [manager, senior, consultant] });
    const audit = await AuditLogModel.findOne({ 'entityRef.entityId': dept, action: 'update' }).lean();
    expect(audit?.entityRef.entityType).toBe('departmentCatalog');
    expect(audit?.changes[0]).toMatchObject({
      field: 'jobOrder',
      old: ['أخصائي أول تسويق', 'مدير التسويق', 'استشاري تسويق'],
      new: ['مدير التسويق', 'أخصائي أول تسويق', 'استشاري تسويق'],
    });
    // The same order again writes no second row.
    const rows = await AuditLogModel.countDocuments({ 'entityRef.entityId': dept, action: 'update' });
    await order({ departmentCatalogId: dept, sectionCatalogId: null, jobTitleIds: [manager, senior, consultant] });
    expect(await AuditLogModel.countDocuments({ 'entityRef.entityId': dept, action: 'update' })).toBe(rows);
  });
});

describe('section writes from the chart (P-ORG-3 §5.3)', () => {
  const addSection = async (body: object, token = adminToken) =>
    request(app).post('/api/v1/platform/org-chart/sections').set('Authorization', `Bearer ${token}`).send(body);

  it('adds a section in the ticked branches: one entry, linked rows with distinct codes, the chart back', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 4));
    const res = await addSection({
      departmentCatalogId: String(ops.entry._id),
      name: { ar: 'التحصيل', en: 'Collection' },
      branchIds: branches.slice(0, 3),
    });
    expect(res.status).toBe(201);
    const section = data<OrgChartDto>(res).departments[0]?.sections[0];
    expect(section?.name.en).toBe('Collection');
    expect(section?.branches).toHaveLength(3);
    const rows = await SectionModel.find({ catalogId: new Types.ObjectId(section?.sectionCatalogId ?? '') }).lean();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.code)).size).toBe(3);
  });

  it('refuses a name the department already has — by fold, and by an exact English match', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    await linkedSection({ ar: 'العد والفرز', en: 'Counting' }, ops.entry._id, ops.rows);
    for (const name of [{ ar: 'العد و الفرز', en: 'Sorting' }, { ar: 'قسم آخر', en: 'counting' }]) {
      const res = await addSection({ departmentCatalogId: String(ops.entry._id), name, branchIds: [branches[0]] });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ORG_SECTION_NAME_TAKEN');
    }
  });

  it('refuses a name an unlinked section of the department already has (no entry may absorb it)', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const row = ops.rows[0];
    const _id = new Types.ObjectId();
    await SectionModel.create({
      _id, branchId: row?.branchId, departmentId: row?._id, code: nextCode('S-'),
      name: { ar: 'الخزينه', en: 'Old treasury' }, catalogId: null, status: 'active',
      path: `${String(row?.branchId)}/${String(row?._id)}/${String(_id)}`,
    });
    const res = await addSection({
      departmentCatalogId: String(ops.entry._id),
      name: { ar: 'الخزينة', en: 'Treasury' },
      branchIds: [branches[0]],
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ORG_SECTION_NAME_TAKEN');
    expect(await SectionCatalogModel.countDocuments({})).toBe(0);
  });

  it('refuses a branch without a linked row of the department, writing nothing', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    await unlinkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches[1] ?? '');
    const res = await addSection({
      departmentCatalogId: String(ops.entry._id),
      name: { ar: 'التحصيل', en: 'Collection' },
      branchIds: [branches[0], branches[1]],
    });
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('BRANCH_WITHOUT_DEPARTMENT');
    expect(await SectionCatalogModel.countDocuments({})).toBe(0);
    expect(await SectionModel.countDocuments({})).toBe(0);
  });

  it('refuses under a stopped department entry, and needs section.create', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const body = { departmentCatalogId: String(ops.entry._id), name: { ar: 'التحصيل', en: 'Collection' }, branchIds: [branches[0]] };
    expect((await addSection(body, viewerToken)).status).toBe(403);
    await DepartmentCatalogModel.updateOne({ _id: ops.entry._id }, { $set: { status: 'inactive' } });
    const res = await addSection(body);
    expect(res.status).toBe(422);
    expect(errorCode(res)).toBe('ORG_UNIT_NOT_EDITABLE');
  });

  it('renames every row of the group, linked or not, and refuses a sibling name or a stale version', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 2));
    const treasury = await linkedSection({ ar: 'الخزينة', en: 'Treasury' }, ops.entry._id, ops.rows.slice(0, 1));
    await linkedSection({ ar: 'العد', en: 'Counting' }, ops.entry._id, ops.rows.slice(0, 1));
    // An unlinked copy in the second branch that joins the group by name.
    const second = ops.rows[1];
    const _id = new Types.ObjectId();
    await SectionModel.create({
      _id, branchId: second?.branchId, departmentId: second?._id, code: nextCode('S-'),
      name: { ar: 'الخزينه', en: 'Treasury' }, catalogId: null, status: 'active',
      path: `${String(second?.branchId)}/${String(second?._id)}/${String(_id)}`,
    });
    const url = `/api/v1/platform/org-chart/sections/${String(treasury._id)}`;
    const clash = await request(app).patch(url).set('Authorization', `Bearer ${adminToken}`).send({ name: { ar: 'العد', en: 'X' }, version: 0 });
    expect(errorCode(clash)).toBe('ORG_SECTION_NAME_TAKEN');
    const ok = await request(app).patch(url).set('Authorization', `Bearer ${adminToken}`).send({ name: { ar: 'الصندوق', en: 'Vault' }, version: 0 });
    expect(ok.status).toBe(200);
    const names = (await SectionModel.find({ departmentId: { $in: ops.rows.map((r) => r._id) } }).lean()).map((r) => r.name.en);
    expect(names.filter((n) => n === 'Vault')).toHaveLength(2);
    const stale = await request(app).patch(url).set('Authorization', `Bearer ${adminToken}`).send({ name: { ar: 'أخرى', en: 'Other' }, version: 0 });
    expect(errorCode(stale)).toBe('STALE_DOCUMENT');
  });

  it('refuses rename and stop under a department whose every row is stopped', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const treasury = await linkedSection({ ar: 'الخزينة', en: 'Treasury' }, ops.entry._id, ops.rows);
    await DepartmentModel.updateMany({ catalogId: ops.entry._id }, { $set: { status: 'inactive' } });
    const url = `/api/v1/platform/org-chart/sections/${String(treasury._id)}`;
    const rename = await request(app).patch(url).set('Authorization', `Bearer ${adminToken}`).send({ name: { ar: 'الصندوق', en: 'Vault' }, version: 0 });
    expect(errorCode(rename)).toBe('ORG_UNIT_NOT_EDITABLE');
    const stop = await request(app).post(`${url}/stop`).set('Authorization', `Bearer ${adminToken}`).send({ version: 0 });
    expect(errorCode(stop)).toBe('ORG_UNIT_NOT_EDITABLE');
    expect(await SectionModel.countDocuments({ catalogId: treasury._id, status: 'active', 'name.en': 'Treasury' })).toBe(1);
  });

  it('stop deactivates every row, keeps the entry active and the places, and lists the rows it stopped', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 2));
    const treasury = await linkedSection({ ar: 'الخزينة', en: 'Treasury' }, ops.entry._id, ops.rows);
    const cashier = await job('Cashier', 'أمين خزينة');
    await JobPlaceModel.create({ jobTitleId: cashier._id, departmentCatalogId: ops.entry._id, sectionCatalogId: treasury._id });
    const res = await request(app)
      .post(`/api/v1/platform/org-chart/sections/${String(treasury._id)}/stop`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ version: 0 });
    expect(res.status).toBe(200);
    expect(data<OrgChartDto>(res).departments[0]?.sections).toHaveLength(0);
    expect(await SectionModel.countDocuments({ catalogId: treasury._id, status: 'active' })).toBe(0);
    expect((await SectionCatalogModel.findById(treasury._id).lean())?.status).toBe('active');
    expect(await JobPlaceModel.countDocuments({ sectionCatalogId: treasury._id, isDeleted: false })).toBe(1);
    const audit = await AuditLogModel.findOne({ 'entityRef.entityId': String(treasury._id), action: 'update' }).lean();
    expect((audit?.changes.find((c) => c.field === 'stoppedRows')?.new as string[]).length).toBe(2);
  });
});

describe('a new department or section is linked when created (P-ORG-3 §5.6, D-ORG3-5)', () => {
  const createDepartment = async (branchId: string, name: { ar: string; en: string }) =>
    request(app)
      .post('/api/v1/platform/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: nextCode('ND-'), branchId, name });

  it('links to the entry its name folds to, and creates one for a new name', async () => {
    const ops = await linkedDepartment({ ar: 'نقل الأموال', en: 'Cash' }, branches.slice(0, 1));
    const joined = await createDepartment(branches[1] ?? '', { ar: 'نقل الاموال', en: 'Cash transfer' });
    expect(joined.status).toBe(201);
    expect(data<{ catalogId: string | null }>(joined).catalogId).toBe(String(ops.entry._id));

    const fresh = await createDepartment(branches[1] ?? '', { ar: 'الجودة', en: 'Quality' });
    const entryId = data<{ catalogId: string | null }>(fresh).catalogId;
    expect(entryId).not.toBeNull();
    // A department that exists from now has nobody to fill from: marked at once (§7).
    const { JobPlaceFillModel } = await import('../../src/platform/organization');
    expect(await JobPlaceFillModel.countDocuments({ departmentCatalogId: new Types.ObjectId(entryId ?? '') })).toBe(1);
  });

  it('leaves the row unlinked when an unlinked row of that name already exists', async () => {
    await unlinkedDepartment({ ar: 'قديمة', en: 'Old' }, branches[0] ?? '');
    const res = await createDepartment(branches[1] ?? '', { ar: 'قديمة', en: 'Old' });
    expect(res.status).toBe(201);
    expect(data<{ catalogId: string | null }>(res).catalogId).toBeNull();
    expect(await DepartmentCatalogModel.countDocuments({})).toBe(0);
  });

  it('links a new section under its department entry', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const res = await request(app)
      .post('/api/v1/platform/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: nextCode('NS-'), departmentId: String(ops.rows[0]?._id), name: { ar: 'الحسابات', en: 'Accounts' } });
    expect(res.status).toBe(201);
    const entryId = data<{ catalogId: string | null }>(res).catalogId;
    const entry = await SectionCatalogModel.findById(entryId).lean();
    expect(String(entry?.departmentCatalogId)).toBe(String(ops.entry._id));
  });
});


describe('the one-time fill from where holders sit (P-ORG-3 §7)', () => {
  /** HR's own readers — what the seed hands the platform. */
  const holders = async () => [
    ...(await employeeRepository.jobUnitsHeldSystem()),
    ...(await jobOfferRepository.jobUnitsAcceptedSystem()),
  ];
  const fill = () => fillJobPlacesFromHolders(holders);

  const employee = async (
    department: Types.ObjectId,
    section: Types.ObjectId | null,
    jobTitleId: Types.ObjectId,
    status = 'active',
  ) =>
    EmployeeModel.collection.insertOne({
      isDeleted: false,
      code: nextCode('EMP-'),
      status,
      employment: { departmentId: department, sectionId: section, jobTitleId, branchId: new Types.ObjectId() },
    });

  const offer = async (department: Types.ObjectId, jobTitleId: Types.ObjectId, supersededAt: Date | null = null) =>
    JobOfferModel.collection.insertOne({
      isDeleted: false,
      status: 'accepted',
      hiredEmployeeId: null,
      supersededAt,
      terms: { departmentId: department, sectionId: null, jobTitleId },
    });

  const placesOf = async (jobId: Types.ObjectId) =>
    (await JobPlaceModel.find({ jobTitleId: jobId, isDeleted: false }).lean()).map((p) =>
      p.sectionCatalogId === null ? 'direct' : String(p.sectionCatalogId),
    );

  it('places each job where its holders sit, sections included, and skips what it must', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 2));
    const treasury = await linkedSection({ ar: 'الخزينة', en: 'Treasury' }, ops.entry._id, ops.rows);
    const treasuryRow = await SectionModel.findOne({ catalogId: treasury._id }).lean();
    const legacy = await unlinkedDepartment({ ar: 'قديمة', en: 'Legacy' }, branches[2] ?? '');
    const [cashier, driver, recruit, gone, legacyJob, stopped] = await Promise.all([
      job('Cashier', 'أمين خزينة'),
      job('Driver', 'سائق'),
      job('Recruit', 'مرشح'),
      job('Gone', 'سابق'),
      job('Legacy', 'قديم'),
      job('Stopped', 'موقوف'),
    ]);
    await JobTitleModel.updateOne({ _id: stopped._id }, { $set: { status: 'inactive' } });
    const deptRow = ops.rows[0]?._id ?? new Types.ObjectId();
    await employee(deptRow, treasuryRow?._id ?? null, cashier._id);
    await employee(deptRow, treasuryRow?._id ?? null, cashier._id); // the same triple twice
    await employee(deptRow, null, driver._id);
    await employee(deptRow, null, gone._id, 'exited');
    await employee(legacy._id, null, legacyJob._id);
    await employee(deptRow, null, stopped._id);
    await offer(deptRow, recruit._id);
    const supersededJob = await job('Superseded', 'ملغى');
    await offer(deptRow, supersededJob._id, new Date());

    const result = await fill();
    expect(result).toMatchObject({ departments: 1, placed: 3 });
    expect(await placesOf(cashier._id)).toEqual([String(treasury._id)]);
    expect(await placesOf(driver._id)).toEqual(['direct']);
    expect(await placesOf(recruit._id)).toEqual(['direct']);
    expect(await placesOf(gone._id)).toEqual([]);
    expect(await placesOf(legacyJob._id)).toEqual([]);
    expect(await placesOf(stopped._id)).toEqual([]);
    expect(await placesOf(supersededJob._id)).toEqual([]);
    const audit = await AuditLogModel.findOne({ 'entityRef.entityId': String(cashier._id), action: 'update' }).lean();
    expect(audit?.changes.find((c) => c.field === 'places')?.new).toEqual(['العمليات › الخزينة']);
  });

  it('a section row outside its department falls back to directly under the department', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const sec = await linkedDepartment({ ar: 'الأمن', en: 'Security' }, branches.slice(0, 1));
    const guards = await linkedSection({ ar: 'الحراسة', en: 'Guards' }, sec.entry._id, sec.rows);
    const guardsRow = await SectionModel.findOne({ catalogId: guards._id }).lean();
    const driver = await job('Driver', 'سائق');
    await employee(ops.rows[0]?._id ?? new Types.ObjectId(), guardsRow?._id ?? null, driver._id);
    await fill();
    expect(await placesOf(driver._id)).toEqual(['direct']);
  });

  it('runs once: a second run does nothing, even after a place is removed', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const driver = await job('Driver', 'سائق');
    await employee(ops.rows[0]?._id ?? new Types.ObjectId(), null, driver._id);
    await fill();
    await JobPlaceModel.updateMany({ jobTitleId: driver._id }, { $set: { isDeleted: true } });
    expect(await fill()).toBeNull();
    expect(await placesOf(driver._id)).toEqual([]);
  });

  it('fills a department linked later at the next run, but never one edited by hand', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const driver = await job('Driver', 'سائق');
    await fill(); // marks Operations (nobody sits there yet)
    const later = await linkedDepartment({ ar: 'الحركة', en: 'Movement' }, branches.slice(0, 1));
    const edited = await linkedDepartment({ ar: 'الأمن', en: 'Security' }, branches.slice(0, 1));
    await JobPlaceModel.create({ jobTitleId: driver._id, departmentCatalogId: edited.entry._id, sectionCatalogId: null, isDeleted: true });
    await employee(later.rows[0]?._id ?? new Types.ObjectId(), null, driver._id);
    await employee(edited.rows[0]?._id ?? new Types.ObjectId(), null, driver._id);
    await employee(ops.rows[0]?._id ?? new Types.ObjectId(), null, driver._id);
    const result = await fill();
    expect(result).toMatchObject({ departments: 2, placed: 1 });
    const live = await JobPlaceModel.find({ jobTitleId: driver._id, isDeleted: false }).lean();
    expect(live.map((p) => String(p.departmentCatalogId))).toEqual([String(later.entry._id)]);
  });

  it('audits the job\'s whole set, the places it already had included', async () => {
    const security = await linkedDepartment({ ar: 'الأمن', en: 'Security' }, branches.slice(0, 1));
    const driver = await job('Driver', 'سائق');
    await fill(); // marks Security
    await JobPlaceModel.create({ jobTitleId: driver._id, departmentCatalogId: security.entry._id, sectionCatalogId: null });
    const movement = await linkedDepartment({ ar: 'الحركة', en: 'Movement' }, branches.slice(0, 1));
    await employee(movement.rows[0]?._id ?? new Types.ObjectId(), null, driver._id);
    await fill();
    const audit = await AuditLogModel.findOne({ 'entityRef.entityId': String(driver._id), action: 'update' }).lean();
    const change = audit?.changes.find((c) => c.field === 'places');
    expect(change?.old).toEqual(['الأمن']);
    expect(change?.new).toEqual(['الأمن', 'الحركة']);
  });

  it('leaves unplaced a job whose holders sit in more places than a job may have', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const row = ops.rows[0];
    const everywhere = await job('Clerk', 'كاتب');
    const driver = await job('Driver', 'سائق');
    for (let i = 0; i <= JOB_PLACES_MAX; i += 1) {
      const section = await linkedSection({ ar: `قسم ${i}`, en: `Section ${i}` }, ops.entry._id, ops.rows);
      const sectionRow = await SectionModel.findOne({ catalogId: section._id }).lean();
      await employee(row?._id ?? new Types.ObjectId(), sectionRow?._id ?? null, everywhere._id);
    }
    await employee(row?._id ?? new Types.ObjectId(), null, driver._id);
    const result = await fill();
    expect(result).toMatchObject({ departments: 1, placed: 1, skipped: JOB_PLACES_MAX + 1 });
    expect(await placesOf(everywhere._id)).toEqual([]);
    expect(await placesOf(driver._id)).toEqual(['direct']);
  });

  it('two runs at once: exactly one commits the marks', async () => {
    const ops = await linkedDepartment({ ar: 'العمليات', en: 'Operations' }, branches.slice(0, 1));
    const driver = await job('Driver', 'سائق');
    await employee(ops.rows[0]?._id ?? new Types.ObjectId(), null, driver._id);
    const results = await Promise.all([fill(), fill()]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await JobPlaceFillModel.countDocuments({})).toBe(1);
    expect(await JobPlaceModel.countDocuments({ jobTitleId: driver._id, isDeleted: false })).toBe(1);
  });
});
