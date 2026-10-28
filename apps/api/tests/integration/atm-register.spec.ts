// The Efficiency register over real HTTP, real RBAC and a real replica set (transactions) — spec
// docs/12-planning/atm-efficiency-register.md §10.3, scenarios 1–32, in order.
//
// What is worth proving end to end is what the owner decided and what the review found:
//   · the register controls which machines exist (D2) — a receipt creates, re-receipt reactivates,
//     a handover archives so the mail matcher and the replenishment form stop knowing the code;
//   · one open period per code, company-wide (D6), and one ACTIVE master per code (DEC-9);
//   · secrets (D3): K values only where viewSecrets reaches, the combination never in a DTO, a log
//     line, an audit diff, the CSV or the database in the clear — and its reveal always audited;
//   · DEC-29: a department-, section- or own-scoped grant reads within its branch and writes,
//     reveals and sees nothing secret — and outside its branch it sees nothing at all;
//   · the Data Report's numbers, including the regressions the spec names (an NXT handover, an
//     Alexandria NXT counted under NXT and never HDB, an Alexandria HDB counted once);
//   · the bank catalog (DEC-35): a bank added at runtime is a full register bank — offered by the
//     meta, received with its own Operations label, counted in the report after the sheet's six —
//     an unknown or archived bank is refused for a NEW value, and an override must be a spelling OF
//     THE ENTRY'S BANK (DEC-25, enforced on the server now);
//   · «بيانات ناقصة» (DEC-37): a stored flag Efficiency sets and clears, filtered and exported, and
//     audited.
//
// Every machine code, key code and combination below is synthetic. No value of the owner's
// workbook appears in this file.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  AtmSettingKeys,
  REALTIME_BROADCAST_ACTIONS,
  SettingKeys,
  platformPermissions,
  realtimeTopic,
  topicRoom,
  type AtmBankDto,
  type AtmRegisterBranchOptionsDto,
  type AtmRegisterEntryDto,
  type AtmRegisterMetaDto,
  type AtmRegisterReportDto,
  type AtmRegisterRevealDto,
  type AtmRegisterWriteResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmModule, atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { cryptoService } from '../../src/platform/crypto';
import { unitOfWork } from '../../src/platform/kernel/unit-of-work';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { REALTIME_TOPICS } from '../../src/platform/realtime/realtime-registry';
import { BranchModel } from '../../src/platform/organization/branches/branch.model';
import { env } from '../../src/infrastructure/config/env';
import { emitToRoom } from '../../src/infrastructure/realtime/socket-server';
import type * as SocketServer from '../../src/infrastructure/realtime/socket-server';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { AtmMachineModel, type AtmMachineDoc } from '../../src/modules/atm/machines/machine.model';
import { AtmRefLabelModel } from '../../src/modules/atm/catalogs/ref-label.model';
import { atmMailIngestionService } from '../../src/modules/atm/mail-tickets/mail-ingestion.service';
import { migrateAtmLegacyTimestamps } from '../../src/modules/atm/machines/machine.migration';
import {
  AtmRegisterEntryModel,
  type AtmRegisterEntryDoc,
} from '../../src/modules/atm/register/register.model';
import { syncMasterAreaToEntries } from '../../src/modules/atm/register/register-coupling';
import { rotateRegisterCombinationKeys } from '../../src/modules/atm/register/register-secrets';
import { type AuthContext } from '../../src/shared/types';

// Scenario 24 watches the publisher's ONE output seam; everything still reaches the real emitter.
vi.mock('../../src/infrastructure/realtime/socket-server', async (importOriginal) => {
  const actual = await importOriginal<typeof SocketServer>();
  return { ...actual, emitToRoom: vi.fn(actual.emitToRoom) };
});

const PASSWORD = 'Str0ng#Pass!';
// Synthetic secrets — asserted ABSENT from every place they must never reach.
const COMBO = '12 - 34 - 56';
const COMBO_2 = '65 - 43 - 21';
const KEY_CODE = 'SUP-FAKE-4821';
const NOTE = 'note-fake-receipt-77';
const KEY_B = Buffer.alloc(32, 9).toString('base64');

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminId: string;
let adminToken: string;
let effOrgId: string;
let effOrgToken: string; // every register key, organization scope, placed nowhere
let noSecretsToken: string; // the same minus viewSecrets
let tantaToken: string; // every register key, BRANCH scope, placed in Tanta
let deptToken: string; // every register key, DEPARTMENT scope, placed in a Tanta department
let sectionToken: string; // every register key, SECTION scope, placed in a Tanta section
let ownId: string;
let ownToken: string; // every register key, OWN scope, placed in Tanta
let deptReachToken: string; // department grant reaching Alexandria's copy only, placed in Tanta
let reportToken: string; // atmRegisterReport.view only, organization
let reportTantaToken: string; // atmRegisterReport.view only, branch scope in Tanta
let alexBranchId: string;
let tantaBranchId: string;
let cairoBranchId: string; // a live branch nobody mapped
let inactiveBranchId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-register-test-${Date.now()}`;
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
  placement: { branchId?: string; departmentId?: string; sectionId?: string } = {},
): Promise<string> => {
  const { user } = await userService.create(
    {
      email,
      firstName: { ar: 'م', en: 'T' },
      lastName: { ar: 'م', en: 'T' },
      locale: 'en',
      organization: {
        branchId: placement.branchId ?? null,
        departmentId: placement.departmentId ?? null,
        sectionId: placement.sectionId ?? null,
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
const errorCode = (res: request.Response): string =>
  (res.body as { error?: { code?: string } }).error?.code ?? '';
const errorMessage = (res: request.Response): string =>
  (res.body as { error?: { message?: string } }).error?.message ?? '';

const call = (
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  token: string,
  body?: Record<string, unknown>,
  activeBranch?: string,
): request.Test => {
  let req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (activeBranch !== undefined) req = req.set('x-active-branch', activeBranch);
  return body === undefined ? req : req.send(body);
};

const receipt = (over: Record<string, unknown>): Record<string, unknown> => ({
  branchId: alexBranchId,
  bankCode: 'NBE',
  area: 'Smouha',
  name: 'Register Test ATM',
  startDate: '2026-09-01',
  ...over,
});

const receive = async (
  token: string,
  over: Record<string, unknown>,
): Promise<AtmRegisterWriteResultDto> => {
  const res = await call('post', '/atm/register/entries', token, receipt(over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<AtmRegisterWriteResultDto>(res);
};

const getEntry = async (id: string, token = effOrgToken): Promise<AtmRegisterEntryDto> => {
  const res = await call('get', `/atm/register/entries/${id}`, token);
  expect(res.status).toBe(200);
  return data<AtmRegisterEntryDto>(res);
};

const masterOf = async (branchId: string, machineCode: string): Promise<AtmMachineDoc | null> =>
  AtmMachineModel.findOne({
    branchId: new Types.ObjectId(branchId),
    machineCode,
    isDeleted: false,
  })
    .lean<AtmMachineDoc>()
    .exec();

/** Admin adds an Operations machine in a branch, through the existing data-edit route. */
const addMachine = async (
  branchId: string,
  body: { machineCode: string; name: string; bankName: string; area: string },
): Promise<string> => {
  const res = await call('post', '/atm/machines', adminToken, body, branchId);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{ id: string }>(res).id;
};

/** An entry written as the IMPORT writes it (WP-B) — straight into the collection. */
const insertEntry = async (over: Partial<AtmRegisterEntryDoc>): Promise<AtmRegisterEntryDoc> => {
  const [doc] = await AtmRegisterEntryModel.create([
    {
      branchId: new Types.ObjectId(alexBranchId),
      area: null,
      bankCode: 'NBE',
      machineCode: null,
      name: 'Imported ATM',
      startDate: new Date('2025-06-01T00:00:00.000Z'),
      status: 'open',
      source: 'import',
      ...over,
    },
  ]);
  return (doc as unknown as { toObject: () => AtmRegisterEntryDoc }).toObject();
};

const report = async (token: string): Promise<AtmRegisterReportDto> => {
  const res = await call('get', '/atm/register/report', token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmRegisterReportDto>(res);
};

const auditRows = async (entityId: string, action: string) =>
  AuditLogModel.find({ 'entityRef.entityId': entityId, action }).lean().exec();

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  adminId = await mkUser('register-admin@ecms.local');
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
  adminToken = await login('register-admin@ecms.local');

  const post = async (path: string, body: Record<string, unknown>): Promise<string> => {
    const res = await call('post', path, adminToken, body);
    expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(201);
    return data<{ id: string }>(res).id;
  };
  alexBranchId = await post('/platform/branches', {
    code: '80',
    name: { ar: 'الإسكندرية', en: 'Alexandria' },
  });
  tantaBranchId = await post('/platform/branches', {
    code: '81',
    name: { ar: 'طنطا', en: 'Tanta' },
  });
  cairoBranchId = await post('/platform/branches', {
    code: '82',
    name: { ar: 'القاهرة', en: 'Cairo' },
  });
  inactiveBranchId = await post('/platform/branches', {
    code: '83',
    name: { ar: 'مغلق', en: 'Closed' },
  });
  await BranchModel.updateOne(
    { _id: new Types.ObjectId(inactiveBranchId) },
    { status: 'inactive' },
  ).exec();
  const tantaDept = await post('/platform/departments', {
    code: 'REG-T-OPS',
    name: { ar: 'الكفاءة', en: 'Efficiency' },
    branchId: tantaBranchId,
  });
  const tantaSection = await post('/platform/sections', {
    code: 'REG-T-SEC',
    name: { ar: 'التحقيقات', en: 'Investigations' },
    departmentId: tantaDept,
  });
  const effCatalog = await post('/platform/department-catalog', {
    code: 'REG-EFF',
    name: { ar: 'الكفاءة والتحقيقات', en: 'Efficiency & Investigations' },
  });
  await post('/platform/departments', {
    code: 'REG-EFF-A',
    branchId: alexBranchId,
    catalogId: effCatalog,
  });

  await settingsService.set(ctx, {
    key: AtmSettingKeys.RegisterBranchCodes,
    scope: 'organization',
    value: [
      { code: 'EGYCASH-4', branchId: alexBranchId },
      { code: 'EGYCASH-2', branchId: tantaBranchId },
    ],
  });

  const EFFICIENCY = [
    'atmRegister.view',
    'atmRegister.create',
    'atmRegister.edit',
    'atmRegister.delete',
    'atmRegister.export',
    'atmRegister.handover',
    'atmRegister.viewSecrets',
    'atmRegister.import',
    'atmRegisterReport.view',
    'atmMachine.view',
  ];
  const role = async (en: string, permissionKeys: string[]): Promise<string> =>
    String((await rbacService.createRole({ name: { en, ar: en }, permissionKeys }, adminId))._id);
  const efficiency = await role('Efficiency', EFFICIENCY);
  const noSecrets = await role(
    'Efficiency without secrets',
    EFFICIENCY.filter((k) => k !== 'atmRegister.viewSecrets'),
  );
  const reportOnly = await role('Data Report reader', ['atmRegisterReport.view']);

  effOrgId = await mkUser('register-eff@ecms.local');
  await rbacService.ensureAssignment(effOrgId, efficiency, 'organization');
  effOrgToken = await login('register-eff@ecms.local');

  const noSecretsId = await mkUser('register-nosecrets@ecms.local');
  await rbacService.ensureAssignment(noSecretsId, noSecrets, 'organization');
  noSecretsToken = await login('register-nosecrets@ecms.local');

  const tantaId = await mkUser('register-tanta@ecms.local', { branchId: tantaBranchId });
  await rbacService.ensureAssignment(tantaId, efficiency, 'branch');
  tantaToken = await login('register-tanta@ecms.local');

  const deptId = await mkUser('register-dept@ecms.local', {
    branchId: tantaBranchId,
    departmentId: tantaDept,
  });
  await rbacService.ensureAssignment(deptId, efficiency, 'department');
  deptToken = await login('register-dept@ecms.local');

  const sectionId = await mkUser('register-section@ecms.local', {
    branchId: tantaBranchId,
    departmentId: tantaDept,
    sectionId: tantaSection,
  });
  await rbacService.ensureAssignment(sectionId, efficiency, 'section');
  sectionToken = await login('register-section@ecms.local');

  ownId = await mkUser('register-own@ecms.local', { branchId: tantaBranchId });
  await rbacService.ensureAssignment(ownId, efficiency, 'own');
  ownToken = await login('register-own@ecms.local');

  // «Efficiency & Investigations» in Alexandria only, held by somebody placed in Tanta: a
  // department reach that does not include the holder's own branch (scenario 27).
  const deptReachId = await mkUser('register-deptreach@ecms.local', {
    branchId: tantaBranchId,
    departmentId: tantaDept,
  });
  await rbacService.assignRole(
    {
      userId: deptReachId,
      roleId: efficiency,
      scope: 'department',
      departmentCatalogId: effCatalog,
      branchIds: [alexBranchId],
    },
    adminId,
  );
  deptReachToken = await login('register-deptreach@ecms.local');

  const reportId = await mkUser('register-report@ecms.local');
  await rbacService.ensureAssignment(reportId, reportOnly, 'organization');
  reportToken = await login('register-report@ecms.local');

  const reportTantaId = await mkUser('register-report-tanta@ecms.local', {
    branchId: tantaBranchId,
  });
  await rbacService.ensureAssignment(reportTantaId, reportOnly, 'branch');
  reportTantaToken = await login('register-report-tanta@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('receive, and the master it controls (D2, D4, D6)', () => {
  let receivedId: string;

  it('1 — a receipt opens the period and CREATES the Operations machine', async () => {
    const result = await receive(effOrgToken, { machineCode: '99990001' });
    receivedId = result.entry.id;
    expect(result.entry.status).toBe('open');
    expect(result.entry.branchCode).toBe('EGYCASH-4');
    expect(result.entry.masterState).toBe('active');
    expect(result.master.action).toBe('create');
    const master = await masterOf(alexBranchId, '99990001');
    expect(master).toMatchObject({ isActive: true, bankName: 'NBE', zone: '', area: 'Smouha' });
    expect(String(master?._id)).toBe(result.master.machineId);
    // O-2: a new entry audits as `create`; its machine audits its own `create`.
    expect(await auditRows(receivedId, 'create')).toHaveLength(1);
    expect(await auditRows(String(master?._id), 'create')).toHaveLength(1);
  });

  it('2 — a Tanta-scoped holder cannot receive into Alexandria', async () => {
    const res = await call(
      'post',
      '/atm/register/entries',
      tantaToken,
      receipt({ machineCode: '99990002' }),
    );
    expect(res.status).toBe(403);
    expect(await AtmRegisterEntryModel.countDocuments({ machineCode: '99990002' })).toBe(0);
    expect(await masterOf(alexBranchId, '99990002')).toBeNull();
  });

  it('3 — an unknown or inactive branch is 400; a live but unmapped branch is 422', async () => {
    const unknown = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990003', branchId: new Types.ObjectId().toHexString() }),
    );
    expect(unknown.status).toBe(400);
    const inactive = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990003', branchId: inactiveBranchId }),
    );
    expect(inactive.status).toBe(400);
    const unmapped = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990003', branchId: cairoBranchId }),
    );
    expect(unmapped.status).toBe(422);
    expect(errorCode(unmapped)).toBe('ATM_REGISTER_BRANCH_UNMAPPED');
  });

  it('4 — a second open period of the same code is refused, in the same branch or another', async () => {
    for (const branchId of [alexBranchId, tantaBranchId]) {
      const res = await call(
        'post',
        '/atm/register/entries',
        effOrgToken,
        receipt({ machineCode: '99990001', branchId }),
      );
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('ATM_REGISTER_OPEN_PERIOD_EXISTS');
    }
  });

  it('5 — a code ACTIVE in another branch’s Operations list is refused (DEC-9)', async () => {
    await addMachine(tantaBranchId, {
      machineCode: '99990005',
      name: 'Tanta ATM',
      bankName: 'NBE',
      area: 'Tanta Center',
    });
    const res = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990005' }),
    );
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ATM_REGISTER_CODE_ACTIVE_ELSEWHERE');
    expect(await masterOf(alexBranchId, '99990005')).toBeNull();
  });

  it('6 — a receipt needs an area; a pending entry does not, and touches no master', async () => {
    const noArea = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990006', area: null }),
    );
    expect(noArea.status).toBe(400);
    const pending = await call('post', '/atm/register/entries', effOrgToken, {
      branchId: alexBranchId,
      machineCode: '99990006',
      bankCode: 'NBE',
      name: 'Planned ATM',
    });
    expect(pending.status).toBe(201);
    const body = data<AtmRegisterWriteResultDto>(pending);
    expect(body.entry.status).toBe('pending');
    expect(body.entry.machineId).toBeNull();
    expect(body.entry.masterState).toBeNull();
    expect(body.master.action).toBe('none');
    expect(await masterOf(alexBranchId, '99990006')).toBeNull();
  });

  it('7 — a HANDOVER archives the master: the mail matcher and the replenishment form stop knowing it', async () => {
    const entry = await getEntry(receivedId);
    const res = await call('post', `/atm/register/entries/${receivedId}/handover`, effOrgToken, {
      endDate: '2026-09-20',
      version: entry.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const result = data<AtmRegisterWriteResultDto>(res);
    expect(result.entry.status).toBe('ended');
    expect(result.master.action).toBe('archive');
    expect((await masterOf(alexBranchId, '99990001'))?.isActive).toBe(false);

    const mail = await atmMailIngestionService.ingest({
      providerMessageId: `register-${Date.now()}`,
      receivedAt: new Date(),
      senderEmail: 'bank@example.test',
      subject: '',
      bodyText: 'machine number: 1234_99990001 ticket subject: X "Cash out" ticket number: 55',
    });
    expect(mail.outcome).toBe('unmatched');

    const opened = await call(
      'post',
      '/atm/replenishments/open',
      adminToken,
      { rows: [{ machineCode: '99990001', scheduleTime: null }], forceDate: null },
      alexBranchId,
    );
    expect(opened.status).toBe(200);
    expect(data<{ unknownCodes: string[] }>(opened).unknownCodes).toEqual(['99990001']);

    // O-2: open → ended audits as `statusChange`, the transition in its diff.
    const [audit] = await auditRows(receivedId, 'statusChange');
    expect(audit?.changes).toContainEqual({ field: 'status', old: 'open', new: 'ended' });
  });

  it('8 — RE-RECEIPT reactivates the SAME master with the new entry’s name, area and label', async () => {
    const before = await masterOf(alexBranchId, '99990001');
    const result = await receive(effOrgToken, {
      machineCode: '99990001',
      name: 'Renamed ATM',
      area: 'Roushdy',
    });
    expect(result.master.action).toBe('reactivate');
    const after = await masterOf(alexBranchId, '99990001');
    expect(String(after?._id)).toBe(String(before?._id));
    expect(after).toMatchObject({
      isActive: true,
      name: 'Renamed ATM',
      area: 'Roushdy',
      bankName: 'NBE',
    });
    const list = await call('get', '/atm/register/entries?search=99990001', effOrgToken);
    expect(
      data<AtmRegisterEntryDto[]>(list)
        .map((e) => e.status)
        .sort(),
    ).toEqual(['ended', 'open']);
  });

  it('9 — LINK: an active master is adopted, never rewritten (D5, DEC-8)', async () => {
    const masterId = await addMachine(alexBranchId, {
      machineCode: '9990009',
      name: 'Master Name',
      bankName: 'MISR',
      area: 'Area A',
    });
    const result = await receive(effOrgToken, {
      machineCode: '9990009',
      bankCode: 'BM',
      area: 'Area A',
      name: 'A Different Name',
    });
    expect(result.master).toEqual({ action: 'link', machineId: masterId });
    expect(result.entry.opsBankLabel).toBe('MISR');
    expect(result.warnings).toContain('masterDiffers');
    expect(await masterOf(alexBranchId, '9990009')).toMatchObject({
      name: 'Master Name',
      bankName: 'MISR',
      area: 'Area A',
    });
  });

  it('10 — editing an OPEN entry carries name, area and bank label to the master; an ended one does not', async () => {
    const [open] = data<AtmRegisterEntryDto[]>(
      await call('get', '/atm/register/entries?search=99990001&statuses=open', effOrgToken),
    );
    if (open === undefined) throw new Error('no open entry for 99990001');
    const res = await call('patch', `/atm/register/entries/${open.id}`, effOrgToken, {
      name: 'Edited ATM',
      area: 'Sidi Gaber',
      bankCode: 'BM',
      version: open.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(data<AtmRegisterWriteResultDto>(res).master.action).toBe('sync');
    expect(await masterOf(alexBranchId, '99990001')).toMatchObject({
      name: 'Edited ATM',
      area: 'Sidi Gaber',
      bankName: 'MISR', // BM → the setting's default label; the NBE override was cleared (DEC-25)
    });

    const [ended] = data<AtmRegisterEntryDto[]>(
      await call('get', '/atm/register/entries?search=99990001&statuses=ended', effOrgToken),
    );
    if (ended === undefined) throw new Error('no ended entry for 99990001');
    const edited = await call('patch', `/atm/register/entries/${ended.id}`, effOrgToken, {
      name: 'History Rewritten',
      version: ended.version,
    });
    expect(edited.status).toBe(200);
    expect(data<AtmRegisterWriteResultDto>(edited).master.action).toBe('none');
    expect((await masterOf(alexBranchId, '99990001'))?.name).toBe('Edited ATM');
  });

  it('11 — an Operations area move carries the area onto the open entries (DEC-4, coupling half)', async () => {
    // The HTTP route (`PATCH /atm/machines/:id/area`) is the data-edit split's; its suite drives it.
    // This proves the coupling it calls: the master's open entries follow, each audited.
    const master = await masterOf(alexBranchId, '99990001');
    if (master === null) throw new Error('no master');
    const audits = await unitOfWork((session) =>
      syncMasterAreaToEntries(master._id, 'Moved Area', adminId, session),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.entityRef.entityType).toBe('registerEntry');
    const [open] = data<AtmRegisterEntryDto[]>(
      await call('get', '/atm/register/entries?search=99990001&statuses=open', effOrgToken),
    );
    expect(open?.area).toBe('Moved Area');
  });

  it('12 — deleting the only open entry archives its master; a second open entry keeps it', async () => {
    const only = await receive(effOrgToken, { machineCode: '99990011' });
    const res = await call('delete', `/atm/register/entries/${only.entry.id}`, effOrgToken, {
      version: only.entry.version,
    });
    expect(res.status).toBe(204);
    expect((await masterOf(alexBranchId, '99990011'))?.isActive).toBe(false);
    expect(await auditRows(only.entry.id, 'delete')).toHaveLength(1);

    const first = await receive(effOrgToken, { machineCode: '99990012' });
    // The imported duplicate-open pair shape (DEC-11): a second open entry on the same master.
    await insertEntry({
      machineCode: '99990012',
      area: 'Smouha',
      machineId: new Types.ObjectId(first.master.machineId ?? undefined),
      openPeriodExempt: true,
      importRow: 900012,
    });
    const deleted = await call('delete', `/atm/register/entries/${first.entry.id}`, effOrgToken, {
      version: first.entry.version,
    });
    expect(deleted.status).toBe(204);
    expect((await masterOf(alexBranchId, '99990012'))?.isActive).toBe(true);
  });
});

describe('secrets (D3, DEC-7)', () => {
  let secretId: string;
  let emptyId: string;

  beforeAll(async () => {
    const result = await receive(effOrgToken, {
      machineCode: '99990013',
      keys: { supervisorCode: KEY_CODE, supervisorCount: '2' },
      receiptNotes: NOTE,
      safeCombination: COMBO,
    });
    secretId = result.entry.id;
    emptyId = (await receive(effOrgToken, { machineCode: '99990016' })).entry.id;
  });

  it('13 — hidden from a holder without viewSecrets: K null, the combination only as a flag', async () => {
    const res = await call('get', '/atm/register/entries?search=99990013', noSecretsToken);
    expect(res.status).toBe(200);
    const [entry] = data<AtmRegisterEntryDto[]>(res);
    expect(entry).toMatchObject({
      secretsVisible: false,
      keys: null,
      receiptNotes: null,
      handoverNotes: null,
      safeCombinationSet: true,
    });
    expect(res.text).not.toContain(COMBO);
    expect(res.text).not.toContain(KEY_CODE);
    expect(res.text).not.toContain(NOTE);
  });

  it('14 — present for a viewSecrets holder, still without any safeCombination property', async () => {
    const res = await call('get', `/atm/register/entries/${secretId}`, effOrgToken);
    const entry = data<AtmRegisterEntryDto>(res);
    expect(entry.secretsVisible).toBe(true);
    expect(entry.keys?.supervisorCode).toBe(KEY_CODE);
    expect(entry.receiptNotes).toBe(NOTE);
    expect(entry).not.toHaveProperty('safeCombination');
    expect(res.text).not.toContain(COMBO);
  });

  it('15 — writing a K or S field without viewSecrets is refused (write implies read)', async () => {
    const created = await call(
      'post',
      '/atm/register/entries',
      noSecretsToken,
      receipt({ machineCode: '99990015', keys: { alanki: 'x' } }),
    );
    expect(created.status).toBe(403);
    const entry = await getEntry(secretId);
    for (const body of [
      { keys: { supervisorCode: 'SUP-OVERWRITE' } },
      { receiptNotes: 'overwrite' },
      { safeCombination: null },
    ]) {
      const res = await call('patch', `/atm/register/entries/${secretId}`, noSecretsToken, {
        ...body,
        version: entry.version,
      });
      expect(res.status).toBe(403);
    }
  });

  it('16 — REVEAL: refused without the key; the value for a holder; always audited, even when empty', async () => {
    expect(
      (await call('post', `/atm/register/entries/${secretId}/reveal`, noSecretsToken)).status,
    ).toBe(403);
    const res = await call('post', `/atm/register/entries/${secretId}/reveal`, effOrgToken);
    expect(res.status).toBe(200);
    expect(data<AtmRegisterRevealDto>(res).safeCombination).toBe(COMBO);
    const [audit] = await auditRows(secretId, 'secretRevealed');
    expect(String(audit?.actor.userId)).toBe(effOrgId);
    expect(audit?.changes).toEqual([{ field: 'safeCombination', old: null, new: '[revealed]' }]);

    const empty = await call('post', `/atm/register/entries/${emptyId}/reveal`, effOrgToken);
    expect(data<AtmRegisterRevealDto>(empty).safeCombination).toBeNull();
    const [emptyAudit] = await auditRows(emptyId, 'secretRevealed');
    expect(emptyAudit?.changes).toEqual([{ field: 'safeCombination', old: null, new: '[none]' }]);
  });

  it('17 — at rest the combination is a sealed ref, never the plaintext', async () => {
    const raw = await AtmRegisterEntryModel.collection.findOne({
      _id: new Types.ObjectId(secretId),
    });
    expect(raw?.safeCombination).toMatchObject({ provider: 'platformCrypto' });
    expect(JSON.stringify(raw)).not.toContain(COMBO);
  });

  it('18 — audit diffs are redacted; no audit row anywhere carries a key code or the combination', async () => {
    const entry = await getEntry(secretId);
    const res = await call('patch', `/atm/register/entries/${secretId}`, effOrgToken, {
      keys: { supervisorCode: 'SUP-FAKE-9911' },
      safeCombination: COMBO_2,
      version: entry.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [audit] = await auditRows(secretId, 'update');
    expect(audit?.changes).toEqual(
      expect.arrayContaining([
        { field: 'keys.supervisorCode', old: '[redacted]', new: '[redacted]' },
        { field: 'safeCombination', old: '[redacted]', new: '[redacted]' },
      ]),
    );
    const everything = JSON.stringify(await AuditLogModel.find({}).lean().exec());
    for (const secret of [COMBO, COMBO_2, KEY_CODE, 'SUP-FAKE-9911', NOTE]) {
      expect(everything).not.toContain(secret);
    }
    const reveal = await call('post', `/atm/register/entries/${secretId}/reveal`, effOrgToken);
    expect(data<AtmRegisterRevealDto>(reveal).safeCombination).toBe(COMBO_2);
  });

  it('19 — EXPORT: BOM, public columns only, Status then Data incomplete last, audited; refused without the key', async () => {
    const res = await call('get', '/atm/register/entries/export', effOrgToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.startsWith('﻿')).toBe(true);
    const header = res.text.slice(1).split('\n')[0] ?? '';
    for (const secretHeader of [
      'Supervisor',
      'Combination',
      'Notes Received',
      'Notes Delivered',
      'Alanki',
    ]) {
      expect(header).not.toContain(secretHeader);
    }
    expect(header.split(',').slice(-2)).toEqual(['Status', 'Data incomplete']);
    expect(res.text).toContain('99990013');
    for (const secret of [COMBO, COMBO_2, 'SUP-FAKE-9911', NOTE])
      expect(res.text).not.toContain(secret);
    // The export is audited AFTER the stream ends (register-export.ts), so the response can
    // arrive first — under a loaded run an immediate read raced it.
    await vi.waitFor(async () => {
      expect(await auditRows('export', 'export')).not.toHaveLength(0);
    });
    expect((await call('get', '/atm/register/entries/export', reportToken)).status).toBe(403);
  });
});

describe('the Data Report (D7)', () => {
  it('20 — numbers: the NXT handover and the Alexandria HDB/NXT regressions', async () => {
    const before = await report(effOrgToken);
    await receive(effOrgToken, { machineCode: '99990101' });
    await receive(effOrgToken, { machineCode: '99990102' });
    await receive(effOrgToken, { machineCode: 'HDB - 9103', bankCode: 'HDB' });
    await receive(effOrgToken, { machineCode: 'ATM9104', bankCode: 'NXT' });
    const handedOver = await receive(effOrgToken, { machineCode: 'ATM9105', bankCode: 'NXT' });
    await receive(effOrgToken, { machineCode: '9990106', bankCode: 'BM', branchId: tantaBranchId });
    const pending = await call('post', '/atm/register/entries', effOrgToken, {
      branchId: alexBranchId,
      machineCode: '99990107',
      bankCode: 'NBE',
      name: 'Pending ATM',
    });
    expect(pending.status).toBe(201);
    const ho = await call(
      'post',
      `/atm/register/entries/${handedOver.entry.id}/handover`,
      effOrgToken,
      {
        endDate: '2026-09-30',
        version: handedOver.entry.version,
      },
    );
    expect(ho.status).toBe(200);

    const after = await report(effOrgToken);
    const alexBefore = before.counts.section3['EGYCASH-4'];
    const alexAfter = after.counts.section3['EGYCASH-4'];
    if (alexBefore === undefined || alexAfter === undefined)
      throw new Error('Alexandria not shown');
    // Section 3, Alexandria: NBE +2, HDB +1, NXT +1 — the NXT counted under NXT, never HDB; the
    // HDB counted once; the handed-over NXT and the pending NBE nowhere.
    // The catalog folds every bank (DEC-40); a seed's cell is always there, so `?? NaN` only makes
    // a missing one fail loudly instead of reading as 0.
    const cell = (row: Record<string, number>, bank: string): number => row[bank] ?? NaN;
    expect(cell(alexAfter, 'NBE') - cell(alexBefore, 'NBE')).toBe(2);
    expect(cell(alexAfter, 'HDB') - cell(alexBefore, 'HDB')).toBe(1);
    expect(cell(alexAfter, 'NXT') - cell(alexBefore, 'NXT')).toBe(1);
    expect(cell(alexAfter, 'BM') - cell(alexBefore, 'BM')).toBe(0);
    expect(cell(alexAfter, 'CIB') - cell(alexBefore, 'CIB')).toBe(0);
    expect(cell(alexAfter, 'BRK') - cell(alexBefore, 'BRK')).toBe(0);
    expect(cell(after.counts.section1, 'NXT') - cell(before.counts.section1, 'NXT')).toBe(1);
    expect(after.counts.section1.total - before.counts.section1.total).toBe(5);
    expect(after.counts.section2.total - before.counts.section2.total).toBe(5);
    expect(
      (after.counts.section2['EGYCASH-2'] ?? 0) - (before.counts.section2['EGYCASH-2'] ?? 0),
    ).toBe(1);
    expect(after.counts.section1.total).toBe(
      after.counts.section2.total + after.counts.activeWithUnmappedBranch,
    );
    // Zeros present, never absent.
    expect(after.branchesShown).toEqual(['EGYCASH-2', 'EGYCASH-4']);
    expect(Object.keys(after.counts.section3['EGYCASH-2'] ?? {}).sort()).toEqual([
      'BM',
      'BRK',
      'CIB',
      'HDB',
      'NBE',
      'NXT',
    ]);
    expect(after.counts.section3['EGYCASH-2']?.CIB).toBe(0);
    expect(Number.isNaN(Date.parse(after.generatedAt))).toBe(false);
  });

  it('21 — the report is its own key: a report reader cannot list entries; a Tanta reader sees Tanta', async () => {
    expect((await call('get', '/atm/register/report', reportToken)).status).toBe(200);
    expect((await call('get', '/atm/register/entries', reportToken)).status).toBe(403);
    const tanta = await report(reportTantaToken);
    expect(tanta.branchesShown).toEqual(['EGYCASH-2']);
    expect(Object.keys(tanta.counts.section3)).toEqual(['EGYCASH-2']);
    expect(tanta.counts.section1.total).toBe(tanta.counts.section2.total);
  });
});

describe('versions and legacy masters', () => {
  it('22 — a stale version is 409 on edit, handover and delete', async () => {
    const result = await receive(effOrgToken, { machineCode: '99990022' });
    const stale = result.entry.version + 5;
    const edit = await call('patch', `/atm/register/entries/${result.entry.id}`, effOrgToken, {
      name: 'x',
      version: stale,
    });
    const ho = await call(
      'post',
      `/atm/register/entries/${result.entry.id}/handover`,
      effOrgToken,
      {
        endDate: '2026-09-30',
        version: stale,
      },
    );
    const del = await call('delete', `/atm/register/entries/${result.entry.id}`, effOrgToken, {
      version: stale,
    });
    for (const res of [edit, ho, del]) {
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('STALE_DOCUMENT');
    }
  });

  it('23 — a legacy master without __v/createdAt is linked, served and backfilled (DEC-23)', async () => {
    const legacy = (code: string) => ({
      _id: new Types.ObjectId(),
      branchId: new Types.ObjectId(alexBranchId),
      bankName: 'NBE',
      machineCode: code,
      name: 'Legacy ATM',
      zone: '',
      area: 'Smouha',
      isActive: true,
      isDeleted: false,
      schemaVersion: 1,
    });
    const linkedRow = legacy('99990023');
    const servedRow = legacy('99990024');
    await AtmMachineModel.collection.insertMany([linkedRow, servedRow]);
    await AtmRefLabelModel.collection.insertOne({
      _id: new Types.ObjectId(),
      branchId: new Types.ObjectId(alexBranchId),
      kind: 'area',
      name: 'Legacy Area',
      isActive: true,
      isDeleted: false,
      schemaVersion: 1,
    });

    const result = await receive(effOrgToken, { machineCode: '99990023' });
    expect(result.master).toEqual({ action: 'link', machineId: String(linkedRow._id) });

    // Served before the backfill (the mappers tolerate the gap)…
    const listed = await call(
      'get',
      '/atm/machines?pageSize=100&search=9999002',
      adminToken,
      undefined,
      alexBranchId,
    );
    expect(listed.status).toBe(200);
    // …and backfilled at boot.
    const done = await migrateAtmLegacyTimestamps();
    expect(done.versioned).toBeGreaterThanOrEqual(2); // the second machine and the label
    const backfilled = await AtmMachineModel.collection.findOne({ _id: servedRow._id });
    expect(backfilled?.__v).toBe(0);
    expect(backfilled?.createdAt).toEqual(servedRow._id.getTimestamp());
    expect(await migrateAtmLegacyTimestamps()).toEqual({ versioned: 0, timestamped: 0 });
    expect(
      (await call('get', '/atm/machines?pageSize=100', adminToken, undefined, alexBranchId)).status,
    ).toBe(200);
  });
});

describe('realtime (O-2)', () => {
  it('24 — receipts and handovers audit with verbs that broadcast; the reveal and the export do not', async () => {
    const emitted = vi.mocked(emitToRoom);
    emitted.mockClear();
    const result = await receive(effOrgToken, { machineCode: '99990240' });
    await call('post', `/atm/register/entries/${result.entry.id}/handover`, effOrgToken, {
      endDate: '2026-09-30',
      version: result.entry.version,
    });
    const payloads = emitted.mock.calls
      .map(([room, , payload]) => ({
        room,
        payload: payload as { entity: string; action: string; entityId: string },
      }))
      .filter((call) => call.payload.entityId === result.entry.id);
    const actions = payloads.map((p) => p.payload.action);
    expect(actions).toContain('create');
    expect(actions).toContain('statusChange');
    for (const action of ['create', 'statusChange', 'update', 'delete']) {
      expect(REALTIME_BROADCAST_ACTIONS as readonly string[]).toContain(action);
    }
    for (const action of ['secretRevealed', 'atmRegisterImport', 'export']) {
      expect(REALTIME_BROADCAST_ACTIONS as readonly string[]).not.toContain(action);
    }
    // The entity-topic room is joined only once the realtime registry classifies the entity
    // (spec §5.10 — the registry file is not this package's); from then on the signal reaches it.
    const topic = realtimeTopic('atm', 'registerEntry');
    if (topic in REALTIME_TOPICS) {
      expect(payloads.map((p) => p.room)).toContain(topicRoom(topic));
    }
  });
});

describe('scope — DEC-29', () => {
  let alexSecretId: string;
  let alexMasterId: string | null;
  let tantaId: string;
  let ownEntryId: string;

  beforeAll(async () => {
    const alex = await receive(effOrgToken, {
      machineCode: '99990025',
      keys: { cashUnitCode: 'CASH-FAKE-1' },
      safeCombination: COMBO,
    });
    alexSecretId = alex.entry.id;
    alexMasterId = alex.master.machineId;
    tantaId = (
      await receive(effOrgToken, {
        machineCode: '99990026',
        branchId: tantaBranchId,
        keys: { cashUnitCode: 'CASH-FAKE-2' },
        safeCombination: COMBO,
      })
    ).entry.id;
    ownEntryId = String(
      (
        await insertEntry({
          branchId: new Types.ObjectId(tantaBranchId),
          machineCode: '99990027',
          area: 'Tanta Center',
          createdBy: new Types.ObjectId(ownId),
          importRow: 900027,
        })
      )._id,
    );
  });

  const writes = (id: string, version: number) => [
    { method: 'get' as const, path: `/atm/register/entries/${id}` },
    { method: 'post' as const, path: `/atm/register/entries/${id}/reveal` },
    { method: 'patch' as const, path: `/atm/register/entries/${id}`, body: { name: 'x', version } },
    {
      method: 'post' as const,
      path: `/atm/register/entries/${id}/handover`,
      body: { endDate: '2026-09-30', version },
    },
    { method: 'delete' as const, path: `/atm/register/entries/${id}`, body: { version } },
    { method: 'post' as const, path: `/atm/register/entries/${id}/link`, body: { version } },
  ];

  it('25 — outside their branch, department/section/own holders get 404 on every call — no IDOR', async () => {
    const entry = await getEntry(alexSecretId);
    const masterBefore = await AtmMachineModel.findById(alexMasterId).lean().exec();
    for (const token of [deptToken, sectionToken, ownToken]) {
      for (const op of writes(alexSecretId, entry.version)) {
        const res = await call(op.method, op.path, token, op.body);
        expect(res.status, `${op.method} ${op.path}`).toBe(404);
        expect(res.text).not.toContain(COMBO);
      }
    }
    expect(await AtmMachineModel.findById(alexMasterId).lean().exec()).toEqual(masterBefore);
    expect((await getEntry(alexSecretId)).version).toBe(entry.version);
    expect(await auditRows(alexSecretId, 'secretRevealed')).toHaveLength(0);
  });

  it('26 — inside their branch they READ (no secrets) and write nothing; lists narrow to the branch', async () => {
    const cases: [string, string][] = [
      [deptToken, tantaId],
      [sectionToken, tantaId],
      [ownToken, ownEntryId],
    ];
    for (const [token, id] of cases) {
      const entry = await getEntry(id, token);
      expect(entry).toMatchObject({ secretsVisible: false, keys: null, receiptNotes: null });
      for (const op of writes(id, entry.version).slice(1)) {
        const res = await call(op.method, op.path, token, op.body);
        expect(res.status, `${op.method} ${op.path}`).toBe(403);
      }
    }
    for (const token of [deptToken, sectionToken]) {
      const listed = data<AtmRegisterEntryDto[]>(
        await call('get', '/atm/register/entries?pageSize=100', token),
      );
      expect(listed.length).toBeGreaterThan(0);
      expect(new Set(listed.map((e) => e.branchId))).toEqual(new Set([tantaBranchId]));
    }
    const own = data<AtmRegisterEntryDto[]>(
      await call('get', '/atm/register/entries?pageSize=100', ownToken),
    );
    expect(own.map((e) => e.id)).toEqual([ownEntryId]);
    expect(await auditRows(tantaId, 'secretRevealed')).toHaveLength(0);
  });

  it('27 — the report shows the reached branches only; own shows every mapped branch; totals agree', async () => {
    const reach = await report(deptReachToken);
    expect(reach.branchesShown).toEqual(['EGYCASH-4']);
    expect(reach.counts.section1.total).toBe(
      reach.counts.section2.total + reach.counts.activeWithUnmappedBranch,
    );
    const own = await report(ownToken);
    expect(own.branchesShown).toEqual(['EGYCASH-2', 'EGYCASH-4']);
    expect(own.counts.section2['EGYCASH-2']).toBe(1); // the one entry they created
    expect(own.counts.section2['EGYCASH-4']).toBe(0);
    expect(own.counts.section1.total).toBe(
      own.counts.section2.total + own.counts.activeWithUnmappedBranch,
    );
  });

  it('28 — a 409 names another branch only to a caller who can see it', async () => {
    // Open elsewhere: 99990025 is open in Alexandria.
    const tantaAsk = await call(
      'post',
      '/atm/register/entries',
      tantaToken,
      receipt({ machineCode: '99990025', branchId: tantaBranchId }),
    );
    expect(errorCode(tantaAsk)).toBe('ATM_REGISTER_OPEN_PERIOD_EXISTS');
    expect(errorMessage(tantaAsk)).not.toContain('EGYCASH-4');
    const orgAsk = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990025', branchId: tantaBranchId }),
    );
    expect(errorMessage(orgAsk)).toContain('EGYCASH-4');

    // Active elsewhere: an Operations machine in Alexandria with no open entry.
    await addMachine(alexBranchId, {
      machineCode: '99990028',
      name: 'Alex ATM',
      bankName: 'NBE',
      area: 'Smouha',
    });
    const tantaActive = await call(
      'post',
      '/atm/register/entries',
      tantaToken,
      receipt({ machineCode: '99990028', branchId: tantaBranchId }),
    );
    expect(errorCode(tantaActive)).toBe('ATM_REGISTER_CODE_ACTIVE_ELSEWHERE');
    expect(errorMessage(tantaActive)).not.toContain('EGYCASH-4');
    const orgActive = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990028', branchId: tantaBranchId }),
    );
    expect(errorCode(orgActive)).toBe('ATM_REGISTER_CODE_ACTIVE_ELSEWHERE');
    expect(errorMessage(orgActive)).toContain('EGYCASH-4');
  });

  it('29 — every /entries response is private, no-store', async () => {
    const entry = await getEntry(alexSecretId);
    const responses = [
      await call('get', '/atm/register/entries', effOrgToken),
      await call('get', `/atm/register/entries/${alexSecretId}`, effOrgToken),
      await call('patch', `/atm/register/entries/${alexSecretId}`, effOrgToken, {
        hub: 'HUB-1',
        version: entry.version,
      }),
      await call('post', `/atm/register/entries/${alexSecretId}/reveal`, effOrgToken),
      await call('get', '/atm/register/entries/export', effOrgToken),
    ];
    for (const res of responses) {
      expect(res.status).toBeLessThan(300);
      expect(res.headers['cache-control']).toBe('private, no-store');
    }
  });
});

describe('deferred coupling and imported values (DEC-30, F-18)', () => {
  it('30 — an unlinked open entry couples when its area is set, or through Link', async () => {
    const first = await insertEntry({ machineCode: '99990030', importRow: 900030 });
    expect((await getEntry(String(first._id))).masterState).toBe('unlinked');
    const set = await call('patch', `/atm/register/entries/${String(first._id)}`, effOrgToken, {
      area: 'Smouha',
      version: first.__v,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const coupled = data<AtmRegisterWriteResultDto>(set);
    expect(coupled.master.action).toBe('create');
    expect(coupled.entry.machineId).not.toBeNull();
    expect(coupled.entry.masterState).toBe('active');
    expect((await masterOf(alexBranchId, '99990030'))?.isActive).toBe(true);

    const tantaMaster = await addMachine(tantaBranchId, {
      machineCode: '99990031',
      name: 'Tanta ATM',
      bankName: 'NBE',
      area: 'Tanta Center',
    });
    const second = await insertEntry({ machineCode: '99990031', importRow: 900031 });
    const blocked = await call(
      'patch',
      `/atm/register/entries/${String(second._id)}`,
      effOrgToken,
      {
        area: 'Smouha',
        version: second.__v,
      },
    );
    expect(blocked.status).toBe(200);
    const kept = data<AtmRegisterWriteResultDto>(blocked);
    expect(kept.warnings).toContain('codeActiveElsewhere');
    expect(kept.entry.machineId).toBeNull();
    expect(kept.entry.area).toBe('Smouha');

    const master = await AtmMachineModel.findById(tantaMaster).lean<AtmMachineDoc>().exec();
    const archived = await call('patch', `/atm/machines/${tantaMaster}`, adminToken, {
      isActive: false,
      version: master?.__v ?? 0,
    });
    expect(archived.status).toBe(200);

    const linked = await call(
      'post',
      `/atm/register/entries/${String(second._id)}/link`,
      effOrgToken,
      {
        version: kept.entry.version,
      },
    );
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    const linkedBody = data<AtmRegisterWriteResultDto>(linked);
    expect(linkedBody.master.action).toBe('create');
    const again = await call(
      'post',
      `/atm/register/entries/${String(second._id)}/link`,
      effOrgToken,
      {
        version: linkedBody.entry.version,
      },
    );
    expect(again.status).toBe(422);
    expect(errorCode(again)).toBe('ATM_REGISTER_ALREADY_LINKED');
  });

  it('31 — a handover keeps an imported delivered name and note unless it sends them', async () => {
    const kept = await insertEntry({
      machineCode: '99990032',
      area: 'Smouha',
      handoverName: 'Imported Name',
      handoverNotes: 'imported-note-fake',
      importRow: 900032,
    });
    const res = await call(
      'post',
      `/atm/register/entries/${String(kept._id)}/handover`,
      effOrgToken,
      {
        endDate: '2026-09-30',
        version: kept.__v,
      },
    );
    expect(res.status).toBe(200);
    expect(data<AtmRegisterWriteResultDto>(res).entry).toMatchObject({
      status: 'ended',
      handoverName: 'Imported Name',
      handoverNotes: 'imported-note-fake',
    });

    const cleared = await insertEntry({
      machineCode: '99990033',
      area: 'Smouha',
      handoverName: 'Imported Name',
      importRow: 900033,
    });
    const res2 = await call(
      'post',
      `/atm/register/entries/${String(cleared._id)}/handover`,
      effOrgToken,
      {
        endDate: '2026-09-30',
        handoverName: '',
        version: cleared.__v,
      },
    );
    expect(data<AtmRegisterWriteResultDto>(res2).entry.handoverName).toBeNull();
  });
});

describe('key rotation (DEC-33)', () => {
  it('32 — the nightly task rewraps every combination onto the new key, deleted entries too', async () => {
    const live = await receive(effOrgToken, { machineCode: '99990034', safeCombination: COMBO });
    const gone = await receive(effOrgToken, { machineCode: '99990035', safeCombination: COMBO_2 });
    const del = await call('delete', `/atm/register/entries/${gone.entry.id}`, effOrgToken, {
      version: gone.entry.version,
    });
    expect(del.status).toBe(204);

    const settings = env as unknown as {
      PLATFORM_ENCRYPTION_KEYS: string;
      PLATFORM_ENCRYPTION_ACTIVE_KEY: string;
    };
    const keys = settings.PLATFORM_ENCRYPTION_KEYS;
    const active = settings.PLATFORM_ENCRYPTION_ACTIVE_KEY;
    try {
      settings.PLATFORM_ENCRYPTION_KEYS = `${keys},b:${KEY_B}`;
      settings.PLATFORM_ENCRYPTION_ACTIVE_KEY = 'b';
      cryptoService.resetKeyRing();

      const task = (atmModule.scheduledTasks ?? []).find(
        (t) => t.key === 'atm.rotateRegisterCombinationKeys',
      );
      if (task === undefined) throw new Error('rotation task not declared');
      await task.handler();

      for (const id of [live.entry.id, gone.entry.id]) {
        const raw = await AtmRegisterEntryModel.collection.findOne({ _id: new Types.ObjectId(id) });
        expect((raw?.safeCombination as { keyId?: string } | null)?.keyId).toBe('b');
      }
      const reveal = await call(
        'post',
        `/atm/register/entries/${live.entry.id}/reveal`,
        effOrgToken,
      );
      expect(data<AtmRegisterRevealDto>(reveal).safeCombination).toBe(COMBO);
      expect(await rotateRegisterCombinationKeys()).toEqual({ rotated: 0, failed: 0 });
    } finally {
      settings.PLATFORM_ENCRYPTION_KEYS = keys;
      settings.PLATFORM_ENCRYPTION_ACTIVE_KEY = active;
      cryptoService.resetKeyRing();
    }
  });
});

describe('the bank catalog in the register (DEC-35, DEC-40)', () => {
  const addBank = async (body: Record<string, unknown>): Promise<AtmBankDto> => {
    const res = await call('post', '/atm/banks', adminToken, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<AtmBankDto>(res);
  };
  const patchBank = async (code: string, body: Record<string, unknown>): Promise<void> => {
    const listed = data<AtmBankDto[]>(await call('get', '/atm/banks', adminToken));
    const bank = listed.find((row) => row.code === code);
    if (bank === undefined) throw new Error(`no bank ${code}`);
    const res = await call('patch', `/atm/banks/${code}`, adminToken, {
      ...body,
      version: bank.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const fieldError = (res: request.Response): { field: string; code: string } | undefined =>
    (res.body as { error?: { details?: { field: string; code: string }[] } }).error?.details?.[0];

  it('33 — the meta lists the CATALOG: every bank, in order, with its state; a bank added at runtime is there', async () => {
    await addBank({
      code: 'QNB',
      name: { ar: 'بنك قطر الوطني', en: 'QNB Al Ahli' },
      opsLabel: 'QNB ALAHLI',
    });
    const res = await call('get', '/atm/register/meta', effOrgToken);
    expect(res.status).toBe(200);
    const banks = data<AtmRegisterMetaDto>(res).banks;
    expect(banks.map((b) => b.code)).toEqual(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT', 'QNB']);
    expect(banks.find((b) => b.code === 'BM')).toEqual({
      code: 'BM',
      name: { ar: 'بنك مصر', en: 'Banque Misr' },
      opsLabel: 'MISR',
      color: '#AC2100',
      isActive: true,
      sortOrder: 20,
      isSeed: true,
    });
    expect(banks.find((b) => b.code === 'QNB')).toMatchObject({
      opsLabel: 'QNB ALAHLI',
      isActive: true,
      sortOrder: 70,
      isSeed: false,
    });
  });

  it('34 — a receipt with the new bank creates the master with ITS label, and the report counts it after BRK', async () => {
    const before = await report(effOrgToken);
    const result = await receive(effOrgToken, { machineCode: '99990340', bankCode: 'QNB' });
    expect(result.master.action).toBe('create');
    expect(result.entry.effectiveOpsBankLabel).toBe('QNB ALAHLI');
    expect(result.entry.opsBankLabel).toBeNull();
    // A bank with no ID format never warns about the code's shape (D6 stays the six's).
    expect(result.warnings).not.toContain('idFormat');
    expect((await masterOf(alexBranchId, '99990340'))?.bankName).toBe('QNB ALAHLI');

    const after = await report(effOrgToken);
    expect(after.section1Banks).toEqual(['NXT', 'NBE', 'BM', 'CIB', 'HDB', 'BRK', 'QNB']);
    expect(after.section3Banks).toEqual(['NBE', 'BM', 'CIB', 'HDB', 'BRK', 'NXT', 'QNB']);
    expect(after.banks.find((b) => b.code === 'QNB')).toEqual({
      code: 'QNB',
      name: { ar: 'بنك قطر الوطني', en: 'QNB Al Ahli' },
      color: '#7030A0',
      isActive: true,
      isSeed: false,
    });
    expect((after.counts.section1.QNB ?? 0) - (before.counts.section1.QNB ?? 0)).toBe(1);
    expect(after.counts.section1.total - before.counts.section1.total).toBe(1);
    expect(after.counts.section2.total - before.counts.section2.total).toBe(1);
    expect(after.counts.section3['EGYCASH-4']?.QNB).toBe(1);
  });

  it('35 — an unknown or ARCHIVED bank is 400 for a new value; an entry keeps an archived bank it already has', async () => {
    const unknown = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990350', bankCode: 'ZZZ' }),
    );
    expect(unknown.status).toBe(400);
    expect(fieldError(unknown)).toMatchObject({ field: 'body.bankCode', code: 'UNKNOWN' });

    const pending = await receive(effOrgToken, {
      machineCode: '99990351',
      bankCode: 'QNB',
      startDate: undefined,
    });
    const open = data<AtmRegisterEntryDto[]>(
      await call('get', '/atm/register/entries?search=99990340&statuses=open', effOrgToken),
    )[0];
    if (open === undefined) throw new Error('no open QNB entry');
    await patchBank('QNB', { isActive: false });
    try {
      const archived = await call(
        'post',
        '/atm/register/entries',
        effOrgToken,
        receipt({ machineCode: '99990352', bankCode: 'QNB' }),
      );
      expect(archived.status).toBe(400);
      expect(fieldError(archived)).toMatchObject({ field: 'body.bankCode', code: 'INACTIVE' });

      // The entry's own bank is not re-judged: an edit that leaves it alone is saved…
      const kept = await call('patch', `/atm/register/entries/${open.id}`, effOrgToken, {
        name: 'QNB ATM renamed',
        bankCode: 'QNB',
        version: open.version,
      });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      // …and a pending entry recorded with it is received with it.
      const received = await call(
        'post',
        `/atm/register/entries/${pending.entry.id}/receive`,
        effOrgToken,
        { startDate: '2026-09-02', area: 'Smouha', version: pending.entry.version },
      );
      expect(received.status, JSON.stringify(received.body)).toBe(200);

      // Moving another entry TO the archived bank is a new value: refused.
      const nbe = await receive(effOrgToken, { machineCode: '99990353' });
      const moved = await call('patch', `/atm/register/entries/${nbe.entry.id}`, effOrgToken, {
        bankCode: 'QNB',
        version: nbe.entry.version,
      });
      expect(moved.status).toBe(400);
      expect(fieldError(moved)).toMatchObject({ field: 'body.bankCode', code: 'INACTIVE' });

      // Archived but still in operation: the report keeps counting and showing it.
      const counted = await report(effOrgToken);
      expect(counted.section1Banks).toContain('QNB');
      expect(counted.banks.find((b) => b.code === 'QNB')?.isActive).toBe(false);
    } finally {
      await patchBank('QNB', { isActive: true });
    }
  });

  it('36 — an override must be a spelling OF THE ENTRY’S BANK: another bank’s or an unmapped one is 400', async () => {
    const alex = new Types.ObjectId(alexBranchId);
    await AtmRefLabelModel.create([
      { branchId: alex, kind: 'bank', name: 'NBE FOREX', bankCode: 'NBE' },
      { branchId: alex, kind: 'bank', name: 'MISR ALT', bankCode: 'BM' },
      { branchId: alex, kind: 'bank', name: 'RAW TEXT', bankCode: null },
    ]);
    const options = data<AtmRegisterBranchOptionsDto>(
      await call('get', `/atm/register/branch-options?branchId=${alexBranchId}`, effOrgToken),
    );
    expect(options.bankVariants).toEqual([
      { name: 'MISR ALT', bankCode: 'BM' },
      { name: 'NBE FOREX', bankCode: 'NBE' },
    ]);

    const other = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990360', opsBankLabel: 'MISR ALT' }),
    );
    expect(other.status).toBe(400);
    expect(fieldError(other)).toMatchObject({ field: 'body.opsBankLabel', code: 'OTHER_BANK' });
    const unmapped = await call(
      'post',
      '/atm/register/entries',
      effOrgToken,
      receipt({ machineCode: '99990360', opsBankLabel: 'RAW TEXT' }),
    );
    expect(unmapped.status).toBe(400);
    expect(fieldError(unmapped)).toMatchObject({ field: 'body.opsBankLabel', code: 'UNMAPPED' });

    const forex = await receive(effOrgToken, {
      machineCode: '99990360',
      opsBankLabel: 'NBE FOREX',
    });
    expect((await masterOf(alexBranchId, '99990360'))?.bankName).toBe('NBE FOREX');

    const wrong = await call('patch', `/atm/register/entries/${forex.entry.id}`, effOrgToken, {
      opsBankLabel: 'MISR ALT',
      version: forex.entry.version,
    });
    expect(wrong.status).toBe(400);
    expect(fieldError(wrong)).toMatchObject({ field: 'body.opsBankLabel', code: 'OTHER_BANK' });
    const both = await call('patch', `/atm/register/entries/${forex.entry.id}`, effOrgToken, {
      bankCode: 'BM',
      opsBankLabel: 'MISR ALT',
      version: forex.entry.version,
    });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect((await masterOf(alexBranchId, '99990360'))?.bankName).toBe('MISR ALT');
  });
});

describe('«بيانات ناقصة» (DEC-37)', () => {
  it('37 — Efficiency sets and clears the flag; the list filters on it, the export carries it, the audit shows it', async () => {
    const flagged = await receive(effOrgToken, { machineCode: '99990370' });
    const plain = await receive(effOrgToken, { machineCode: '99990371' });
    expect(flagged.entry.dataIncomplete).toBe(false);
    expect(flagged.entry.source).toBe('manual');

    // A holder whose edit key does not reach the branch cannot touch it.
    const outside = await call('patch', `/atm/register/entries/${flagged.entry.id}`, tantaToken, {
      dataIncomplete: true,
      version: flagged.entry.version,
    });
    expect(outside.status).toBe(404);

    const set = await call('patch', `/atm/register/entries/${flagged.entry.id}`, effOrgToken, {
      dataIncomplete: true,
      version: flagged.entry.version,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const setEntry = data<AtmRegisterWriteResultDto>(set).entry;
    expect(setEntry.dataIncomplete).toBe(true);

    const only = data<AtmRegisterEntryDto[]>(
      await call('get', '/atm/register/entries?incomplete=true&pageSize=100', effOrgToken),
    );
    expect(only.map((e) => e.machineCode)).toEqual(['99990370']);
    const rest = data<AtmRegisterEntryDto[]>(
      await call(
        'get',
        '/atm/register/entries?incomplete=false&search=9999037&pageSize=100',
        effOrgToken,
      ),
    );
    expect(rest.map((e) => e.machineCode)).toEqual(['99990371']);
    expect(rest.every((e) => !e.dataIncomplete)).toBe(true);

    const csv = await call('get', '/atm/register/entries/export?incomplete=true', effOrgToken);
    expect(csv.status).toBe(200);
    const lines = csv.text.slice(1).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('99990370');
    expect(lines[1]?.endsWith(',yes')).toBe(true);
    const all = await call('get', '/atm/register/entries/export?search=99990371', effOrgToken);
    expect(all.text.trim().split('\n').at(-1)?.endsWith(',no')).toBe(true);

    const cleared = await call('patch', `/atm/register/entries/${flagged.entry.id}`, effOrgToken, {
      dataIncomplete: false,
      version: setEntry.version,
    });
    expect(cleared.status).toBe(200);
    expect(data<AtmRegisterWriteResultDto>(cleared).entry.dataIncomplete).toBe(false);
    const diffs = (await auditRows(flagged.entry.id, 'update')).flatMap(
      (row) => (row as { changes: { field: string; old: unknown; new: unknown }[] }).changes,
    );
    expect(diffs.filter((c) => c.field === 'dataIncomplete')).toEqual([
      { field: 'dataIncomplete', old: false, new: true },
      { field: 'dataIncomplete', old: true, new: false },
    ]);
    expect(plain.entry.dataIncomplete).toBe(false);
  });
});
