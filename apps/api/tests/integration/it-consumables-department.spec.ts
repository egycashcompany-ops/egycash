// «صرف لإدارة» — consumables issued to a DEPARTMENT at a PLACE, over real HTTP with real RBAC
// (2026-11-19): «عند تسليم الأصول والمستهلكات يكون فى إمكانية إنى مأسلمش لموظف ولكن أعينها فى مكان
// بس تبقى على عهده الإدارة .. زى السيرفرات والكاميرات والسويتشات وهكذا .. الأصول أو المستهلكات الخاصة
// بالإدارة». His answers: the custodian is a department chosen at the issue; the place comes from
// the branch's «المواقع»; and the memo names the department and the place, signed by the
// department's responsible person.
//
// What a mocked spec cannot see: the department and the place read from their own collections and
// refused on their own fields; the place held against the STORE's branch; the memo written with
// its signer and its department in the same transaction as the ledger rows, and read back by its
// own routes; the ledger's rows labelled and filtered by department, place and signer through the
// partial indexes; a toner onto a printer a department holds judged on that printer's counter,
// whoever the memo is for; and the signer's page opening for the store that named them.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type ApiErrorDetail,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItConsumableDto,
  type ItConsumableIssueResultDto,
  type ItConsumableMemoDto,
  type ItConsumableMovementDto,
  type ItPersonDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { ItConsumableMovementModel } from '../../src/modules/it/consumables/consumable-movement.model';
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
/** `itConsumable.view` + `itConsumable.assign` at BRANCH scope, placed in October — no asset grant. */
let storeKeeperToken: string;
let octoberId: string;
let tantaId: string;
let itDepartmentId: string;
let tantaDepartmentId: string;
let closedDepartmentId: string;
let serverRoomId: string;
let cameraRoomId: string;
let tantaRoomId: string;
let retiredRoomId: string;
let cableTypeId: string;
let tonerTypeId: string;
let printerCategoryId: string;

// The people: the responsible person who signs (placed in Tanta — a recipient of any branch), a
// second signer, an employee, a leaver, and a signer only the store keeper's issue names.
const SIGNER = new Types.ObjectId();
const SECOND_SIGNER = new Types.ObjectId();
const EMPLOYEE = new Types.ObjectId();
const LEAVER = new Types.ObjectId();
const KEEPERS_SIGNER = new Types.ObjectId();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-consumables-department-test-${Date.now()}`;
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
const fieldIssue = (res: request.Response) => {
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

// Every item its own name: two tests never share a stock.
let names = 0;
const stock = async (typeId = cableTypeId, branchId = octoberId): Promise<ItConsumableDto> => {
  names += 1;
  const res = await api.post('/consumables', {
    name: `صنف ${String(names)}`,
    typeId,
    unit: 'قطعة',
    branchId,
    openingQty: 10,
  });
  expect(res.status).toBe(201);
  return data<ItConsumableDto>(res);
};

const onHand = async (item: ItConsumableDto): Promise<number> =>
  data<ItConsumableDto>(await api.get(`/consumables/${item.id}`)).onHandQty;

/** «في عهدة إدارة تكنولوجيا المعلومات — غرفة السيرفرات», signed for by SIGNER, unless told. */
const itDepartment = (over: Record<string, string> = {}) => ({
  departmentId: itDepartmentId,
  locationId: serverRoomId,
  responsibleEmployeeId: String(SIGNER),
  ...over,
});

const issue = (body: Record<string, unknown>, token = adminToken) =>
  api.post('/consumables/issue', body, token);

/** Issue one unit of each item to a department; the result. */
const issueToDepartment = async (
  items: readonly ItConsumableDto[],
  over: Record<string, string> = {},
  token = adminToken,
): Promise<ItConsumableIssueResultDto> => {
  const res = await issue(
    {
      department: itDepartment(over),
      lines: items.map((item) => ({ consumableId: item.id, qty: 1, reason: 'new' })),
    },
    token,
  );
  expect(res.status).toBe(201);
  return data<ItConsumableIssueResultDto>(res);
};

const ledger = async (query: string): Promise<ItConsumableMovementDto[]> => {
  const res = await api.get(`/consumable-movements?kind=issued&pageSize=100&${query}`);
  expect(res.status).toBe(200);
  return data<ItConsumableMovementDto[]>(res);
};
const memoIdsOf = (rows: readonly ItConsumableMovementDto[]): string[] => [
  ...new Set(rows.flatMap((row) => row.memoId ?? [])),
];

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('consumables-department-admin@ecms.local');
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
  adminToken = await login('consumables-department-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await request(app)
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  octoberId = await post('/platform/branches', {
    code: '77',
    name: { ar: 'أكتوبر', en: 'October' },
  });
  tantaId = await post('/platform/branches', { code: '78', name: { ar: 'طنطا', en: 'Tanta' } });
  itDepartmentId = await post('/platform/departments', {
    code: 'CD-IT',
    name: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
    branchId: octoberId,
  });
  tantaDepartmentId = await post('/platform/departments', {
    code: 'CD-T-IT',
    name: { ar: 'تكنولوجيا المعلومات — طنطا', en: 'IT, Tanta' },
    branchId: tantaId,
  });
  closedDepartmentId = await post('/platform/departments', {
    code: 'CD-OLD',
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

  await plantEmployee(SIGNER, '0312001', 'وليد صفوت جلال', tantaId);
  await plantEmployee(SECOND_SIGNER, '0312002', 'شريف ممدوح فاروق', octoberId);
  await plantEmployee(EMPLOYEE, '0312003', 'سامح نبيل عزت', octoberId);
  await plantEmployee(LEAVER, '0312004', 'ماجد رشدي حلمي', octoberId, 'exited');
  await plantEmployee(KEEPERS_SIGNER, '0312005', 'هشام فكري سالم', tantaId);

  const role = await rbacService.createRole(
    {
      name: { en: 'Store keeper, October', ar: 'أمين مخزن أكتوبر' },
      permissionKeys: ['itConsumable.view', 'itConsumable.assign'],
    },
    adminId,
  );
  const keeperId = await mkUser('consumables-department-keeper@ecms.local', octoberId);
  await rbacService.ensureAssignment(keeperId, String(role._id), 'branch');
  storeKeeperToken = await login('consumables-department-keeper@ecms.local');

  const cables = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'cables',
    name: { ar: 'كابلات', en: 'Cables' },
  });
  expect(cables.status).toBe(201);
  cableTypeId = data<ItCatalogItemDto>(cables).id;
  const toners = await api.post('/catalog-items', {
    kind: 'consumableType',
    code: 'ink',
    name: { ar: 'حبارات', en: 'Ink & toner' },
    requiresCounterReading: true,
  });
  expect(toners.status).toBe(201);
  tonerTypeId = data<ItCatalogItemDto>(toners).id;
  const printers = await api.post('/catalog-items', {
    kind: 'assetCategory',
    name: { ar: 'طابعات', en: 'Printers' },
  });
  expect(printers.status).toBe(201);
  printerCategoryId = data<ItCatalogItemDto>(printers).id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('a memo to a department at a place — «صرف لإدارة»', () => {
  it('issues on ONE memo signed by the responsible person, naming the department and the place', async () => {
    const cable = await stock();
    const switchPort = await stock();
    const { memo, consumables } = await issueToDepartment([cable, switchPort]);

    // The signer is the responsible person — their code, name and job, as HR answers.
    expect(memo).toMatchObject({
      employeeId: String(SIGNER),
      employeeCode: '0312001',
      employeeName: 'وليد صفوت جلال',
      // The store's paper, whatever branch the signer works in.
      branchId: octoberId,
      custodian: {
        departmentId: itDepartmentId,
        departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
        locationId: serverRoomId,
        locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
      },
    });
    expect(memo.memoNumber).toBeGreaterThan(0);
    expect(memo.lines.map((line) => line.code).sort()).toEqual(
      [cable.code, switchPort.code].sort(),
    );
    expect(consumables.map((item) => item.onHandQty)).toEqual([9, 9]);

    // The memo's own routes read the same paper — and its reprint is that paper.
    const stored = data<ItConsumableMemoDto>(await api.get(`/consumable-memos/${memo.id}`));
    expect(stored.custodian).toEqual(memo.custodian);
    expect(stored.employeeId).toBe(String(SIGNER));
    const printed = await api.post(`/consumable-memos/${memo.id}/print`);
    expect(printed.status).toBe(200);
    expect(data<ItConsumableMemoDto>(printed).custodian).toEqual(memo.custodian);

    // The memo's trail names the signer, the department and the place.
    const [trail] = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'consumableMemo',
      'entityRef.entityId': memo.id,
      action: 'create',
    })
      .lean()
      .exec();
    expect(trail?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'employeeId', new: String(SIGNER) }),
        expect.objectContaining({ field: 'departmentId', new: itDepartmentId }),
        expect.objectContaining({ field: 'locationId', new: serverRoomId }),
      ]),
    );
  });

  it('writes ledger rows naming the department, the place and the signer — and no employee', async () => {
    const cable = await stock();
    const { memo } = await issueToDepartment([cable]);

    const [row] = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${cable.id}/movements?kind=issued`),
    );
    expect(row).toMatchObject({
      kind: 'issued',
      qty: 1,
      memoId: memo.id,
      memoNumber: memo.memoNumber,
      employeeId: null,
      employeeCode: null,
      employeeName: null,
      departmentId: itDepartmentId,
      departmentName: { ar: 'تكنولوجيا المعلومات', en: 'IT' },
      locationId: serverRoomId,
      locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
      responsibleEmployeeId: String(SIGNER),
      responsibleEmployeeCode: '0312001',
      responsibleEmployeeName: 'وليد صفوت جلال',
    });

    // The item's trail says where it went: the department, the place, the signer — no employee.
    const trail = await AuditLogModel.find({
      'entityRef.moduleId': 'it',
      'entityRef.entityType': 'consumable',
      'entityRef.entityId': cable.id,
      action: 'assign',
    })
      .lean()
      .exec();
    expect(trail).toHaveLength(1);
    const fields = (trail[0]?.changes ?? []).map((entry) => entry.field);
    expect(fields).toEqual(
      expect.arrayContaining(['departmentId', 'locationId', 'responsibleEmployeeId']),
    );
    expect(fields).not.toContain('employeeId');
  });

  it('keeps the department keys off every other row — an employee’s issue reads as it always did', async () => {
    const cable = await stock();
    const res = await issue({
      employeeId: String(EMPLOYEE),
      lines: [{ consumableId: cable.id, qty: 1 }],
    });
    expect(res.status).toBe(201);
    expect(data<ItConsumableIssueResultDto>(res).memo.custodian).toBeNull();
    const stored = await ItConsumableMovementModel.findOne({
      consumableId: new Types.ObjectId(cable.id),
      kind: 'issued',
    })
      .lean()
      .exec();
    expect(stored).not.toBeNull();
    expect(stored).not.toHaveProperty('departmentId');
    expect(stored).not.toHaveProperty('locationId');
    expect(stored).not.toHaveProperty('responsibleEmployeeId');
    const [row] = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${cable.id}/movements?kind=issued`),
    );
    expect(row).toMatchObject({
      employeeId: String(EMPLOYEE),
      departmentId: null,
      locationId: null,
      responsibleEmployeeId: null,
    });
  });

  it('finds them on the ledger by department, by place and by signer — never as the signer’s own', async () => {
    const atServers = await issueToDepartment([await stock()]);
    const atCameras = await issueToDepartment([await stock()], {
      locationId: cameraRoomId,
      responsibleEmployeeId: String(SECOND_SIGNER),
    });
    const toEmployee = data<ItConsumableIssueResultDto>(
      await issue({
        employeeId: String(SIGNER),
        lines: [{ consumableId: (await stock()).id, qty: 1 }],
      }),
    );

    const byDepartment = memoIdsOf(await ledger(`departmentId=${itDepartmentId}`));
    expect(byDepartment).toEqual(expect.arrayContaining([atServers.memo.id, atCameras.memo.id]));
    expect(byDepartment).not.toContain(toEmployee.memo.id);

    // «إيه اللي في غرفة الكاميرات».
    const byPlace = memoIdsOf(await ledger(`locationId=${cameraRoomId}`));
    expect(byPlace).toContain(atCameras.memo.id);
    expect(byPlace).not.toContain(atServers.memo.id);

    const bySigner = memoIdsOf(await ledger(`responsibleEmployeeId=${String(SECOND_SIGNER)}`));
    expect(bySigner).toEqual([atCameras.memo.id]);
    const rows = await ledger(`responsibleEmployeeId=${String(SECOND_SIGNER)}`);
    expect(rows.every((row) => row.employeeId === null)).toBe(true);

    // What SIGNER received himself is his; what he signed for the department is the department's.
    const asEmployee = memoIdsOf(await ledger(`employeeId=${String(SIGNER)}`));
    expect(asEmployee).toContain(toEmployee.memo.id);
    expect(asEmployee).not.toContain(atServers.memo.id);

    // The filters meet: the department AND a place it holds nothing at.
    expect(await ledger(`departmentId=${itDepartmentId}&locationId=${retiredRoomId}`)).toEqual([]);
  });

  it('may go to a department of ANOTHER branch — only the place is the store’s', async () => {
    const cable = await stock();
    const { memo } = await issueToDepartment([cable], { departmentId: tantaDepartmentId });
    expect(memo.custodian).toMatchObject({
      departmentId: tantaDepartmentId,
      departmentName: { ar: 'تكنولوجيا المعلومات — طنطا', en: 'IT, Tanta' },
      locationId: serverRoomId,
    });
  });

  it('files the department memo’s signed copy as any other', async () => {
    const cable = await stock();
    const { memo } = await issueToDepartment([cable]);
    const uploaded = await request(app)
      .post(`/api/v1/it/consumable-memos/${memo.id}/signed-copy`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'signed.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    expect(data<ItConsumableMemoDto>(uploaded)).toMatchObject({
      custodian: { departmentId: itDepartmentId, locationId: serverRoomId },
    });
    expect(data<ItConsumableMemoDto>(uploaded).signedCopy?.mime).toBe('image/png');
    const [row] = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${cable.id}/movements?kind=issued`),
    );
    expect(row).toMatchObject({ memoId: memo.id, memoSigned: true });
  });
});

describe('what a memo to a department refuses — nothing moved', () => {
  const refused = async (
    over: Record<string, string>,
    field: string,
    code: string,
  ): Promise<void> => {
    const cable = await stock();
    const res = await issue({
      department: itDepartment(over),
      lines: [{ consumableId: cable.id, qty: 1 }],
    });
    expect(fieldIssue(res)).toEqual({ field, code });
    expect(await onHand(cable)).toBe(10);
  };

  it('a place in another branch than the store’s', async () => {
    await refused({ locationId: tantaRoomId }, 'body.department.locationId', 'OTHER_BRANCH');
  });

  it('a place the same items’ store does not keep — the Tanta store’s items at an October place', async () => {
    const inTanta = await stock(cableTypeId, tantaId);
    const res = await issue({
      department: itDepartment(),
      lines: [{ consumableId: inTanta.id, qty: 1 }],
    });
    expect(fieldIssue(res)).toEqual({
      field: 'body.department.locationId',
      code: 'OTHER_BRANCH',
    });
    // The same memo at Tanta's own place goes through.
    const ok = await issue({
      department: itDepartment({ locationId: tantaRoomId }),
      lines: [{ consumableId: inTanta.id, qty: 1 }],
    });
    expect(ok.status).toBe(201);
    expect(data<ItConsumableIssueResultDto>(ok).memo.branchId).toBe(tantaId);
  });

  it('a retired place, or one that does not exist', async () => {
    await refused({ locationId: retiredRoomId }, 'body.department.locationId', 'INACTIVE');
    await refused(
      { locationId: String(new Types.ObjectId()) },
      'body.department.locationId',
      'UNKNOWN',
    );
  });

  it('an inactive department, or one that does not exist', async () => {
    await refused({ departmentId: closedDepartmentId }, 'body.department.departmentId', 'INACTIVE');
    await refused(
      { departmentId: String(new Types.ObjectId()) },
      'body.department.departmentId',
      'UNKNOWN',
    );
  });

  it('a responsible person who has left — «اللى موجود بس»', async () => {
    const cable = await stock();
    const res = await issue({
      department: itDepartment({ responsibleEmployeeId: String(LEAVER) }),
      lines: [{ consumableId: cable.id, qty: 1 }],
    });
    expect(res.status).toBe(422);
    expect(failure(res).message).toMatch(/0312004 has left the company/u);
    expect(await onHand(cable)).toBe(10);
  });

  it('a body naming both an employee and a department, or neither', async () => {
    const cable = await stock();
    const both = await issue({
      employeeId: String(EMPLOYEE),
      department: itDepartment(),
      lines: [{ consumableId: cable.id, qty: 1 }],
    });
    expect(both.status).toBe(400);
    expect(failure(both).code).toBe('VALIDATION_FAILED');
    const neither = await issue({ lines: [{ consumableId: cable.id, qty: 1 }] });
    expect(neither.status).toBe(400);
    expect(await onHand(cable)).toBe(10);
  });
});

describe('a toner onto a printer the department holds — its counter, unchanged', () => {
  it('still needs its reading, and is judged on that printer’s timeline whoever the memo is for', async () => {
    const created = await api.post('/assets', {
      name: 'HP LaserJet M404',
      categoryId: printerCategoryId,
      branchId: octoberId,
    });
    expect(created.status).toBe(201);
    const printer = data<ItAssetDto>(created);
    // In the IT department's custody at the server room — on its own department paper.
    const handed = await api.post('/custody-receipts', {
      department: itDepartment(),
      lines: [{ assetId: printer.id }],
    });
    expect(handed.status).toBe(201);
    const held = data<ItAssetDto>(await api.get(`/assets/${printer.id}`));
    expect(held.status).toBe('assigned');
    expect(held.holder).toMatchObject({ kind: 'department', departmentId: itDepartmentId });

    const toner = await stock(tonerTypeId);
    const unread = await issue({
      department: itDepartment(),
      lines: [{ consumableId: toner.id, qty: 1, assetId: printer.id }],
    });
    expect(unread.status).toBe(422);
    expect(failure(unread).code).toBe('IT_CONSUMABLE_COUNTER_REQUIRED');
    expect(failure(unread).details?.map((d) => [d.field, d.code])).toEqual([
      ['lines.0.counterReading', 'REQUIRED'],
    ]);

    const first = await issue({
      department: itDepartment(),
      lines: [{ consumableId: toner.id, qty: 1, assetId: printer.id, counterReading: 12000 }],
    });
    expect(first.status).toBe(201);
    const [row] = data<ItConsumableMovementDto[]>(
      await api.get(`/consumables/${toner.id}/movements?kind=issued`),
    );
    expect(row).toMatchObject({
      assetId: printer.id,
      counterReading: 12000,
      employeeId: null,
      departmentId: itDepartmentId,
      locationId: serverRoomId,
    });

    // The next toner — to an employee this time — is held against the department's reading.
    const notAbove = await issue({
      employeeId: String(EMPLOYEE),
      lines: [{ consumableId: toner.id, qty: 1, assetId: printer.id, counterReading: 12000 }],
    });
    expect(notAbove.status).toBe(422);
    expect(failure(notAbove).code).toBe('IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS');
    const above = await issue({
      employeeId: String(EMPLOYEE),
      lines: [{ consumableId: toner.id, qty: 1, assetId: printer.id, counterReading: 13500 }],
    });
    expect(above.status).toBe(201);
    // And the department's next toner against that one.
    const again = await issue({
      department: itDepartment(),
      lines: [{ consumableId: toner.id, qty: 1, assetId: printer.id, counterReading: 13000 }],
    });
    expect(again.status).toBe(422);
    expect(failure(again).code).toBe('IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS');
  });
});

describe('the indexes the ledger’s department questions run on — not a scan of the ledger', () => {
  it.each([
    ['departmentId', 'ix_department_at'],
    ['locationId', 'ix_location_at'],
    ['responsibleEmployeeId', 'ix_responsible_at'],
  ] as const)('%s is served by %s', async (field, name) => {
    const indexes = await ItConsumableMovementModel.collection.listIndexes().toArray();
    const index = indexes.find((entry) => entry.name === name);
    expect(index?.key).toEqual({ [field]: 1, at: -1 });
    expect(index?.partialFilterExpression).toEqual({ [field]: { $type: 'objectId' } });
    // The ledger's own clause (consumable.service.ts `ledgerFilter`), newest first.
    const winning = async (filter: Record<string, unknown>): Promise<string> => {
      const plan = (await ItConsumableMovementModel.find({ isDeleted: false, $and: [filter] })
        .sort({ at: -1 })
        .explain('queryPlanner')) as unknown;
      const [first] = Array.isArray(plan) ? plan : [plan];
      return JSON.stringify(
        (first as { queryPlanner: { winningPlan: unknown } }).queryPlanner.winningPlan,
      );
    };
    const id = new Types.ObjectId(String(SIGNER));
    // The clause names the type beside the id: a bare id does not imply the index's filter to the
    // planner (checked 2026-11-19), and the ledger would be scanned.
    expect(await winning({ [field]: { $eq: id, $type: 'objectId' } })).toContain(name);
  });
});

describe('the person who signed — «المُسلِّم يرى ما سلّمه»', () => {
  it('opens to the store that named them as a department’s signer, in another branch', async () => {
    // Placed in Tanta: the October keeper reaches them only through what the store's ledger names.
    expect((await api.get(`/people/${String(KEEPERS_SIGNER)}`, storeKeeperToken)).status).toBe(404);
    const cable = await stock();
    await issueToDepartment(
      [cable],
      { responsibleEmployeeId: String(KEEPERS_SIGNER) },
      storeKeeperToken,
    );
    const page = await api.get(`/people/${String(KEEPERS_SIGNER)}`, storeKeeperToken);
    expect(page.status).toBe(200);
    expect(data<ItPersonDto>(page)).toMatchObject({ employeeId: String(KEEPERS_SIGNER) });
    // …and the ledger filter its page asks finds what they signed for.
    const signed = data<ItConsumableMovementDto[]>(
      await api.get(
        `/consumable-movements?responsibleEmployeeId=${String(KEEPERS_SIGNER)}`,
        storeKeeperToken,
      ),
    );
    expect(signed.map((row) => row.consumableId)).toEqual([cable.id]);
  });
});
