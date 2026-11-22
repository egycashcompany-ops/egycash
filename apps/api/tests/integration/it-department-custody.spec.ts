// Department custody at a place, over real HTTP with real RBAC (2026-11-19) — «عند تسليم الأصول
// والمستهلكات يكون فى إمكانية إنى مأسلمش لموظف ولكن أعينها فى مكان بس تبقى على عهده الإدارة .. زى
// السيرفرات والكاميرات والسويتشات وهكذا». His answers: the custodian is a DEPARTMENT chosen at the
// hand-over; the PLACE comes from the branch's «المواقع»; and the paper — a department custody
// receipt naming the department and the place — is signed by the department's responsible person.
//
// What a mocked spec cannot see: the department and place read from their own collections and
// refused on their own fields; the interval, the paper and the asset row written in one
// transaction and read back through every reader (the asset's holder, the asset list's filters,
// the custody register's filters, the person page, the audit trail); the partial indexes serving
// the reads; a place's branch held against the asset's on the way in and on every transfer.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type ApiErrorDetail,
  type ItAssetAssignmentDto,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItCustodyReceiptDocumentDto,
  type ItCustodyReceiptDto,
  type ItHandOverResultDto,
  type ItPersonDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { itAssetCustodyService } from '../../src/modules/it/assets/custody.service';
import { ItLocationModel } from '../../src/modules/it/locations/location.model';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { DepartmentModel } from '../../src/platform/organization/departments/department.model';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
/** `itAsset.view` + `itAsset.assign` at BRANCH scope, placed in October. */
let keeperOctoberToken: string;
let octoberId: string;
let tantaId: string;
let itDepartmentId: string;
let tantaDepartmentId: string;
let closedDepartmentId: string;
let serverRoomId: string;
let cameraRoomId: string;
let tantaRoomId: string;
let retiredRoomId: string;
let categoryId: string;

// The people: the responsible person who signs (placed in Tanta, so the October keeper reaches
// them only through what their own registers name), a second signer, an employee, a leaver.
const SIGNER = new Types.ObjectId();
const SECOND_SIGNER = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();
const LEAVER = new Types.ObjectId();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-department-custody-test-${Date.now()}`;
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
      organization: { branchId, departmentId: null, sectionId: null, jobTitleId: null },
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
const failure = (res: request.Response) =>
  (res.body as { error: { code: string; message: string; details?: ApiErrorDetail[] } }).error;
/** The field and code of a 422 field issue. */
const issue = (res: request.Response) => {
  expect(res.status).toBe(422);
  const [detail] = failure(res).details ?? [];
  return { field: detail?.field, code: detail?.code };
};

/** An HR employee placed in `branchId`, written as HR stores one. */
const plantEmployee = async (
  _id: Types.ObjectId,
  code: string,
  fullNameAr: string,
  branchId: string,
  status: 'active' | 'exited' = 'active',
): Promise<void> => {
  const branch = new Types.ObjectId(branchId);
  const department = new Types.ObjectId();
  await EmployeeModel.collection.insertOne({
    _id,
    employeeNumber: code.slice(-4),
    code,
    status,
    personal: { fullNameAr, nationalId: '28001010101010' },
    employment: {
      jobTitleId: new Types.ObjectId(),
      departmentId: department,
      sectionId: null,
      branchId: branch,
    },
    branchId: branch,
    departmentId: department,
    sectionId: null,
    userId: null,
    exit: null,
    hiredAt: new Date('2024-01-01T00:00:00.000Z'),
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

/** A place of a branch's «المواقع», written as the catalog writes one. */
const plantPlace = async (branchId: string, ar: string, en: string, isActive = true) => {
  const place = await ItLocationModel.create({
    branchId: new Types.ObjectId(branchId),
    name: { ar, en },
    code: null,
    description: null,
    sortOrder: 0,
    isActive,
  });
  return String(place._id);
};

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
};

let serials = 0;
const device = async (branchId = octoberId, name = 'Dell PowerEdge R740'): Promise<ItAssetDto> => {
  serials += 1;
  const res = await api.post('/assets', {
    name: `${name} ${String(serials)}`,
    categoryId,
    branchId,
  });
  expect(res.status).toBe(201);
  return data<ItAssetDto>(res);
};

const itDepartment = (over: Record<string, string> = {}) => ({
  departmentId: itDepartmentId,
  locationId: serverRoomId,
  responsibleEmployeeId: String(SIGNER),
  ...over,
});

/** Hand `assets` to IT at the server room on ONE paper; the paper. */
const handToIt = async (
  assets: readonly ItAssetDto[],
  over: Record<string, string> = {},
  token = adminToken,
): Promise<ItHandOverResultDto> => {
  const res = await api.post(
    '/custody-receipts',
    {
      department: itDepartment(over),
      lines: assets.map((asset) => ({ assetId: asset.id, conditionOnIssue: 'جديد' })),
    },
    token,
  );
  expect(res.status).toBe(201);
  return data<ItHandOverResultDto>(res);
};

const asset = async (id: string): Promise<ItAssetDto> =>
  data<ItAssetDto>(await api.get(`/assets/${id}`));
const intervalsOf = async (id: string): Promise<ItAssetAssignmentDto[]> =>
  data<ItAssetAssignmentDto[]>(await api.get(`/assets/${id}/assignments`));
const idsOf = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id).sort();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('department-custody-admin@ecms.local');
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
  adminToken = await login('department-custody-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  octoberId = await post('/platform/branches', {
    code: '87',
    name: { ar: 'أكتوبر', en: 'October' },
  });
  tantaId = await post('/platform/branches', { code: '88', name: { ar: 'طنطا', en: 'Tanta' } });
  itDepartmentId = await post('/platform/departments', {
    code: 'DC-IT',
    name: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
    branchId: octoberId,
  });
  tantaDepartmentId = await post('/platform/departments', {
    code: 'DC-T-IT',
    name: { ar: 'تكنولوجيا المعلومات — طنطا', en: 'IT, Tanta' },
    branchId: tantaId,
  });
  closedDepartmentId = await post('/platform/departments', {
    code: 'DC-OLD',
    name: { ar: 'إدارة ملغاة', en: 'Closed department' },
    branchId: octoberId,
  });
  await DepartmentModel.updateOne(
    { _id: closedDepartmentId },
    { $set: { status: 'inactive' } },
  ).exec();

  serverRoomId = await plantPlace(octoberId, 'غرفة السيرفرات', 'Server room');
  cameraRoomId = await plantPlace(octoberId, 'غرفة الكاميرات', 'Camera room');
  tantaRoomId = await plantPlace(tantaId, 'غرفة السيرفرات', 'Server room');
  retiredRoomId = await plantPlace(octoberId, 'المخزن القديم', 'Old store', false);

  await plantEmployee(SIGNER, '0311001', 'وليد صفوت جلال', tantaId);
  await plantEmployee(SECOND_SIGNER, '0311002', 'شريف ممدوح فاروق', octoberId);
  await plantEmployee(EMPLOYEE, '0311003', 'سامح نبيل عزت', octoberId);
  await plantEmployee(LEAVER, '0311004', 'ماجد رشدي حلمي', octoberId, 'exited');

  const role = await rbacService.createRole(
    {
      name: { en: 'Keeper, October', ar: 'أمين عهد أكتوبر' },
      permissionKeys: ['itAsset.view', 'itAsset.assign'],
    },
    adminId,
  );
  const keeperId = await mkUser('department-custody-keeper@ecms.local', octoberId);
  await rbacService.ensureAssignment(keeperId, String(role._id), 'branch');
  keeperOctoberToken = await login('department-custody-keeper@ecms.local');

  const category = await api.post('/catalog-items', {
    kind: 'assetCategory',
    name: { ar: 'خوادم', en: 'Servers' },
  });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('a hand-over to a department at a place — «في عهدة إدارة … — الموقع …»', () => {
  it('prints the department paper first, then hands over on it — signed by the responsible person', async () => {
    const server = await device();
    const nvr = await device(octoberId, 'Hikvision NVR');
    const body = {
      department: itDepartment(),
      lines: [{ assetId: server.id }, { assetId: nvr.id }],
    };

    const preview = await api.post('/custody-receipts/preview', body);
    expect(preview.status).toBe(200);
    const paper = data<ItCustodyReceiptDocumentDto>(preview);
    // The signer's own fields, and the department and place it is for.
    expect(paper.employeeId).toBe(String(SIGNER));
    expect(paper.employeeName).toBe('وليد صفوت جلال');
    expect(paper.custodian).toEqual({
      departmentId: itDepartmentId,
      departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
      locationId: serverRoomId,
      locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
    });
    expect((await asset(server.id)).status).toBe('inStock');

    const handed = await api.post('/custody-receipts', { ...body, formNumber: paper.formNumber });
    expect(handed.status).toBe(201);
    const { receipt, assets } = data<ItHandOverResultDto>(handed);
    expect(receipt.formNumber).toBe(paper.formNumber);
    expect(receipt.employeeId).toBe(String(SIGNER));
    expect(receipt.custodian).toEqual(paper.custodian);
    // The paper's branch is the place's — every line's too.
    expect(receipt.branchId).toBe(octoberId);

    // The asset names the department — never the signer as its holder.
    for (const handedAsset of assets) {
      expect(handedAsset.status).toBe('assigned');
      expect(handedAsset.holder).toMatchObject({
        kind: 'department',
        employeeId: null,
        employeeName: null,
        departmentId: itDepartmentId,
        departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
        locationId: serverRoomId,
        locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
        responsibleEmployeeId: String(SIGNER),
        responsibleEmployeeCode: '0311001',
        responsibleEmployeeName: 'وليد صفوت جلال',
      });
    }
    const [interval] = await intervalsOf(server.id);
    expect(interval).toMatchObject({
      holderKind: 'department',
      assignedToEmployeeId: null,
      departmentId: itDepartmentId,
      locationId: serverRoomId,
      responsibleEmployeeId: String(SIGNER),
      receiptId: receipt.id,
      receiptSigned: false,
    });

    // The signed copy uploads as any paper's.
    const uploaded = await request(app)
      .post(`/api/v1/it/custody-receipts/${receipt.id}/signed-copy`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'signed.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    expect(data<ItCustodyReceiptDto>(uploaded).signedCopy?.mime).toBe('image/png');
    expect((await intervalsOf(server.id))[0]?.receiptSigned).toBe(true);
  });

  it('refuses a department, a place or a signer that is not live — on its own field', async () => {
    const server = await device();
    const lines = [{ assetId: server.id }];
    const hand = (over: Record<string, string>) =>
      api.post('/custody-receipts', { department: itDepartment(over), lines });

    expect(issue(await hand({ departmentId: String(new Types.ObjectId()) }))).toEqual({
      field: 'body.department.departmentId',
      code: 'UNKNOWN',
    });
    expect(issue(await hand({ departmentId: closedDepartmentId }))).toEqual({
      field: 'body.department.departmentId',
      code: 'INACTIVE',
    });
    expect(issue(await hand({ locationId: String(new Types.ObjectId()) }))).toEqual({
      field: 'body.department.locationId',
      code: 'UNKNOWN',
    });
    expect(issue(await hand({ locationId: retiredRoomId }))).toEqual({
      field: 'body.department.locationId',
      code: 'INACTIVE',
    });
    const leaver = await hand({ responsibleEmployeeId: String(LEAVER) });
    expect(leaver.status).toBe(422);
    expect(failure(leaver).message).toMatch(/signed for by a current employee/);
    // The preview refuses exactly what the hand-over would.
    expect(
      issue(
        await api.post('/custody-receipts/preview', {
          department: itDepartment({ locationId: retiredRoomId }),
          lines,
        }),
      ),
    ).toEqual({ field: 'body.department.locationId', code: 'INACTIVE' });
    // Nothing was handed over.
    expect((await asset(server.id)).status).toBe('inStock');
    expect(await intervalsOf(server.id)).toHaveLength(0);
  });

  it('names one place per paper: a place in another branch, or lines from two branches, are refused', async () => {
    const october = await device();
    const tanta = await device(tantaId);
    // A Tanta asset kept at an October place.
    const elsewhere = await api.post('/custody-receipts', {
      department: itDepartment(),
      lines: [{ assetId: tanta.id }],
    });
    expect(issue(elsewhere)).toEqual({ field: 'body.department.locationId', code: 'OTHER_BRANCH' });
    // Two branches on one paper — the asset outside the place's branch named.
    const mixed = await api.post('/custody-receipts/preview', {
      department: itDepartment(),
      lines: [{ assetId: october.id }, { assetId: tanta.id }],
    });
    expect(issue(mixed).code).toBe('OTHER_BRANCH');
    expect(failure(mixed).message).toContain(tanta.assetCode);
    expect(failure(mixed).message).not.toContain(october.assetCode);
    // Any department, in any branch: head office's IT may hold Tanta's server — at a Tanta place.
    const tantaPaper = await api.post('/custody-receipts', {
      department: itDepartment({ locationId: tantaRoomId }),
      lines: [{ assetId: tanta.id }],
    });
    expect(tantaPaper.status).toBe(201);
    expect(data<ItHandOverResultDto>(tantaPaper).receipt.branchId).toBe(tantaId);
  });

  it('a body naming both an employee and a department, or neither, is refused by the contract', async () => {
    const server = await device();
    const both = await api.post('/custody-receipts', {
      employeeId: String(EMPLOYEE),
      department: itDepartment(),
      lines: [{ assetId: server.id }],
    });
    expect(both.status).toBe(400);
    const neither = await api.post('/custody-receipts', { lines: [{ assetId: server.id }] });
    expect(neither.status).toBe(400);
  });
});

describe('transfers — department ↔ employee, another room, signing again', () => {
  it('moves a department’s server to a person and back, each on a new paper', async () => {
    const server = await device();
    await handToIt([server]);

    // The paper printed for a transfer refuses the holder it already has.
    const sameHolder = await api.post('/custody-receipts/preview', {
      kind: 'transfer',
      department: itDepartment(),
      lines: [{ assetId: server.id }],
    });
    expect(sameHolder.status).toBe(422);
    expect(failure(sameHolder).message).toMatch(/already held by this department at this place/);

    // Department → employee.
    const toPerson = await api.post(`/assets/${server.id}/transfer`, {
      toEmployeeId: String(EMPLOYEE),
    });
    expect(toPerson.status).toBe(200);
    expect(data<ItAssetDto>(toPerson).holder).toMatchObject({
      kind: 'employee',
      employeeId: String(EMPLOYEE),
      departmentId: null,
      locationId: null,
    });

    // Employee → department, at the camera room this time.
    const toDepartment = await api.post(`/assets/${server.id}/transfer`, {
      toDepartment: itDepartment({ locationId: cameraRoomId }),
    });
    expect(toDepartment.status).toBe(200);
    expect(data<ItAssetDto>(toDepartment).holder).toMatchObject({
      kind: 'department',
      employeeId: null,
      locationId: cameraRoomId,
      locationName: { ar: 'غرفة الكاميرات', en: 'Camera room' },
    });

    // Another room — a new holder — and then signing again with a new responsible person.
    const room = await api.post(`/assets/${server.id}/transfer`, {
      toDepartment: itDepartment({ locationId: serverRoomId }),
    });
    expect(room.status).toBe(200);
    const resigned = await api.post(`/assets/${server.id}/transfer`, {
      toDepartment: itDepartment({ responsibleEmployeeId: String(SECOND_SIGNER) }),
    });
    expect(resigned.status).toBe(200);
    expect(data<ItAssetDto>(resigned).holder).toMatchObject({
      responsibleEmployeeId: String(SECOND_SIGNER),
      responsibleEmployeeName: 'شريف ممدوح فاروق',
    });
    // The same department, place and signer again changes nothing.
    const nothing = await api.post(`/assets/${server.id}/transfer`, {
      toDepartment: itDepartment({ responsibleEmployeeId: String(SECOND_SIGNER) }),
    });
    expect(nothing.status).toBe(422);
    expect(failure(nothing).message).toMatch(/changes neither/);

    // Five intervals, each on its own paper — nothing carried over between holders.
    const chain = await intervalsOf(server.id);
    expect(chain).toHaveLength(5);
    expect(new Set(chain.map((row) => row.receiptId)).size).toBe(5);
    expect(chain.filter((row) => row.holderKind === 'employee')).toHaveLength(1);
    expect(chain.filter((row) => row.returnedAt === null)).toHaveLength(1);
    const latest = chain.find((row) => row.returnedAt === null);
    const paper = data<ItCustodyReceiptDto>(
      await api.get(`/custody-receipts/${latest?.receiptId ?? ''}`),
    );
    expect(paper.employeeId).toBe(String(SECOND_SIGNER));
    expect(paper.custodian?.locationId).toBe(serverRoomId);
  });

  it('a place does not travel: another branch alone is refused, a place there is required to be there', async () => {
    const server = await device();
    await handToIt([server]);

    const alone = await api.post(`/assets/${server.id}/transfer`, { toBranchId: tantaId });
    expect(alone.status).toBe(422);
    expect(failure(alone).message).toMatch(/held by a department at a place in its branch/);
    // An October place for Tanta.
    expect(
      issue(
        await api.post(`/assets/${server.id}/transfer`, {
          toBranchId: tantaId,
          toDepartment: itDepartment({ locationId: cameraRoomId }),
        }),
      ),
    ).toEqual({ field: 'body.toDepartment.locationId', code: 'OTHER_BRANCH' });
    // A retired place is refused on the transfer too.
    expect(
      issue(
        await api.post(`/assets/${server.id}/transfer`, {
          toDepartment: itDepartment({ locationId: retiredRoomId }),
        }),
      ),
    ).toEqual({ field: 'body.toDepartment.locationId', code: 'INACTIVE' });

    // Tanta, with Tanta's department and place: it goes.
    const moved = await api.post(`/assets/${server.id}/transfer`, {
      toBranchId: tantaId,
      toDepartment: itDepartment({ departmentId: tantaDepartmentId, locationId: tantaRoomId }),
    });
    expect(moved.status).toBe(200);
    expect(data<ItAssetDto>(moved)).toMatchObject({
      branchId: tantaId,
      holder: { kind: 'department', departmentId: tantaDepartmentId, locationId: tantaRoomId },
    });
  });

  it('«نقل إلى فرع» refuses a department-held asset, naming it — and moves nothing', async () => {
    const server = await device();
    const shelved = await device();
    await handToIt([server]);
    const res = await api.post('/assets/move-branch', {
      assetIds: [server.id, shelved.id],
      toBranchId: tantaId,
    });
    expect(res.status).toBe(422);
    expect(failure(res).message).toContain(
      `asset ${server.assetCode} is held by a department at a place in its branch`,
    );
    expect((await asset(shelved.id)).branchId).toBe(octoberId);
  });

  it('returns a department’s asset to stock — the history names the department', async () => {
    const server = await device();
    await handToIt([server]);
    const returned = await api.post(`/assets/${server.id}/return`, { conditionOnReturn: 'سليم' });
    expect(returned.status).toBe(200);
    expect(data<ItAssetDto>(returned)).toMatchObject({ status: 'inStock', holder: null });
    const history = data<{ type: string; metadata: Record<string, unknown> }[]>(
      await api.get(`/assets/${server.id}/history`),
    );
    expect(history.find((entry) => entry.type === 'returned')?.metadata).toMatchObject({
      holderKind: 'department',
      departmentId: itDepartmentId,
      locationId: serverRoomId,
    });
  });
});

describe('the readers — filters by department, place and kind', () => {
  let atServerRoom: ItAssetDto;
  let atCameraRoom: ItAssetDto;
  let withPerson: ItAssetDto;

  beforeAll(async () => {
    atServerRoom = await device(octoberId, 'Readers server');
    atCameraRoom = await device(octoberId, 'Readers camera');
    withPerson = await device(octoberId, 'Readers laptop');
    await handToIt([atServerRoom]);
    await handToIt([atCameraRoom], { locationId: cameraRoomId });
    const handed = await api.post('/custody-receipts', {
      employeeId: String(EMPLOYEE),
      lines: [{ assetId: withPerson.id }],
    });
    expect(handed.status).toBe(201);
  });

  const listed = async (query: string): Promise<string[]> =>
    data<ItAssetDto[]>(await api.get(`/assets?pageSize=100&search=Readers&${query}`))
      .map((row) => row.id)
      .sort();

  it('the asset list: «الموقع», «الإدارة» and «جهة الاستلام» — the OPEN interval, intersecting', async () => {
    expect(await listed(`locationId=${serverRoomId}`)).toEqual([atServerRoom.id]);
    expect(await listed(`holderDepartmentId=${itDepartmentId}`)).toEqual(
      [atServerRoom.id, atCameraRoom.id].sort(),
    );
    expect(await listed('holderKind=department')).toEqual(
      [atServerRoom.id, atCameraRoom.id].sort(),
    );
    expect(await listed('holderKind=employee')).toEqual([withPerson.id]);
    // Intersecting, not overwriting.
    expect(await listed(`holderDepartmentId=${itDepartmentId}&locationId=${cameraRoomId}`)).toEqual(
      [atCameraRoom.id],
    );
    expect(await listed(`holderKind=employee&locationId=${serverRoomId}`)).toEqual([]);
    // The signer holds nothing of their own.
    expect(await listed(`holderEmployeeId=${String(SIGNER)}`)).toEqual([]);
  });

  it('the custody register: by department, place, kind and signer — and «حالة المستلِم» leaves departments out', async () => {
    const register = async (query: string): Promise<ItAssetAssignmentDto[]> =>
      data<ItAssetAssignmentDto[]>(
        await api.get(`/assignments?open=true&pageSize=100&search=Readers&${query}`),
      );
    expect(idsOf(await register(`locationId=${serverRoomId}`)).length).toBe(1);
    expect((await register(`locationId=${serverRoomId}`))[0]?.assetId).toBe(atServerRoom.id);
    expect((await register(`departmentId=${itDepartmentId}`)).map((r) => r.assetId).sort()).toEqual(
      [atServerRoom.id, atCameraRoom.id].sort(),
    );
    expect((await register('holderKind=employee')).map((r) => r.assetId)).toEqual([withPerson.id]);
    expect(
      (await register(`responsibleEmployeeId=${String(SIGNER)}`)).map((r) => r.assetId).sort(),
    ).toEqual([atServerRoom.id, atCameraRoom.id].sort());
    // Their own custody is not what they signed for.
    expect(await register(`employeeId=${String(SIGNER)}`)).toEqual([]);
    // EMPLOYEE custody either way: a department's interval is neither «ترك العمل» nor «على رأس العمل».
    const working = await register('holderExited=false');
    expect(working.map((r) => r.assetId)).toEqual([withPerson.id]);
    expect(await register('holderExited=true')).toEqual([]);
    // Every row labels its department, place and signer.
    expect((await register(`locationId=${cameraRoomId}`))[0]).toMatchObject({
      departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
      locationName: { ar: 'غرفة الكاميرات', en: 'Camera room' },
      responsibleEmployeeName: 'وليد صفوت جلال',
      assignedToEmployeeName: null,
    });
  });

  it('the signer’s page opens for a keeper whose register names them — they work in another branch', async () => {
    // The keeper in October cannot find a Tanta employee by searching…
    const box = await api.get('/people?search=0311001&status=all', keeperOctoberToken);
    expect(data<ItPersonDto[]>(box)).toEqual([]);
    // …but the department custody they signed for in October names them.
    const page = await api.get(`/people/${String(SIGNER)}`, keeperOctoberToken);
    expect(page.status).toBe(200);
    // Not counted as their own custody.
    expect(data<ItPersonDto>(page)).toMatchObject({
      employeeId: String(SIGNER),
      openCustodyCount: 0,
    });
  });

  it('the dashboard: «مُسلَّم» counts department custody, «آخر الحركات» names the department', async () => {
    const shown = await device(octoberId, 'Dashboard camera');
    await handToIt([shown], { locationId: cameraRoomId });
    const counts = data<{ totals: { assigned: number } }>(
      await api.get(`/dashboard/assets?branchId=${octoberId}`),
    );
    expect(counts.totals.assigned).toBeGreaterThanOrEqual(3);
    const activity = data<{
      items: {
        assetId: string;
        kind: string;
        employeeId: string | null;
        departmentId: string | null;
        departmentName: { ar: string } | null;
        locationName: { ar: string } | null;
      }[];
    }>(await api.get('/dashboard/activity'));
    expect(
      activity.items.find((item) => item.assetId === shown.id && item.kind === 'assigned'),
    ).toMatchObject({
      employeeId: null,
      departmentId: itDepartmentId,
      departmentName: { ar: 'تكنولوجيا المعلومات' },
      locationName: { ar: 'غرفة الكاميرات' },
    });
  });
});

describe('a responsible person who leaves', () => {
  it('is flagged on every department custody they signed for — the custody stands', async () => {
    const switchAsset = await device(octoberId, 'Cisco Catalyst');
    await handToIt([switchAsset], { responsibleEmployeeId: String(SECOND_SIGNER) });

    const flagged = await itAssetCustodyService.flagAssetsHeldByExitedEmployee(
      String(SECOND_SIGNER),
    );
    expect(flagged).toBeGreaterThanOrEqual(1);
    const alerts = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'asset',
      'entityRef.entityId': switchAsset.id,
      action: 'alertRaised',
    })
      .lean()
      .exec();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.changes).toEqual([
      expect.objectContaining({ field: 'responsibleExited', new: String(SECOND_SIGNER) }),
    ]);
    // Still the department's, still out.
    expect((await asset(switchAsset.id)).holder).toMatchObject({
      kind: 'department',
      responsibleEmployeeId: String(SECOND_SIGNER),
    });
  });
});
