// POST /atm/machines/sync — a machines file compared with the branch the top bar points at, and on
// `apply` the branch made to match it, over real HTTP, real RBAC and a real workbook.
//
// The owner (2026-11-01), with the old system's list of Mohandessin's machines: «ضرورى جداً اتأكد
// إن الماكينات دى متضافه على السيستم لفرع المهندسين» — «البنك والكود والأسم والمنطقة». Pinned
// here: the comparison names what is missing, what differs (bank, name, area), what works in
// another branch, what the file cannot say and what it lists twice, and the branch's machines it
// does not list; an apply needs the comparison's hash, adds through the data-edit add, edits
// through the machine edit, brings an archived machine back, deletes nothing, refuses nothing it
// was not shown; and it is `atmMachine.manage` on the branch the top bar names.
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
  SettingKeys,
  platformPermissions,
  type AtmMachineDto,
  type AtmMachineSyncDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let viewerToken: string; // atmMachine.view only
let mohandessinId: string;
let octoberId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-machine-sync-test-${Date.now()}`;
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

/** The old system's export: sheet «ATM», header «Bank | ID | ATM Name | Area». */
const machinesFile = async (rows: (string | number)[][]): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ATM');
  ws.addRow(['Bank', 'ID', 'ATM Name', 'Area']);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const sync = (
  file: Buffer,
  opts: { token?: string; branch?: string | null; apply?: boolean; hash?: string } = {},
) => {
  let req = request(app)
    .post('/api/v1/atm/machines/sync')
    .set('Authorization', `Bearer ${opts.token ?? adminToken}`);
  if (opts.branch !== null) req = req.set('x-active-branch', opts.branch ?? mohandessinId);
  req = req.attach('file', file, 'ATM (4).xlsx');
  if (opts.apply === true) req = req.field('apply', 'true');
  if (opts.hash !== undefined) req = req.field('fileSha256', opts.hash);
  return req;
};

const addMachines = async (
  branchId: string,
  bankName: string,
  area: string,
  machines: { machineCode: string; name: string }[],
): Promise<void> => {
  const res = await request(app)
    .post('/api/v1/atm/machines/bulk')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('x-active-branch', branchId)
    .send({ bankName, area, machines });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const branchMachines = async (branchId: string): Promise<Map<string, AtmMachineDto>> => {
  const res = await request(app)
    .get('/api/v1/atm/machines?pageSize=100')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('x-active-branch', branchId);
  expect(res.status).toBe(200);
  return new Map(
    data<AtmMachineDto[]>(res)
      .filter((m) => m.branchId === branchId)
      .map((m) => [m.machineCode, m]),
  );
};

let file: Buffer;
let fileHash: string;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-sync-admin@ecms.local');
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
  adminToken = await login('atm-sync-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await request(app)
      .post('/api/v1/platform/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code, name: { ar, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  mohandessinId = await mkBranch('60', 'المهندسين', 'Mohandessin');
  octoberId = await mkBranch('61', 'أكتوبر', 'October');

  const viewerRole = await rbacService.createRole(
    { name: { en: 'Machines viewer', ar: 'مشاهد' }, permissionKeys: ['atmMachine.view'] },
    adminId,
  );
  const viewer = await mkUser('atm-sync-viewer@ecms.local', mohandessinId);
  await rbacService.ensureAssignment(viewer, String(viewerRole._id), 'branch');
  viewerToken = await login('atm-sync-viewer@ecms.local');

  // What Mohandessin holds before the file: 7101 (to be edited), 7104 (to be archived, then brought
  // back), 7105 (already right) and 7199 (not in the file). October holds 7103.
  await addMachines(mohandessinId, 'NBE', 'Zamalek', [
    { machineCode: '7101', name: 'Old name' },
    { machineCode: '7104', name: 'Archived one' },
    { machineCode: '7199', name: 'Not in the file' },
  ]);
  await addMachines(mohandessinId, 'CIB', 'Dokki', [{ machineCode: '7105', name: 'Right already' }]);
  await addMachines(octoberId, 'NBE', 'Giza', [{ machineCode: '7103', name: 'October one' }]);
  const archived = (await branchMachines(mohandessinId)).get('7104');
  const patch = await request(app)
    .patch(`/api/v1/atm/machines/${archived?.id ?? ''}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ isActive: false, version: archived?.version ?? 0 });
  expect(patch.status, JSON.stringify(patch.body)).toBe(200);

  file = await machinesFile([
    ['MISR', '7101', 'New  name', 'Omrania /  ElHaram'],
    ['NBE', '7102', 'Brand new', 'Dokki'],
    ['NBE', '7103', 'October one', 'Giza'],
    ['NBE', '7104', 'Archived one', 'Zamalek'],
    ['CIB', '07105', 'Right already', 'Dokki'],
    ['NBE', '7102', 'Listed twice', 'Giza'],
    ['NOPE', '7106', 'Unknown bank', 'Dokki'],
    ['NBE', '', '', 'Dokki'],
  ]);
  fileHash = createHash('sha256').update(file).digest('hex');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the comparison', () => {
  it('names each row’s outcome against Mohandessin, and writes nothing', async () => {
    const res = await sync(file);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<AtmMachineSyncDto>(res);
    expect(dto.fileSha256).toBe(fileHash);
    expect(dto.fileName).toBe('ATM (4).xlsx');
    expect(dto.branchName).toEqual({ ar: 'المهندسين', en: 'Mohandessin' });
    expect(dto.counts).toEqual({
      add: 1,
      reactivate: 1,
      update: 1,
      same: 1,
      elsewhere: 1,
      invalid: 2,
      duplicate: 1,
      extra: 1,
    });
    const byRow = new Map(dto.rows.map((r) => [r.row, r]));
    expect(byRow.get(2)).toMatchObject({
      machineCode: '7101',
      status: 'update',
      changes: ['bank', 'name', 'area'],
      file: { bank: 'MISR', name: 'New name', area: 'Omrania / ElHaram' },
      current: { bank: 'NBE', name: 'Old name', area: 'Zamalek' },
    });
    expect(byRow.get(3)).toMatchObject({ machineCode: '7102', status: 'add' });
    expect(byRow.get(4)).toMatchObject({ machineCode: '7103', status: 'elsewhere' });
    expect(byRow.get(5)).toMatchObject({ machineCode: '7104', status: 'reactivate' });
    // `same` rows are counted, not listed.
    expect(dto.rows.some((r) => r.machineCode === '7105')).toBe(false);
    expect(byRow.get(7)).toMatchObject({ status: 'duplicate', firstRow: 3 });
    expect(byRow.get(8)).toMatchObject({ status: 'invalid', issue: 'unknownBank' });
    expect(byRow.get(9)).toMatchObject({ status: 'invalid', issue: 'noCode' });
    expect(dto.extra).toEqual([
      { machineCode: '7199', bank: 'NBE', name: 'Not in the file', area: 'Zamalek' },
    ]);
    expect(dto.applied).toBeNull();

    const after = await branchMachines(mohandessinId);
    expect(after.has('7102')).toBe(false);
    expect(after.get('7101')?.name).toBe('Old name');
  });
});

describe('the apply', () => {
  it('needs the comparison’s hash, and refuses a different file', async () => {
    const missing = await sync(file, { apply: true });
    expect(missing.status).toBe(400);
    const other = await sync(file, { apply: true, hash: 'f'.repeat(64) });
    expect(other.status).toBe(409);
    expect((other.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.ATM_MACHINE_SYNC_FILE_CHANGED,
    );
    expect((await branchMachines(mohandessinId)).has('7102')).toBe(false);
  });

  it('adds, edits and brings back — and then compares again, the branch matching the file', async () => {
    const res = await sync(file, { apply: true, hash: fileHash });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = data<AtmMachineSyncDto>(res);
    expect(dto.applied).toMatchObject({
      added: ['7102'],
      reactivated: ['7104'],
      updated: ['7101'],
      refused: [],
      skipped: [],
    });
    // The fresh comparison: nothing left to add or edit; the rest is what an apply never touches.
    expect(dto.counts).toMatchObject({
      add: 0,
      reactivate: 0,
      update: 0,
      same: 4,
      elsewhere: 1,
      invalid: 2,
      duplicate: 1,
      extra: 1,
    });

    const after = await branchMachines(mohandessinId);
    expect(after.get('7101')).toMatchObject({
      bankName: 'MISR',
      name: 'New name',
      area: 'Omrania / ElHaram',
    });
    expect(after.get('7102')).toMatchObject({ bankName: 'NBE', name: 'Brand new', area: 'Dokki' });
    expect(after.get('7104')?.isActive).toBe(true);
    // Never deleted, never moved: the machine the file does not list, and October's own.
    expect(after.get('7199')?.isActive).toBe(true);
    expect(after.has('7103')).toBe(false);
    expect((await branchMachines(octoberId)).get('7103')?.isActive).toBe(true);
  });

  it('applied again, changes nothing', async () => {
    const res = await sync(file, { apply: true, hash: fileHash });
    expect(res.status).toBe(200);
    expect(data<AtmMachineSyncDto>(res).applied).toMatchObject({
      added: [],
      reactivated: [],
      updated: [],
    });
  });
});

describe('who may', () => {
  it('asks an organization-wide holder to pick a branch first', async () => {
    const res = await sync(file, { branch: null });
    expect(res.status).toBe(422);
  });

  it('refuses a holder of atmMachine.view alone', async () => {
    const res = await sync(file, { token: viewerToken });
    expect(res.status).toBe(403);
  });

  it('answers a file that is not a machine list with ATM_MACHINE_SYNC_LAYOUT', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['Something', 'Else']);
    const res = await sync(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.status).toBe(422);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.ATM_MACHINE_SYNC_LAYOUT,
    );
  });
});
