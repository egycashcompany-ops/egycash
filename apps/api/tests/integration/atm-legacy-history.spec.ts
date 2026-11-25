// /atm/legacy-import — the old system's replenishments and maintenances copied into their branch,
// over real HTTP, real RBAC and real legacy databases beside ECMS's own in the test server
// (docs/12-planning/atm-legacy-history-import.md).
//
// The owner (2026-11-25): «تقدر تشوفهم أنت من Mongo مباشرة جوا maintenance و replenishment — وللأفرع
// كلها مش بس المهندسين وأكتوبر .. ماعدا أسيوط». Pinned here: which rows are copied and why the others
// are not; the time mode read from when each row was written; the machine a legacy code files under;
// the cutover instant; a run's steps and their lease; insert-only re-runs that never change a row;
// one run at a time, and a branch move refused while one runs; the source's undo, in batches; the
// refusals; and that the legacy database is only read.
//
// Every id, code and name below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type AtmBranchMovePreviewDto,
  type AtmLegacyCutoverDto,
  type AtmLegacyImportPreviewDto,
  type AtmLegacyImportRunDto,
  type AtmLegacySourceDto,
  type AtmLegacyUndoResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import {
  setLegacyStepRowsForTests,
  setLegacyUndoRowsForTests,
} from '../../src/modules/atm/migration/legacy-history.service';
import { AtmLegacyImportRunModel } from '../../src/modules/atm/migration/legacy-history-run.model';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { AtmReplenishmentModel } from '../../src/modules/atm/replenishments/replenishment.model';
import { AtmMaintenanceModel } from '../../src/modules/atm/maintenances/maintenance.model';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let holderToken: string; // atmSettings.manage at BRANCH scope — refused
let alexBranchId: string;
let octoberBranchId: string; // linked to work as Alexandria

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-legacy-test-${Date.now()}`;
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
const errorCode = (res: request.Response): string =>
  (res.body as { error: { code: string } }).error.code;

const call = (
  method: 'get' | 'put' | 'post',
  path: string,
  token: string,
  body?: Record<string, unknown>,
) => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};

// ── The legacy deployment `alex` ──────────────────────────────────────────────────────────────────
// A row's `_id` carries the moment it was written — the moment it was opened. Replenishments were
// written as Cairo wall clock stamped UTC (the T1 bug): their open time sits two hours (November)
// after that moment. Maintenances were written honestly: their open time IS that moment.
const writtenAt = (iso: string): Types.ObjectId =>
  new Types.ObjectId(Math.floor(Date.parse(iso) / 1000));
const at = (iso: string): Date => new Date(iso);
const plus2h = (iso: string): Date => new Date(Date.parse(iso) + 2 * 3_600_000);

/** Alexandria's first own ECMS row — the evening the 24th's plan was entered (2026-11-23). */
const SWITCH = '2026-11-23T19:57:01.000Z';

const rep = (real: string, over: Record<string, unknown>) => ({
  _id: writtenAt(real),
  bank: 'NBE',
  name: 'SYN SITE',
  area: 'SYN AREA',
  schedule_time: 'صباحي',
  leader: 'سامح فؤاد',
  ops_emp: 'Ahmed',
  ops_emp2: 'Mona',
  service_type: '',
  end: 1,
  status: 0,
  deleted: 0,
  __v: 0,
  mach_id: '9001',
  open_time: plus2h(real),
  ...over,
});
const REP = {
  // 08:00Z really; stamped 10:00Z. Closed 30 minutes later.
  r1: rep('2026-11-10T08:00:00Z', { close_time: at('2026-11-10T08:30:00Z') }),
  // A zero-padded code files under the register's 9002.
  r2: rep('2026-11-12T19:00:00Z', { mach_id: '009002', close_time: at('2026-11-12T19:40:00Z') }),
  r3: rep('2026-11-13T08:00:00Z', { deleted: 1, close_time: at('2026-11-13T08:30:00Z') }),
  // Not «Done»: marked ended with no close time (reopened, then cut off). Only a row both signals
  // call closed is copied (the owner, 2026-11-25).
  r4: rep('2026-11-15T07:00:00Z', { end: 1 }),
  // Closed after the branch began working in ECMS: the branch's own.
  r5: rep('2026-11-24T05:00:00Z', { close_time: at('2026-11-24T05:30:00Z') }),
  r6: rep('2026-11-05T08:00:00Z', { mach_id: '7777', close_time: at('2026-11-05T08:10:00Z') }),
  r7: rep('2026-11-06T08:00:00Z', { open_time: null, close_time: at('2026-11-06T08:10:00Z') }),
  // The legacy delete renamed the machine `<code>-D`; its history files under the code.
  r8: rep('2026-11-01T10:00:00Z', { mach_id: '9001-D', close_time: at('2026-11-01T10:20:00Z') }),
  // Closed one minute before the switch: history.
  r9: rep('2026-11-23T08:00:00Z', { close_time: at('2026-11-23T19:56:00Z') }),
  // A machine deleted in ECMS since (stored `9003-D`) still owns its history.
  r10: rep('2026-11-09T08:00:00Z', { mach_id: '9003', close_time: at('2026-11-09T08:45:00Z') }),
};
const maint = (real: string, over: Record<string, unknown>) => ({
  _id: writtenAt(real),
  bank: 'HDB',
  name: 'SYN SITE',
  area: 'SYN AREA',
  leader: 'محمد اشرف',
  ops_emp: 'Abdulwahab',
  ops_emp2: 'Abdulwahab',
  service_type: 'حشر نقدية',
  notes: '',
  end: 1,
  status: 0,
  deleted: 0,
  __v: 0,
  mach_id: '9001',
  open_time: at(real),
  ...over,
});
const MAINT = {
  m1: maint('2026-11-10T10:00:00Z', { notes: 'SYN NOTE', close_time: at('2026-11-10T11:00:00Z') }),
  m2: maint('2026-11-11T08:00:00Z', {
    mach_id: 'HDB-ATM 9501',
    close_time: at('2026-11-11T08:40:00Z'),
  }),
  // Not «Done» either: a close time on a row still marked open.
  m3: maint('2026-11-20T08:00:00Z', {
    mach_id: '9002',
    end: 0,
    close_time: at('2026-11-20T09:00:00Z'),
  }),
  m4: maint('2026-11-21T08:00:00Z', { deleted: 1, close_time: at('2026-11-21T09:00:00Z') }),
};

const legacyDb = (name: string) => mongoose.connection.useDb(name, { useCache: true });

const BODY = { source: 'alex', cutoverAt: SWITCH };

const preview = async (body: Record<string, unknown>): Promise<AtmLegacyImportPreviewDto> => {
  const res = await call('post', '/atm/legacy-import/preview', adminToken, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmLegacyImportPreviewDto>(res);
};

const stepToEnd = async (run: AtmLegacyImportRunDto): Promise<AtmLegacyImportRunDto> => {
  let current = run;
  for (let guard = 0; current.state === 'running' && guard < 50; guard += 1) {
    const stepped = await call('post', `/atm/legacy-import/runs/${current.id}/step`, adminToken);
    expect(stepped.status, JSON.stringify(stepped.body)).toBe(200);
    current = data<AtmLegacyImportRunDto>(stepped);
  }
  return current;
};

/** Starts a run and steps it to its end, as the card's loop does. */
const runToEnd = async (body: Record<string, unknown>): Promise<AtmLegacyImportRunDto> => {
  const started = await call('post', '/atm/legacy-import/runs', adminToken, body);
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  return stepToEnd(data<AtmLegacyImportRunDto>(started));
};

const cutover = async (source: string): Promise<string | null> => {
  const res = await call('get', `/atm/legacy-import/sources/${source}/cutover`, adminToken);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return data<AtmLegacyCutoverDto>(res).suggestedCutoverAt;
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-legacy-admin@ecms.local');
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
  adminToken = await login('atm-legacy-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await call('post', '/platform/branches', adminToken, { code, name: { ar, en } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return data<{ id: string }>(res).id;
  };
  // Each carries the code its deployment maps to (contracts ATM_LEGACY_SOURCES).
  alexBranchId = await mkBranch('050', 'الاسكندرية', 'Alexandria');
  await mkBranch('020', 'طنطا', 'Tanta');
  octoberBranchId = await mkBranch('040', 'اكتوبر', 'October');
  const linked = await call('put', '/atm/branch-links', adminToken, {
    links: [{ branchId: octoberBranchId, actsAsBranchId: alexBranchId }],
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(200);

  const machines = await request(app)
    .post('/api/v1/atm/machines/bulk')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('x-active-branch', alexBranchId)
    .send({
      bankName: 'SYN BANK',
      area: 'SYN AREA',
      machines: [
        { machineCode: '9001', name: 'SYN 9001' },
        { machineCode: '9002', name: 'SYN 9002' },
        { machineCode: '9003', name: 'SYN 9003' },
        { machineCode: 'HDB-ATM 9501', name: 'SYN 9501' },
      ],
    });
  expect(machines.status, JSON.stringify(machines.body)).toBe(200);
  // 9003 deleted in ECMS since: the delete renames it `9003-D`.
  await AtmMachineModel.updateOne(
    { branchId: new Types.ObjectId(alexBranchId), machineCode: '9003' },
    { $set: { machineCode: '9003-D', isDeleted: true, deletedAt: new Date() } },
  ).exec();

  for (const name of ['alex', 'tanta', 'portsaid']) await legacyDb(name).dropDatabase();
  await legacyDb('alex').collection('replenishment').insertMany(Object.values(REP));
  await legacyDb('alex').collection('maintenance').insertMany(Object.values(MAINT));
  // `tanta`: rows whose `_id` says nothing about their open time — written long before.
  await legacyDb('tanta')
    .collection('maintenance')
    .insertOne(
      maint('2026-11-10T10:00:00Z', {
        _id: new Types.ObjectId('64b7f9c2e13b4a0012349999'),
        close_time: at('2026-11-10T11:00:00Z'),
      }),
    );

  const settingsRole = await rbacService.createRole(
    { name: { en: 'ATM settings', ar: 'إعدادات' }, permissionKeys: ['atmSettings.manage'] },
    adminId,
  );
  const holder = await mkUser('atm-legacy-holder@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(holder, String(settingsRole._id), 'branch');
  holderToken = await login('atm-legacy-holder@ecms.local');

  // Three legacy rows per step and two copies per undo call, so a kind takes several steps, a run
  // crosses from one kind to the next part-way, and an undo takes several calls.
  setLegacyStepRowsForTests(3);
  setLegacyUndoRowsForTests(2);
}, 240_000);

afterAll(async () => {
  setLegacyStepRowsForTests(null);
  setLegacyUndoRowsForTests(null);
  for (const name of ['alex', 'tanta', 'portsaid']) await legacyDb(name).dropDatabase();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the preview — what a run would copy, by the run’s own rules', () => {
  it('counts each row under the first rule it fails, and reads each kind’s time mode from when its rows were written', async () => {
    const dto = await preview(BODY);
    expect(dto.sourceFound).toBe(true);
    expect(dto.branchId).toBe(alexBranchId);
    expect(dto.replenishment).toMatchObject({
      total: 10,
      toImport: 5, // r1, r2, r8, r9, r10
      skipped: { deleted: 1, noOpenTime: 1, open: 1, afterCutover: 1, unresolved: 1 },
      unresolvedCodes: [{ code: '7777', rows: 1 }],
      timeMode: 'cairoLabelled',
      evidence: { rows: 9, asWritten: 0, cairoShifted: 9 },
      timeModeClear: true,
    });
    expect(dto.maintenance).toMatchObject({
      total: 4,
      toImport: 2, // m1, m2
      skipped: { deleted: 1, noOpenTime: 0, open: 1, afterCutover: 0, unresolved: 0 },
      timeMode: 'utc',
      evidence: { rows: 4, asWritten: 4, cairoShifted: 0 },
      timeModeClear: true,
    });
    // The first and last open times as they will be stored — repaired.
    expect(dto.replenishment.firstOpenedAt).toBe('2026-11-01T10:00:00.000Z');
    expect(dto.replenishment.lastOpenedAt).toBe('2026-11-23T08:00:00.000Z');
  });

  it('no cutover: the branch’s own rows are copied too; a row not «Done» never is', async () => {
    const dto = await preview({ ...BODY, cutoverAt: null });
    expect(dto.replenishment.toImport).toBe(6); // + r5 (closed after the switch); never r4
    expect(dto.replenishment.skipped.open).toBe(1);
    expect(dto.maintenance.toImport).toBe(2); // never m3
    expect(dto.maintenance.skipped.open).toBe(1);
  });

  it('a body that still asks for open rows is refused — there is no such switch', async () => {
    const res = await call('post', '/atm/legacy-import/preview', adminToken, {
      ...BODY,
      includeOpen: true,
    });
    expect(res.status).toBe(400);
  });

  it('a source with no rows previews as not found, never as an error', async () => {
    // Port Said has no branch here: refused before anything is read.
    const portsaid = await call('post', '/atm/legacy-import/preview', adminToken, {
      ...BODY,
      source: 'portsaid',
    });
    expect(portsaid.status).toBe(422);
    const tanta = await preview({ ...BODY, source: 'tanta' });
    expect(tanta.sourceFound).toBe(true);
    expect(tanta.replenishment.total).toBe(0);
  });

  it('says when a kind’s rows do not decide the time mode', async () => {
    const tanta = await preview({ ...BODY, source: 'tanta' });
    expect(tanta.maintenance).toMatchObject({
      evidence: { rows: 1, asWritten: 0, cairoShifted: 0 },
      timeModeClear: false,
    });
    // Nothing to read is nothing to decide.
    expect(tanta.replenishment.timeModeClear).toBe(true);
  });
});

describe('the sources card', () => {
  it('lists the five deployments, each with the branch its code names, and none copied yet', async () => {
    const res = await call('get', '/atm/legacy-import', adminToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sources = data<AtmLegacySourceDto[]>(res);
    expect(sources.map((s) => s.source)).toEqual(['alex', 'portsaid', 'tanta', 'wsal', 'egycash']);
    expect(sources.find((s) => s.source === 'alex')).toMatchObject({
      branchId: alexBranchId,
      lastRun: null,
      copiedRows: 0,
    });
    // No branch carries Port Said's code here.
    expect(sources.find((s) => s.source === 'portsaid')?.branchId).toBeNull();
    // No day of Alexandria's own yet: nothing to cut.
    expect(await cutover('alex')).toBeNull();
  });
});

describe('a run', () => {
  let firstRun: AtmLegacyImportRunDto;

  it('copies the rows step by step, both kinds, and ends done — audited when it starts and when it ends', async () => {
    firstRun = await runToEnd(BODY);
    expect(firstRun.state).toBe('done');
    expect(firstRun.nextKind).toBeNull();
    expect(firstRun.replenishment).toMatchObject({
      read: 10,
      written: 5,
      existing: 0,
      skipped: { deleted: 1, noOpenTime: 1, open: 1, afterCutover: 1, unresolved: 1 },
      timeMode: 'cairoLabelled',
    });
    expect(firstRun.maintenance).toMatchObject({
      read: 4,
      written: 2,
      existing: 0,
      timeMode: 'utc',
    });
    expect(firstRun.totals).toEqual({ replenishment: 10, maintenance: 4 });
    const audits = await AuditLogModel.find({
      action: 'atmLegacyImport',
      'entityRef.entityId': firstRun.id,
    })
      .lean()
      .exec();
    expect(audits).toHaveLength(2);
  });

  it('writes each row as the old system had it — open times repaired, filed under the register’s machine', async () => {
    const r1 = await AtmReplenishmentModel.findById(REP.r1._id).lean().exec();
    expect(r1).toMatchObject({
      branchId: new Types.ObjectId(alexBranchId),
      machineCode: '9001',
      leaderName: 'سامح فؤاد',
      openedByName: 'Ahmed',
      closedByName: 'Mona',
      scheduleTime: 'صباحي',
      isDeleted: false,
      legacyImportRunId: new Types.ObjectId(firstRun.id),
    });
    // The moment it was really opened; the close time was always true.
    expect(r1?.openedAt.toISOString()).toBe('2026-11-10T08:00:00.000Z');
    expect(r1?.closedAt?.toISOString()).toBe('2026-11-10T08:30:00.000Z');
    expect(r1?.openDay).toBe('2026-11-10');
    expect((await AtmReplenishmentModel.findById(REP.r2._id).lean().exec())?.machineCode).toBe(
      '9002',
    );
    expect((await AtmReplenishmentModel.findById(REP.r8._id).lean().exec())?.machineCode).toBe(
      '9001',
    );
    // The deleted machine's history is filed under it, by its code.
    const r10 = await AtmReplenishmentModel.findById(REP.r10._id).lean().exec();
    const gone = await AtmMachineModel.findOne({ machineCode: '9003-D' }).lean().exec();
    expect(r10?.machineId).toEqual(gone?._id);
    expect(r10?.machineCode).toBe('9003');
    for (const skipped of [REP.r3, REP.r4, REP.r5, REP.r6, REP.r7]) {
      expect(await AtmReplenishmentModel.exists({ _id: skipped._id })).toBeNull();
    }
    const m1 = await AtmMaintenanceModel.findById(MAINT.m1._id).lean().exec();
    expect(m1).toMatchObject({
      serviceType: 'حشر نقدية',
      notes: 'SYN NOTE',
      leaderName: 'محمد اشرف',
      source: 'manual',
      mailTicketId: null,
      leaderEmployeeId: null,
    });
    // Maintenance times were honest: kept as written.
    expect(m1?.openedAt.toISOString()).toBe('2026-11-10T10:00:00.000Z');
    expect((await AtmMaintenanceModel.findById(MAINT.m2._id).lean().exec())?.machineCode).toBe(
      'HDB-ATM 9501',
    );
  });

  it('never wrote to the legacy database', async () => {
    expect(await legacyDb('alex').collection('replenishment').countDocuments()).toBe(10);
    expect(await legacyDb('alex').collection('maintenance').countDocuments()).toBe(4);
    const r1 = await legacyDb('alex').collection('replenishment').findOne({ _id: REP.r1._id });
    expect(r1?.open_time).toEqual(REP.r1.open_time);
  });

  it('a second run changes nothing it finds — even a row edited since — and adds what is new', async () => {
    await AtmMaintenanceModel.updateOne(
      { _id: MAINT.m1._id },
      { $set: { notes: 'EDITED IN ECMS' } },
    ).exec();
    const fresh = maint('2026-11-22T08:00:00Z', {
      mach_id: '9002',
      close_time: at('2026-11-22T09:00:00Z'),
    });
    await legacyDb('alex').collection('maintenance').insertOne(fresh);
    const again = await runToEnd(BODY);
    expect(again.state).toBe('done');
    expect(again.replenishment).toMatchObject({ written: 0, existing: 5 });
    expect(again.maintenance).toMatchObject({ written: 1, existing: 2 });
    expect((await AtmMaintenanceModel.findById(MAINT.m1._id).lean().exec())?.notes).toBe(
      'EDITED IN ECMS',
    );
    expect(
      (await AtmMaintenanceModel.findById(fresh._id).lean().exec())?.legacyImportRunId,
    ).toEqual(new Types.ObjectId(again.id));
  });

  it('the card counts the source’s copies, and copies never count toward the suggested cutover', async () => {
    const res = await call('get', '/atm/legacy-import', adminToken);
    const alex = data<AtmLegacySourceDto[]>(res).find((s) => s.source === 'alex');
    expect(alex?.lastRun?.state).toBe('done');
    expect(alex?.copiedRows).toBe(8);
    expect(await cutover('alex')).toBeNull();
  });
});

describe('one run at a time', () => {
  it('refuses a second start, a second step at once, a branch move and an undo while one runs — and lets it finish', async () => {
    const started = await call('post', '/atm/legacy-import/runs', adminToken, BODY);
    expect(started.status).toBe(200);
    const running = data<AtmLegacyImportRunDto>(started);

    const second = await call('post', '/atm/legacy-import/runs', adminToken, BODY);
    expect(second.status).toBe(409);
    expect(errorCode(second)).toBe('ATM_LEGACY_IMPORT_RUNNING');

    // A step in progress holds the run: another sent meanwhile is refused, not run twice.
    await AtmLegacyImportRunModel.updateOne(
      { _id: running.id },
      { $set: { leaseUntil: new Date(Date.now() + 60_000) } },
    ).exec();
    const busy = await call('post', `/atm/legacy-import/runs/${running.id}/step`, adminToken);
    expect(busy.status).toBe(409);
    expect(errorCode(busy)).toBe('ATM_LEGACY_IMPORT_STEP_BUSY');
    await AtmLegacyImportRunModel.updateOne(
      { _id: running.id },
      { $set: { leaseUntil: null } },
    ).exec();

    // «نقل البيانات» of October into Alexandria waits for it.
    const move = await call('get', `/atm/branch-links/${octoberBranchId}/move`, adminToken);
    expect(move.status, JSON.stringify(move.body)).toBe(200);
    expect(data<AtmBranchMovePreviewDto>(move).blockers.map((b) => b.kind)).toContain(
      'legacyImportRunning',
    );

    const undo = await call('post', '/atm/legacy-import/sources/alex/undo', adminToken);
    expect(undo.status).toBe(409);

    const done = await stepToEnd(running);
    expect(done.state).toBe('done');
    // A finished run takes no more steps.
    const late = await call('post', `/atm/legacy-import/runs/${done.id}/step`, adminToken);
    expect(late.status).toBe(409);
    expect(errorCode(late)).toBe('ATM_LEGACY_IMPORT_STATE');
  });
});

describe('the undo', () => {
  it('removes every copy of the source, a batch per call, then marks its runs undone', async () => {
    let result: AtmLegacyUndoResultDto | undefined;
    const removed: number[] = [];
    for (let guard = 0; (result === undefined || result.remaining > 0) && guard < 20; guard += 1) {
      const res = await call('post', '/atm/legacy-import/sources/alex/undo', adminToken);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      result = data<AtmLegacyUndoResultDto>(res);
      removed.push(result.removed);
    }
    expect(removed).toEqual([2, 2, 2, 2]);
    expect(result?.remaining).toBe(0);
    expect(await AtmReplenishmentModel.countDocuments({ legacyImportRunId: { $ne: null } })).toBe(
      0,
    );
    expect(await AtmMaintenanceModel.countDocuments({ legacyImportRunId: { $ne: null } })).toBe(0);
    const runs = await AtmLegacyImportRunModel.find({ source: 'alex' }).lean().exec();
    expect(runs.map((run) => run.state)).toEqual(['undone', 'undone', 'undone']);
    // The legacy rows are all still there: a run can copy them again.
    expect(await legacyDb('alex').collection('maintenance').countDocuments()).toBe(5);
  });
});

describe('refusals', () => {
  it('refuses a holder of the key for one branch — the import is company-wide', async () => {
    expect((await call('post', '/atm/legacy-import/preview', holderToken, BODY)).status).toBe(403);
    expect((await call('get', '/atm/legacy-import', holderToken)).status).toBe(403);
  });

  it('refuses a source whose rows do not decide the time mode, before anything is copied', async () => {
    const res = await call('post', '/atm/legacy-import/runs', adminToken, {
      ...BODY,
      source: 'tanta',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(await AtmLegacyImportRunModel.countDocuments({ source: 'tanta' })).toBe(0);
  });

  it('refuses a source that is not one of the five', async () => {
    const res = await call('post', '/atm/legacy-import/preview', adminToken, {
      ...BODY,
      source: 'ecms',
    });
    expect(res.status).toBe(400);
  });
});

describe('the suggested cutover', () => {
  it('is the branch’s first own row of the first day it wrote at least 20', async () => {
    const opened = await request(app)
      .post('/api/v1/atm/maintenances/open')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-active-branch', alexBranchId)
      .send({
        rows: Array.from({ length: 20 }, () => ({
          machineCode: '9001',
          serviceType: 'SYN',
          referenceNumber: null,
        })),
      });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const first = await AtmMaintenanceModel.findOne({
      branchId: new Types.ObjectId(alexBranchId),
      legacyImportRunId: null,
    })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    expect(await cutover('alex')).toBe(first?.createdAt.toISOString());
  });
});
