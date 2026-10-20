// Mobile lines (FR-19) over real HTTP with real RBAC — «الـ 3 فايلات دول عبارة عن خطوط موبايل عايز
// أعملهم صفحة لإدارتهم وتسليمهم وبردو بفلتر لكل شبكة مع بيانات كل شبكة».
//
// What a mocked spec cannot see: the unique indexes refusing a number twice, the acknowledgment
// printed first and recorded with the hand-over under that number, a car holding a tracker SIM on
// no paper, the register's holder resolved from the open interval, the network cards counting the
// same lines the table lists, the history in order, a leaver refused through HR's own answer, the
// one F-14 series refusing a number the other kind of paper already carries, and the branch scope.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  SettingKeys,
  platformPermissions,
  type ItAssetDto,
  type ItCatalogItemDto,
  type ItCustodyReceiptDocumentDto,
  type ItMobileLineAssignmentDto,
  type ItMobileLineAssignResultDto,
  type ItMobileLineDto,
  type ItMobileLineHistoryEntryDto,
  type ItMobileLineReceiptDocumentDto,
  type ItMobileLineReceiptDto,
  type ItMobileLinesSummaryDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { itPermissions } from '../../src/modules/it/it.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { EmployeeModel } from '../../src/modules/hr/employee-management/employees/employee.model';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let branchAToken: string; // itAsset.view at BRANCH scope, placed in branch A — nothing else
let branchAId: string;
let branchBId: string;
let branchCId: string; // the network cards' own branch, so no other test moves its counts
let categoryId: string;

// Planted in HR, so the leaver rule is judged on HR's own answer and the paper names a real code.
const EMPLOYEE = new Types.ObjectId();
const LEAVER = new Types.ObjectId();

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-it-lines-test-${Date.now()}`;
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

const plantEmployee = async (
  _id: Types.ObjectId,
  code: string,
  fullNameAr: string,
  status: 'active' | 'exited',
): Promise<void> => {
  const branch = new Types.ObjectId(branchAId);
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
    isDeleted: false,
    deletedAt: null,
    __v: 0,
  });
};

// Every line its own number: 010 and eight digits, as the networks issue them.
let numbers = 0;
const nextNumber = (): string => {
  numbers += 1;
  return `0103${String(numbers).padStart(7, '0')}`;
};

const api = {
  get: (path: string, token = adminToken) =>
    request(app).get(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
  post: (path: string, body: Record<string, unknown> = {}, token = adminToken) =>
    request(app).post(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (path: string, body: Record<string, unknown>, token = adminToken) =>
    request(app).patch(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`).send(body),
  delete: (path: string, token = adminToken) =>
    request(app).delete(`/api/v1/it${path}`).set('Authorization', `Bearer ${token}`),
};

const register = async (overrides: Record<string, unknown> = {}): Promise<ItMobileLineDto> => {
  const res = await api.post('/mobile-lines', {
    network: 'vodafone',
    phoneNumber: nextNumber(),
    accountNumber: '8.29280625.1',
    ratePlan: '2025 Business Flex 80',
    branchId: branchAId,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return data<ItMobileLineDto>(res);
};

const handOver = (id: string, body: Record<string, unknown>, token = adminToken) =>
  api.post(`/mobile-lines/${id}/assign`, body, token);

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...itPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('lines-admin@ecms.local');
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
  adminToken = await login('lines-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return (res.body as { data: { id: string } }).data.id;
  };
  branchAId = await mkBranch('90', 'فرع أ', 'Branch A');
  branchBId = await mkBranch('91', 'فرع ب', 'Branch B');
  branchCId = await mkBranch('92', 'فرع ج', 'Branch C');

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Lines viewer', ar: 'مطالع خطوط' }, permissionKeys: ['itAsset.view'] },
    adminId,
  );
  const viewerId = await mkUser('lines-viewer@ecms.local', branchAId);
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'branch');
  branchAToken = await login('lines-viewer@ecms.local');

  await plantEmployee(EMPLOYEE, '0101002', 'مصطفى عثمان محمود', 'active');
  await plantEmployee(LEAVER, '0100001', 'محمود ونيس غنيمي', 'exited');

  // A device category, for the one-series check against a device receipt.
  const category = await api.post('/catalog-items', {
    kind: 'assetCategory',
    name: { ar: 'هواتف', en: 'Phones' },
  });
  expect(category.status).toBe(201);
  categoryId = data<ItCatalogItemDto>(category).id;
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the register', () => {
  it('files a line in stock, its number normalized, and refuses that number twice', async () => {
    const res = await api.post('/mobile-lines', {
      network: 'vodafone',
      // Arabic-Indic digits, as somebody types them on an Arabic keyboard.
      phoneNumber: '٠١٠٩٩٨٨٧٧٦٦',
      simSerial: '8920 0220 2271 2847 788',
      branchId: branchAId,
    });
    expect(res.status).toBe(201);
    const line = data<ItMobileLineDto>(res);
    expect(line).toMatchObject({
      phoneNumber: '01099887766',
      simSerial: '8920022022712847788',
      simKind: 'physical',
      status: 'inStock',
      currentAssignmentId: null,
      holder: null,
    });

    // The same number however it is written — a conflict, not a second row for one SIM.
    const again = await api.post('/mobile-lines', {
      network: 'orange',
      phoneNumber: '+20 109 988 7766',
      branchId: branchAId,
    });
    expect(again.status).toBe(409);
    // And the same card under another number.
    const sameCard = await api.post('/mobile-lines', {
      network: 'vodafone',
      phoneNumber: nextNumber(),
      simSerial: '8920022022712847788',
      branchId: branchAId,
    });
    expect(sameCard.status).toBe(409);
  });

  it('never accepts a status, nor an eSIM with a card serial', async () => {
    const sneaky = await api.post('/mobile-lines', {
      network: 'etisalat',
      phoneNumber: nextNumber(),
      branchId: branchAId,
      status: 'assigned',
    });
    expect(sneaky.status).toBe(400);
    const esim = await api.post('/mobile-lines', {
      network: 'etisalat',
      phoneNumber: nextNumber(),
      simKind: 'esim',
      simSerial: '8920022022712840000',
      branchId: branchAId,
    });
    expect(esim.status).toBe(400);
  });
});

describe('handing a line to an employee', () => {
  it('prints the acknowledgment first, records it with the hand-over, and takes the line back', async () => {
    const line = await register();

    const preview = await api.post('/mobile-line-receipts/preview', {
      lineId: line.id,
      employeeId: String(EMPLOYEE),
    });
    expect(preview.status).toBe(200);
    const paper = data<ItMobileLineReceiptDocumentDto>(preview);
    expect(Number.isInteger(paper.formNumber) && (paper.formNumber ?? 0) > 0).toBe(true);
    expect(paper.employeeCode).toBe('0101002');
    expect(paper.line).toMatchObject({
      lineId: line.id,
      assignmentId: null,
      network: 'vodafone',
      phoneNumber: line.phoneNumber,
    });
    // The paper is not the hand-over.
    expect(data<ItMobileLineDto>(await api.get(`/mobile-lines/${line.id}`)).status).toBe('inStock');

    const handed = await handOver(line.id, {
      employeeId: String(EMPLOYEE),
      formNumber: paper.formNumber,
    });
    expect(handed.status).toBe(200);
    const { line: held, receipt } = data<ItMobileLineAssignResultDto>(handed);
    expect(held.status).toBe('assigned');
    expect(held.holder).toMatchObject({
      kind: 'employee',
      employeeId: String(EMPLOYEE),
      employeeCode: '0101002',
      employeeName: 'مصطفى عثمان محمود',
      vehicleCode: null,
      receiptId: receipt?.id,
      receiptSigned: false,
    });
    expect(receipt?.formNumber).toBe(paper.formNumber);
    expect(receipt?.line.phoneNumber).toBe(line.phoneNumber);
    expect(receipt?.line.assignmentId).toBe(held.currentAssignmentId);

    // Read back and printed again: the same paper, under the same number.
    const stored = await api.get(`/mobile-line-receipts/${receipt?.id ?? ''}`);
    expect(stored.status).toBe(200);
    expect(data<ItMobileLineReceiptDto>(stored).line).toEqual(receipt?.line);
    const again = await api.post(`/mobile-line-receipts/${receipt?.id ?? ''}/print`);
    expect(data<ItMobileLineReceiptDto>(again).formNumber).toBe(paper.formNumber);

    // The register finds it by its holder, and the intervals name the paper.
    const mine = data<ItMobileLineDto[]>(
      await api.get(`/mobile-lines?holderEmployeeId=${String(EMPLOYEE)}&pageSize=100`),
    );
    expect(mine.map((row) => row.id)).toContain(line.id);
    const open = data<ItMobileLineAssignmentDto[]>(
      await api.get(`/mobile-line-assignments?employeeId=${String(EMPLOYEE)}&open=true`),
    ).find((row) => row.lineId === line.id);
    expect(open).toMatchObject({
      phoneNumber: line.phoneNumber,
      network: 'vodafone',
      assignedToEmployeeCode: '0101002',
      receiptId: receipt?.id,
      receiptSigned: false,
    });
    // A line out with somebody is not printed for again — the paper is refused as the hand-over is.
    expect(
      (
        await api.post('/mobile-line-receipts/preview', {
          lineId: line.id,
          employeeId: String(EMPLOYEE),
        })
      ).status,
    ).toBe(409);

    const returned = await api.post(`/mobile-lines/${line.id}/return`, { notes: 'left the team' });
    expect(returned.status).toBe(200);
    expect(data<ItMobileLineDto>(returned)).toMatchObject({
      status: 'inStock',
      currentAssignmentId: null,
      holder: null,
    });
    const intervals = data<ItMobileLineAssignmentDto[]>(
      await api.get(`/mobile-line-assignments?lineId=${line.id}`),
    );
    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.returnedAt).not.toBeNull();

    // The history, newest first.
    const history = data<ItMobileLineHistoryEntryDto[]>(
      await api.get(`/mobile-lines/${line.id}/history`),
    );
    expect(history.map((entry) => entry.type)).toEqual(['returned', 'assigned', 'registered']);
    expect(history[1]?.metadata).toMatchObject({
      holderKind: 'employee',
      employeeCode: '0101002',
      receiptId: receipt?.id,
      formNumber: paper.formNumber,
    });
    expect(history[0]?.notes).toBe('left the team');
  });

  it('refuses a leaver — on the paper and on the hand-over — and the line stays in stock', async () => {
    const line = await register();
    const paper = await api.post('/mobile-line-receipts/preview', {
      lineId: line.id,
      employeeId: String(LEAVER),
    });
    expect(paper.status).toBe(422);
    const handed = await handOver(line.id, { employeeId: String(LEAVER) });
    expect(handed.status).toBe(422);
    expect(data<ItMobileLineDto>(await api.get(`/mobile-lines/${line.id}`)).status).toBe('inStock');
  });

  it('refuses a second hand-over while the line is out', async () => {
    const line = await register();
    expect((await handOver(line.id, { employeeId: String(EMPLOYEE) })).status).toBe(200);
    expect((await handOver(line.id, { vehicleCode: 'C-1' })).status).toBe(409);
  });

  it('files the signed copy, shows it on the register, and withdraws it', async () => {
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const line = await register();
    const { receipt } = data<ItMobileLineAssignResultDto>(
      await handOver(line.id, { employeeId: String(EMPLOYEE) }),
    );
    const receiptId = receipt?.id ?? '';

    const uploaded = await request(app)
      .post(`/api/v1/it/mobile-line-receipts/${receiptId}/signed-copy`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG, { filename: 'signed.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    expect(data<ItMobileLineReceiptDto>(uploaded).signedCopy?.mime).toBe('image/png');
    expect(
      data<ItMobileLineDto>(await api.get(`/mobile-lines/${line.id}`)).holder?.receiptSigned,
    ).toBe(true);

    const bytes = await api.get(`/mobile-line-receipts/${receiptId}/signed-copy`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/png');

    const withdrawn = await api.delete(`/mobile-line-receipts/${receiptId}/signed-copy`);
    expect(withdrawn.status).toBe(200);
    expect(data<ItMobileLineReceiptDto>(withdrawn).signedCopy).toBeNull();
  });
});

describe('handing a line to a car', () => {
  it('writes the car as its code and plate, on no paper, and finds it by either', async () => {
    const line = await register({ network: 'orange', ratePlan: 'Tracker 1GB' });

    // A car signs nothing — so it carries no paper's number either.
    expect((await handOver(line.id, { vehicleCode: 'TRK-77', formNumber: 1 })).status).toBe(400);
    // Both, or neither — a line goes to one holder.
    expect(
      (await handOver(line.id, { vehicleCode: 'TRK-77', employeeId: String(EMPLOYEE) })).status,
    ).toBe(400);

    const handed = await handOver(line.id, { vehicleCode: 'TRK-77', vehiclePlate: 'س ص 63' });
    expect(handed.status).toBe(200);
    const result = data<ItMobileLineAssignResultDto>(handed);
    expect(result.receipt).toBeNull();
    expect(result.line.holder).toMatchObject({
      kind: 'vehicle',
      employeeId: null,
      vehicleCode: 'TRK-77',
      vehiclePlate: 'س ص 63',
      receiptId: null,
      receiptSigned: null,
    });

    const byCar = data<ItMobileLineDto[]>(await api.get('/mobile-lines?search=TRK-77'));
    expect(byCar.map((row) => row.id)).toEqual([line.id]);
    const cars = data<ItMobileLineDto[]>(
      await api.get('/mobile-lines?holderKind=vehicle&pageSize=100'),
    );
    expect(cars.every((row) => row.holder?.kind === 'vehicle')).toBe(true);
    expect(cars.map((row) => row.id)).toContain(line.id);
  });
});

describe('one F-14 series for devices and lines', () => {
  it('refuses a printed number the other kind of paper already carries — both ways', async () => {
    // A device paper, printed and recorded.
    const asset = data<ItAssetDto>(
      await api.post('/assets', { name: 'Samsung A15', categoryId, branchId: branchAId }),
    );
    const devicePaper = data<ItCustodyReceiptDocumentDto>(
      await api.post('/custody-receipts/preview', {
        employeeId: String(EMPLOYEE),
        lines: [{ assetId: asset.id }],
      }),
    );
    const device = await api.post('/custody-receipts', {
      employeeId: String(EMPLOYEE),
      lines: [{ assetId: asset.id }],
      formNumber: devicePaper.formNumber,
    });
    expect(device.status).toBe(201);

    // …is not recorded again on a line's.
    const line = await register();
    const reused = await handOver(line.id, {
      employeeId: String(EMPLOYEE),
      formNumber: devicePaper.formNumber,
    });
    expect(reused.status).toBe(422);
    expect(data<ItMobileLineDto>(await api.get(`/mobile-lines/${line.id}`)).status).toBe('inStock');

    // And the other way round.
    const linePaper = data<ItMobileLineReceiptDocumentDto>(
      await api.post('/mobile-line-receipts/preview', {
        lineId: line.id,
        employeeId: String(EMPLOYEE),
      }),
    );
    expect(
      (await handOver(line.id, { employeeId: String(EMPLOYEE), formNumber: linePaper.formNumber }))
        .status,
    ).toBe(200);
    const second = data<ItAssetDto>(
      await api.post('/assets', { name: 'Samsung A25', categoryId, branchId: branchAId }),
    );
    const claimed = await api.post('/custody-receipts', {
      employeeId: String(EMPLOYEE),
      lines: [{ assetId: second.id }],
      formNumber: linePaper.formNumber,
    });
    expect(claimed.status).toBe(422);
  });
});

describe('suspend and reactivate', () => {
  it('suspends only a line in stock, and hands over nothing suspended until it is reactivated', async () => {
    const line = await register();
    await handOver(line.id, { employeeId: String(EMPLOYEE) });
    // A held line is returned first.
    expect((await api.post(`/mobile-lines/${line.id}/suspend`)).status).toBe(422);
    await api.post(`/mobile-lines/${line.id}/return`);

    const suspended = await api.post(`/mobile-lines/${line.id}/suspend`, { notes: 'SIM lost' });
    expect(suspended.status).toBe(200);
    expect(data<ItMobileLineDto>(suspended).status).toBe('suspended');
    expect((await api.post(`/mobile-lines/${line.id}/suspend`)).status).toBe(422);
    expect((await handOver(line.id, { employeeId: String(EMPLOYEE) })).status).toBe(422);
    expect(
      (
        await api.post('/mobile-line-receipts/preview', {
          lineId: line.id,
          employeeId: String(EMPLOYEE),
        })
      ).status,
    ).toBe(422);

    const reactivated = await api.post(`/mobile-lines/${line.id}/reactivate`);
    expect(reactivated.status).toBe(200);
    expect(data<ItMobileLineDto>(reactivated).status).toBe('inStock');
    expect((await api.post(`/mobile-lines/${line.id}/reactivate`)).status).toBe(422);

    const types = data<ItMobileLineHistoryEntryDto[]>(
      await api.get(`/mobile-lines/${line.id}/history`),
    ).map((entry) => entry.type);
    expect(types.slice(0, 2)).toEqual(['reactivated', 'suspended']);
  });
});

describe('editing a line', () => {
  it('keeps a held line in its branch, edits its other facts, and keeps an eSIM serial-free', async () => {
    const line = await register();
    await handOver(line.id, { employeeId: String(EMPLOYEE) });
    const current = (): Promise<ItMobileLineDto> =>
      api.get(`/mobile-lines/${line.id}`).then((res) => data<ItMobileLineDto>(res));

    const moved = await api.patch(`/mobile-lines/${line.id}`, {
      branchId: branchBId,
      version: (await current()).version,
    });
    expect(moved.status).toBe(422);
    const replanned = await api.patch(`/mobile-lines/${line.id}`, {
      ratePlan: 'Flex 120',
      version: (await current()).version,
    });
    expect(replanned.status).toBe(200);
    expect(data<ItMobileLineDto>(replanned)).toMatchObject({
      ratePlan: 'Flex 120',
      status: 'assigned',
    });

    await api.post(`/mobile-lines/${line.id}/return`);
    const movedNow = await api.patch(`/mobile-lines/${line.id}`, {
      branchId: branchBId,
      version: (await current()).version,
    });
    expect(movedNow.status).toBe(200);
    expect(data<ItMobileLineDto>(movedNow).branchId).toBe(branchBId);

    const withSerial = await register({ simSerial: '8920022022712841111' });
    const esimKeepingSerial = await api.patch(`/mobile-lines/${withSerial.id}`, {
      simKind: 'esim',
      version: withSerial.version,
    });
    expect(esimKeepingSerial.status).toBe(422);
    const esim = await api.patch(`/mobile-lines/${withSerial.id}`, {
      simKind: 'esim',
      simSerial: null,
      version: withSerial.version,
    });
    expect(esim.status).toBe(200);
    expect(data<ItMobileLineDto>(esim)).toMatchObject({ simKind: 'esim', simSerial: null });

    const fields = data<ItMobileLineHistoryEntryDto[]>(
      await api.get(`/mobile-lines/${withSerial.id}/history?type=updated`),
    )[0]?.metadata.fields;
    expect(fields).toEqual(['simKind', 'simSerial']);
  });
});

describe('the network cards — «مع بيانات كل شبكة»', () => {
  it('count, per network, the lines the register lists under the same filters', async () => {
    const inC = { branchId: branchCId };
    const held = await register({ ...inC, network: 'vodafone', accountNumber: 'V-1' });
    await register({ ...inC, network: 'vodafone', accountNumber: 'V-1', ratePlan: 'Flex 120' });
    // No account at all — counted, as «none», rather than dropped.
    await register({ ...inC, network: 'vodafone', accountNumber: undefined, ratePlan: 'Flex 120' });
    const stopped = await register({ ...inC, network: 'orange', accountNumber: 'O-1' });
    await handOver(held.id, { employeeId: String(EMPLOYEE) });
    await api.post(`/mobile-lines/${stopped.id}/suspend`);

    const res = await api.get(`/mobile-lines/summary?branchId=${branchCId}`);
    expect(res.status).toBe(200);
    const { networks } = data<ItMobileLinesSummaryDto>(res);
    expect(networks.map((n) => n.network)).toEqual(['vodafone', 'etisalat', 'orange']);
    expect(networks[0]).toMatchObject({ total: 3, inStock: 2, assigned: 1, suspended: 0 });
    expect(networks[0]?.accounts).toEqual([
      { value: 'V-1', count: 2 },
      { value: null, count: 1 },
    ]);
    expect(networks[0]?.ratePlans).toEqual([
      { value: 'Flex 120', count: 2 },
      { value: '2025 Business Flex 80', count: 1 },
    ]);
    expect(networks[1]).toMatchObject({ total: 0, accounts: [], ratePlans: [] });
    expect(networks[2]).toMatchObject({ total: 1, suspended: 1 });

    // The same filters narrow the cards as they narrow the table.
    const heldOnly = data<ItMobileLinesSummaryDto>(
      await api.get(`/mobile-lines/summary?branchId=${branchCId}&status=assigned`),
    );
    expect(heldOnly.networks.map((n) => n.total)).toEqual([1, 0, 0]);

    // And the table, by network, lists exactly what the cards count.
    const vodafone = data<ItMobileLineDto[]>(
      await api.get(`/mobile-lines?branchId=${branchCId}&networks=vodafone`),
    );
    expect(vodafone).toHaveLength(3);
    const both = data<ItMobileLineDto[]>(
      await api.get(`/mobile-lines?branchId=${branchCId}&networks=vodafone,orange`),
    );
    expect(both).toHaveLength(4);
    // Unsorted, by network then number — Orange's line before Vodafone's.
    expect(both[0]?.network).toBe('orange');
  });
});

describe('scope', () => {
  it('a branch-A reader sees neither branch B’s lines nor their history, and hands nothing over', async () => {
    const inB = await register({ branchId: branchBId });
    expect((await api.get(`/mobile-lines/${inB.id}`, branchAToken)).status).toBe(404);
    expect((await api.get(`/mobile-lines/${inB.id}/history`, branchAToken)).status).toBe(404);
    const listed = data<ItMobileLineDto[]>(
      await api.get('/mobile-lines?pageSize=100', branchAToken),
    );
    expect(listed.some((row) => row.id === inB.id)).toBe(false);
    expect(listed.every((row) => row.branchId === branchAId)).toBe(true);

    const inA = await register();
    expect((await handOver(inA.id, { employeeId: String(EMPLOYEE) }, branchAToken)).status).toBe(
      403,
    );
    expect((await api.post(`/mobile-lines/${inA.id}/suspend`, {}, branchAToken)).status).toBe(403);
  });
});
