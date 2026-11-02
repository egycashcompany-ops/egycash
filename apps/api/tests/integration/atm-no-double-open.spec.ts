// The owner's rule, end to end — and how it was lifted (2026-10-13, narrowed to the day
// 2026-10-27 — port doc OD-1; lifted for replenishments 2026-11-01 — OD-1b; lifted for
// maintenance 2026-11-02 — OD-1c):
//
//   «في ملحوظه مهمه جداً .. إن مينفعش أضيف ماكينة مرتين سواء فى عملية التغذية أو الصيانة»
//   «خلى الرفض دا يحصل فقط إذا كانت الماكينات مفتوحه في نفس اليوم ولم تُغلق ! مش يرفضها لو
//    مفتوحه أمبارح ومتقفلتش»
//   «عايزك تسمح فى التغذيات بإنى افتح تغذيه أكتر من واحده لنفس الماكينة عادى»
//   «في الصيانة عايزك تسمح إنه يضيف أكتر من صيانة عادي»
//
// A machine may have several open replenishments AND several open maintenances, on any day, in
// any branch — as in the legacy. Proven here over real HTTP, real RBAC and a real mongod: every
// path that creates or re-opens an open operation opens beside the machine's other open ones (the
// batch open, the reopen, an edit moving the open time, and for maintenance the mail accept), and
// concurrent writes all land — never a 500. The mail `duplication` flag stays, a warning only: a
// flagged ticket is accepted and opens another maintenance. What still holds a mail to ONE
// maintenance is the per-ticket index: concurrent accepts of the SAME ticket open exactly one, and
// none reports a refusal. The boot drops the per-day indexes older databases built, builds the
// per-ticket one (reported, counts only, and skipped over stored duplicates), and the legacy
// importer writes every row.
//
// Every code below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type AtmMailAcceptMetaDto,
  type AtmMailTicketDto,
  type AtmMaintenanceDto,
  type AtmReplenishmentDto,
  type OpenAtmMaintenancesResultDto,
  type OpenAtmReplenishmentsResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { logger } from '../../src/infrastructure/logging/logger';
import { type AuthContext } from '../../src/shared/types';
import { migrateAtmIndexes } from '../../src/modules/atm/atm-indexes';
import { AtmReplenishmentModel } from '../../src/modules/atm/replenishments/replenishment.model';
import { AtmMaintenanceModel } from '../../src/modules/atm/maintenances/maintenance.model';
import { AtmMailTicketModel } from '../../src/modules/atm/mail-tickets/mail-ticket.model';
import { atmMaintenanceRepository } from '../../src/modules/atm/maintenances/maintenance.repository';
import { atmMailTicketRepository } from '../../src/modules/atm/mail-tickets/mail-ticket.repository';
import { atmMailIngestionService } from '../../src/modules/atm/mail-tickets/mail-ingestion.service';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { importLegacyAtmDeployment } from '../../src/modules/atm/migration/legacy-import';
import { cairoDateString, cairoWallClockUtc } from '../../src/modules/atm/shared/cairo-time';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let mongoBase: { kind: 'replset' } | { kind: 'external'; url: string };
let app: Express;
let adminToken: string;
let alexToken: string; // the operating bundle at BRANCH scope, placed in Alex
let tantaToken: string; // the same bundle, placed in Tanta
let alexBranchId: string;
let tantaBranchId: string;
let portSaidBranchId: string;
let adminUserId: string;

const uriFor = (dbName: string): string => {
  if (mongoBase.kind === 'replset') return (replSet as MongoMemoryReplSet).getUri(dbName);
  const url = new URL(mongoBase.url);
  url.pathname = `/${dbName}`;
  return url.toString();
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

const post = (token: string, path: string, body: object): request.Test =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
const get = (token: string, path: string): request.Test =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

const openReps = (token: string, codes: string[]): request.Test =>
  post(token, '/atm/replenishments/open', {
    rows: codes.map((machineCode) => ({ machineCode, scheduleTime: null })),
    forceDate: null,
  });

const openMaints = (token: string, codes: string[], openedAt: string | null = null): request.Test =>
  post(token, '/atm/maintenances/open', {
    rows: codes.map((machineCode) => ({ machineCode, serviceType: null, referenceNumber: null })),
    openedAt,
  });

const repResult = (res: request.Response): OpenAtmReplenishmentsResultDto =>
  data<OpenAtmReplenishmentsResultDto>(res);
const maintResult = (res: request.Response): OpenAtmMaintenancesResultDto =>
  data<OpenAtmMaintenancesResultDto>(res);

/** Open rows of one code and kind, company-wide, straight from the collection. */
const openRows = async (kind: 'rep' | 'maint', machineCode: string): Promise<number> =>
  (kind === 'rep' ? AtmReplenishmentModel : AtmMaintenanceModel)
    .countDocuments({ machineCode, closedAt: null, isDeleted: false })
    .exec();

/**
 * Closing a maintenance needs a directory employee, which is not what this suite is about; the
 * close itself is proven in atm.spec.ts. The state "this maintenance was closed" is set directly.
 */
const closeMaintenanceDirectly = async (id: string): Promise<void> => {
  await AtmMaintenanceModel.updateOne(
    { _id: new Types.ObjectId(id) },
    { $set: { closedAt: new Date() } },
  ).exec();
};

const addMachines = async (
  token: string,
  machines: { machineCode: string; name: string }[],
): Promise<void> => {
  const res = await post(token, '/atm/machines/bulk', {
    bankName: 'SYN BANK',
    area: 'SYN AREA',
    machines,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const mailBody = (code: string): string =>
  `machine number: 1234_${code} ticket subject: X "Cash out" ticket number: 55`;

let mailSeq = 0;
const ingestMail = async (code: string): Promise<string> => {
  mailSeq += 1;
  const result = await atmMailIngestionService.ingest({
    providerMessageId: `no-double-open-${String(Date.now())}-${String(mailSeq)}`,
    receivedAt: new Date(),
    senderEmail: 'bank@example.test',
    subject: '',
    bodyText: mailBody(code),
  });
  expect(result.outcome).toBe('created');
  return result.ticketId as string;
};

const pendingTickets = async (token: string): Promise<AtmMailTicketDto[]> => {
  const res = await get(token, '/atm/mail-tickets?pageSize=100');
  expect(res.status).toBe(200);
  return data<AtmMailTicketDto[]>(res);
};

beforeAll(async () => {
  const external = process.env.MONGO_TEST_URI;
  if (external !== undefined && external !== '') {
    mongoBase = { kind: 'external', url: external };
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    mongoBase = { kind: 'replset' };
  }
  await bootPlatform({
    mongoUri: uriFor(`ecms-atm-no-double-open-${String(Date.now())}`),
    modules: moduleManifests,
  });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  adminUserId = await mkUser('atm-once-admin@ecms.local');
  await rbacService.ensureAssignment(adminUserId, String(superAdmin._id), 'organization');
  const ctx: AuthContext = {
    userId: adminUserId,
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
  adminToken = await login('atm-once-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await post(adminToken, '/platform/branches', { code, name: { ar, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  alexBranchId = await mkBranch('90', 'الإسكندرية', 'Alexandria');
  tantaBranchId = await mkBranch('91', 'طنطا', 'Tanta');
  portSaidBranchId = await mkBranch('92', 'بورسعيد', 'Port Said');

  const operatorRole = await rbacService.createRole(
    {
      name: { en: 'ATM operator', ar: 'مشغل صراف آلي' },
      permissionKeys: [
        'atmReplenishment.view',
        'atmReplenishment.create',
        'atmReplenishment.edit',
        'atmReplenishment.delete',
        'atmReplenishment.complete',
        'atmMaintenance.view',
        'atmMaintenance.create',
        'atmMaintenance.edit',
        'atmMaintenance.complete',
        'atmMailTicket.view',
        'atmMailTicket.decide',
        'atmMachine.view',
        'atmMachine.manage',
      ],
    },
    adminUserId,
  );
  const alexId = await mkUser('atm-once-alex@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(alexId, String(operatorRole._id), 'branch');
  alexToken = await login('atm-once-alex@ecms.local');
  const tantaId = await mkUser('atm-once-tanta@ecms.local', tantaBranchId);
  await rbacService.ensureAssignment(tantaId, String(operatorRole._id), 'branch');
  tantaToken = await login('atm-once-tanta@ecms.local');

  await addMachines(alexToken, [
    { machineCode: '5001', name: 'SYN 5001' },
    { machineCode: '5002', name: 'SYN 5002' },
    { machineCode: '5003', name: 'SYN 5003' },
    { machineCode: '5004', name: 'SYN 5004' },
    { machineCode: '5005', name: 'SYN 5005' },
    { machineCode: '5006', name: 'SYN 5006' },
    { machineCode: '6001', name: 'SYN 6001' },
    { machineCode: '6002', name: 'SYN 6002' },
    { machineCode: '6003', name: 'SYN 6003' },
    { machineCode: '6004', name: 'SYN 6004' },
    { machineCode: '6005', name: 'SYN 6005' },
    { machineCode: '6006', name: 'SYN 6006' },
    { machineCode: '7101', name: 'SYN 7101' },
    { machineCode: '7102', name: 'SYN 7102' },
    { machineCode: '7103', name: 'SYN 7103' },
    { machineCode: '7104', name: 'SYN 7104' },
    { machineCode: '8001', name: 'SYN 8001 Alex' },
    { machineCode: '9901', name: 'SYN 9901' },
  ]);
  // The same code in Tanta too — a master that exists in two branches (or moved between them).
  // Written as the legacy import left such pairs: the data-edit add now refuses a code active in
  // another branch (DEC-9 — the mail matcher needs one active machine per code), and the pairs
  // already stored are left alone (R-9), which is the state these scenarios are about.
  await AtmMachineModel.create([
    {
      branchId: new Types.ObjectId(tantaBranchId),
      bankName: 'SYN BANK',
      machineCode: '8001',
      name: 'SYN 8001 Tanta',
      zone: '',
      area: 'SYN AREA',
      isActive: true,
    },
  ]);
}, 240_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

/** A maintenance row as a raw insert writes it — no model, no service, no index of its own. */
const rawMaintenance = (
  over: Record<string, unknown> = {},
): Record<string, unknown> & {
  _id: Types.ObjectId;
} => ({
  _id: new Types.ObjectId(),
  branchId: new Types.ObjectId(alexBranchId),
  machineId: new Types.ObjectId(),
  machineCode: '9901',
  bankName: 'SYN BANK',
  machineName: 'SYN 9901 raw',
  zone: '',
  area: 'SYN AREA',
  openedAt: new Date(),
  openDay: cairoDateString(new Date()),
  closedAt: null,
  serviceType: null,
  notes: null,
  referenceNumber: null,
  source: 'manual',
  mailTicketId: null,
  leaderEmployeeId: null,
  leaderName: null,
  openedById: null,
  openedByName: null,
  closedById: null,
  closedByName: null,
  isDeleted: false,
  deletedAt: null,
  schemaVersion: 1,
  __v: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  deletedBy: null,
  ...over,
});

/** Live maintenances opened from one ticket, closed ones included — what the per-ticket index holds. */
const liveFromTicket = (ticketId: string): Promise<number> =>
  AtmMaintenanceModel.countDocuments({
    mailTicketId: new Types.ObjectId(ticketId),
    isDeleted: false,
  }).exec();

describe('after boot: no open-operation index on either log — one per mail ticket instead', () => {
  it('atm_maintenances carries no per-day index; its one unique index is ux_maintenance_per_mail_ticket', async () => {
    const indexes = await AtmMaintenanceModel.collection.listIndexes().toArray();
    expect(indexes.map((index) => index.name)).not.toContain('ux_open_maintenance_per_code_day');
    const unique = indexes.filter((index) => index.unique === true);
    expect(unique.map((index) => index.name)).toEqual(['ux_maintenance_per_mail_ticket']);
    expect(unique[0]?.key).toEqual({ mailTicketId: 1 });
    expect(unique[0]?.partialFilterExpression).toEqual({
      mailTicketId: { $type: 'objectId' },
      isDeleted: false,
    });
  });

  it('atm_replenishments carries no unique index — a machine may have several open (OD-1b)', async () => {
    const indexes = await AtmReplenishmentModel.collection.listIndexes().toArray();
    expect(indexes.filter((index) => index.unique === true).map((index) => index.name)).toEqual([]);
  });

  it.each(['atm_replenishments', 'atm_maintenances'])(
    '%s carries the index the per-day question runs on (the mail duplication flag asks it of maintenance) — not a scan of the log',
    async (collection) => {
      const indexes = await mongoose.connection.db?.collection(collection).listIndexes().toArray();
      const index = indexes?.find((entry) => entry.name === 'ix_open_code_opened');
      expect(index?.key).toEqual({ machineCode: 1, openedAt: 1 });
      expect(index?.partialFilterExpression).toEqual({ closedAt: null, isDeleted: false });
      // The repository's own question (operation-log.repository.ts `openMachineCodes`).
      const question = {
        isDeleted: false,
        closedAt: null,
        machineCode: { $in: ['5001'] },
        openedAt: {
          $gte: new Date('2026-10-27T00:00:00Z'),
          $lt: new Date('2026-10-28T00:00:00Z'),
        },
      };
      const plan =
        collection === 'atm_replenishments'
          ? await AtmReplenishmentModel.find(question).explain('queryPlanner')
          : await AtmMaintenanceModel.find(question).explain('queryPlanner');
      expect(JSON.stringify(plan)).toContain('ix_open_code_opened');
    },
  );

  it('drops the retired indexes — the any-day form and BOTH per-day forms — and nothing else', async () => {
    // A database that ran the earlier forms carries them.
    const perCodeDay = {
      unique: true,
      partialFilterExpression: {
        closedAt: null,
        isDeleted: false,
        machineCode: { $gt: '' },
        openDay: { $gt: '' },
      },
    };
    await AtmMaintenanceModel.collection.createIndex(
      { machineCode: 1 },
      {
        name: 'ux_open_maintenance_per_code',
        unique: true,
        partialFilterExpression: { closedAt: null, isDeleted: false, machineCode: { $gt: '' } },
      },
    );
    await AtmMaintenanceModel.collection.createIndex(
      { machineCode: 1, openDay: 1 },
      { name: 'ux_open_maintenance_per_code_day', ...perCodeDay },
    );
    await AtmReplenishmentModel.collection.createIndex(
      { machineCode: 1, openDay: 1 },
      { name: 'ux_open_replenishment_per_code_day', ...perCodeDay },
    );
    const result = await migrateAtmIndexes();
    expect(result.dropped).toEqual([
      { collection: 'atm_replenishments', index: 'ux_open_replenishment_per_code_day' },
      { collection: 'atm_maintenances', index: 'ux_open_maintenance_per_code' },
      { collection: 'atm_maintenances', index: 'ux_open_maintenance_per_code_day' },
    ]);
    const maintenanceNames = (await AtmMaintenanceModel.collection.listIndexes().toArray()).map(
      (index) => index.name,
    );
    expect(maintenanceNames).not.toContain('ux_open_maintenance_per_code');
    expect(maintenanceNames).not.toContain('ux_open_maintenance_per_code_day');
    expect(maintenanceNames).toContain('ux_maintenance_per_mail_ticket');
    expect(maintenanceNames).toContain('ix_open_code_opened');
    const replenishmentNames = (await AtmReplenishmentModel.collection.listIndexes().toArray()).map(
      (index) => index.name,
    );
    expect(replenishmentNames).not.toContain('ux_open_replenishment_per_code_day');
    expect(replenishmentNames).toContain('ix_open_code_opened');
    // Idempotent: nothing left to drop, and no retired index is built again.
    expect((await migrateAtmIndexes()).dropped).toEqual([]);
    expect(
      (await AtmMaintenanceModel.collection.listIndexes().toArray()).map((index) => index.name),
    ).not.toContain('ux_open_maintenance_per_code_day');
    expect(
      (await AtmReplenishmentModel.collection.listIndexes().toArray()).map((index) => index.name),
    ).not.toContain('ux_open_replenishment_per_code_day');
  });

  it('the per-ticket index refuses a second LIVE maintenance of one ticket — a closed one holds it too; a deleted one and rows with no ticket never collide', async () => {
    const collection = AtmMaintenanceModel.collection;
    const ticket = new Types.ObjectId();
    const closed = rawMaintenance({ mailTicketId: ticket, source: 'mail', closedAt: new Date() });
    const deleted = rawMaintenance({ mailTicketId: ticket, source: 'mail', isDeleted: true });
    const manualA = rawMaintenance();
    const manualB = rawMaintenance();
    const second = rawMaintenance({ mailTicketId: ticket, source: 'mail' });
    try {
      await collection.insertMany([closed, deleted, manualA, manualB]);
      await expect(collection.insertOne(second)).rejects.toMatchObject({ code: 11000 });
      // Once the live one is deleted (a restore), the ticket may open again.
      await collection.updateOne({ _id: closed._id }, { $set: { isDeleted: true } });
      await expect(collection.insertOne(second)).resolves.toBeDefined();
    } finally {
      await collection.deleteMany({
        _id: { $in: [closed._id, deleted._id, manualA._id, manualB._id, second._id] },
      });
    }
  });
});

describe('replenishment — several open per machine (OD-1b)', () => {
  it('opens a second replenishment of a machine that already has one open today', async () => {
    const first = await openReps(alexToken, ['5001']);
    expect(first.status).toBe(200);
    expect(repResult(first).opened.map((r) => r.machineCode)).toEqual(['5001']);

    const second = await openReps(alexToken, ['5001']);
    expect(second.status).toBe(200);
    expect(repResult(second)).toMatchObject({ unknownCodes: [], alreadyOpenCodes: [] });
    expect(repResult(second).opened.map((r) => r.machineCode)).toEqual(['5001']);
    expect(repResult(second).opened[0]?.id).not.toBe(repResult(first).opened[0]?.id);
    expect(await openRows('rep', '5001')).toBe(2);
  });

  it('opens a code repeated in ONE batch on every line, as the legacy did, and still reports unknown codes', async () => {
    const res = await openReps(alexToken, ['5002', '5002', '9999', '5005', '5002', '5001']);
    expect(res.status).toBe(200);
    const body = repResult(res);
    expect(body.opened.map((r) => r.machineCode)).toEqual(['5002', '5002', '5005', '5002', '5001']);
    expect(body.alreadyOpenCodes).toEqual([]);
    expect(body.unknownCodes).toEqual(['9999']);
    expect(await openRows('rep', '5002')).toBe(3);
    expect(await openRows('rep', '5001')).toBe(3);
  });

  it('reopens a closed replenishment while another of the machine is open', async () => {
    const open = repResult(await openReps(alexToken, ['5003'])).opened[0] as AtmReplenishmentDto;
    const close = await post(alexToken, '/atm/replenishments/close', { ids: [open.id] });
    expect(close.status).toBe(200);
    const closed = data<AtmReplenishmentDto[]>(close)[0] as AtmReplenishmentDto;
    expect(repResult(await openReps(alexToken, ['5003'])).opened).toHaveLength(1);

    const reopened = await post(alexToken, `/atm/replenishments/${closed.id}/reopen`, {
      version: closed.version,
    });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(data<AtmReplenishmentDto>(reopened).closedAt).toBeNull();
    expect(await openRows('rep', '5003')).toBe(2);
  });

  it('two concurrent opens of one code both open — no index to lose to', async () => {
    const [a, b] = await Promise.all([
      openReps(alexToken, ['7101']),
      openReps(alexToken, ['7101']),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([repResult(a), repResult(b)].flatMap((r) => r.opened)).toHaveLength(2);
    expect([repResult(a), repResult(b)].flatMap((r) => r.alreadyOpenCodes)).toEqual([]);
    expect(await openRows('rep', '7101')).toBe(2);
  });
});

describe('maintenance — several open per machine (OD-1c)', () => {
  it('opens a maintenance on a machine whose replenishments are open — they never block it', async () => {
    expect(await openRows('rep', '5001')).toBe(3);
    const res = await openMaints(alexToken, ['5001']);
    expect(res.status).toBe(200);
    expect(maintResult(res).opened.map((m) => m.machineCode)).toEqual(['5001']);
    expect(maintResult(res).alreadyOpenCodes).toEqual([]);
  });

  it('opens a second maintenance of a machine already in maintenance today, and a code repeated in the batch on every line', async () => {
    const res = await openMaints(alexToken, ['5001', '5006', '9999', '5006']);
    expect(res.status).toBe(200);
    const body = maintResult(res);
    expect(body.opened.map((m) => m.machineCode)).toEqual(['5001', '5006', '5006']);
    expect(body.alreadyOpenCodes).toEqual([]);
    expect(body.unknownCodes).toEqual(['9999']);
    expect(await openRows('maint', '5001')).toBe(2);
    expect(await openRows('maint', '5006')).toBe(2);
  });

  it('reopens a closed maintenance while another of the machine is open', async () => {
    const first = maintResult(await openMaints(alexToken, ['5004'])).opened[0] as AtmMaintenanceDto;
    await closeMaintenanceDirectly(first.id);
    const second = await openMaints(alexToken, ['5004']);
    expect(maintResult(second).opened.map((m) => m.machineCode)).toEqual(['5004']);

    const closed = await AtmMaintenanceModel.findById(first.id).lean().exec();
    const reopened = await post(alexToken, `/atm/maintenances/${first.id}/reopen`, {
      version: closed?.__v,
    });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(data<AtmMaintenanceDto>(reopened).closedAt).toBeNull();
    expect((await AtmMaintenanceModel.findById(first.id).lean().exec())?.openDay).toBe(
      cairoDateString(new Date(first.openedAt)),
    );
    expect(await openRows('maint', '5004')).toBe(2);
  });
});

describe('mail accept — a machine already in maintenance is accepted; the duplicate flag is a warning (OD-1c)', () => {
  it('flags an open maintenance of the TICKET’S day only, and accepts the flagged ticket — another maintenance opens', async () => {
    const ticketId = await ingestMail('6001');
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      false,
    );

    // Opened two days ago and never closed — an earlier day: no duplicate.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const stale = maintResult(await openMaints(alexToken, ['6001'], twoDaysAgo));
    expect(stale.opened).toHaveLength(1);
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      false,
    );

    // Opened on the ticket's own day — the duplicate the screen paints.
    const opened = maintResult(await openMaints(alexToken, ['6001']));
    expect(opened.opened).toHaveLength(1);
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      true,
    );

    // …and accept opens another one beside it, refusing nothing.
    const accept = await post(alexToken, '/atm/mail-tickets/accept', { ids: [ticketId] });
    expect(accept.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(accept).map((t) => t.id)).toEqual([ticketId]);
    expect((accept.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([]);
    expect((await AtmMailTicketModel.findById(ticketId).lean().exec())?.status).toBe('accepted');
    expect(await openRows('maint', '6001')).toBe(3);
    expect(await liveFromTicket(ticketId)).toBe(1);

    // The ingest-time flag asks the same question, and a flagged mail is accepted all the same.
    const later = await ingestMail('6001');
    expect((await AtmMailTicketModel.findById(later).lean().exec())?.duplicationAtIngest).toBe(
      true,
    );
    expect((await pendingTickets(alexToken)).find((t) => t.id === later)?.duplication).toBe(true);
    const second = await post(alexToken, '/atm/mail-tickets/accept', { ids: [later] });
    expect(data<AtmMailTicketDto[]>(second).map((t) => t.id)).toEqual([later]);
    expect(await openRows('maint', '6001')).toBe(4);
  });

  it('accepts both of two tickets for one machine in one selection — two maintenances', async () => {
    const a = await ingestMail('6002');
    const b = await ingestMail('6002');
    const res = await post(alexToken, '/atm/mail-tickets/accept', { ids: [a, b] });
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res).map((t) => t.id)).toEqual([a, b]);
    expect((res.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([]);
    expect(await openRows('maint', '6002')).toBe(2);
    expect([await liveFromTicket(a), await liveFromTicket(b)]).toEqual([1, 1]);
    const pending = await pendingTickets(alexToken);
    expect(pending.map((t) => t.id)).not.toContain(a);
    expect(pending.map((t) => t.id)).not.toContain(b);
  });
});

describe('mail accept — a concurrent accept of the SAME ticket opens ONE maintenance, and is never reported refused', () => {
  const accept = (ticketId: string): request.Test =>
    post(alexToken, '/atm/mail-tickets/accept', { ids: [ticketId] });
  const refusedOf = (res: request.Response): AtmMailAcceptMetaDto['refused'] =>
    (res.body as { meta: AtmMailAcceptMetaDto }).meta.refused;

  it('the request that read the ticket as pending, and lost, skips it silently', async () => {
    const ticketId = await ingestMail('6004');
    const pendingSnapshot = await atmMailTicketRepository.findById(ticketId);
    expect(pendingSnapshot?.status).toBe('pending');

    const winner = await accept(ticketId);
    expect(data<AtmMailTicketDto[]>(winner).map((t) => t.id)).toEqual([ticketId]);

    // The loser read the ticket BEFORE the winner flipped it; its open is then refused by the
    // per-ticket index — the maintenance opened from this very ticket — which is an accept, not a
    // refusal.
    vi.spyOn(atmMailTicketRepository, 'findById').mockResolvedValueOnce(pendingSnapshot);
    const loser = await accept(ticketId);
    expect(loser.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(loser)).toEqual([]);
    expect(refusedOf(loser)).toEqual([]);
    expect((await AtmMailTicketModel.findById(ticketId).lean().exec())?.status).toBe('accepted');
    expect(await openRows('maint', '6004')).toBe(1);
    expect(await liveFromTicket(ticketId)).toBe(1);
  });

  it('a stale read of a ticket whose maintenance is CLOSED since is skipped too — the index holds closed rows', async () => {
    const ticketId = await ingestMail('6005');
    const pendingSnapshot = await atmMailTicketRepository.findById(ticketId);
    const winner = await accept(ticketId);
    expect(data<AtmMailTicketDto[]>(winner)).toHaveLength(1);
    const fromTicket = await AtmMaintenanceModel.findOne({
      mailTicketId: new Types.ObjectId(ticketId),
    })
      .lean()
      .exec();
    await closeMaintenanceDirectly(String(fromTicket?._id));
    // Another maintenance of the machine, typed on the board, changes nothing for the ticket.
    expect(maintResult(await openMaints(alexToken, ['6005'])).opened).toHaveLength(1);

    vi.spyOn(atmMailTicketRepository, 'findById').mockResolvedValueOnce(pendingSnapshot);
    const loser = await accept(ticketId);
    expect(loser.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(loser)).toEqual([]);
    expect(refusedOf(loser)).toEqual([]);
    expect(await liveFromTicket(ticketId)).toBe(1);
    expect(await openRows('maint', '6005')).toBe(1);
  });

  it("between the winner's two writes (maintenance opened, ticket not yet flipped) — skipped too", async () => {
    const ticketId = await ingestMail('6006');
    const ticket = await AtmMailTicketModel.findById(ticketId).lean().exec();
    // The winner's first write, alone: the maintenance opened FROM this ticket.
    await AtmMaintenanceModel.create({
      branchId: ticket?.branchId,
      machineId: ticket?.machineId,
      machineCode: '6006',
      bankName: ticket?.bankName,
      machineName: ticket?.machineName,
      zone: '',
      area: ticket?.area,
      openedAt: ticket?.receivedAt,
      closedAt: null,
      source: 'mail',
      mailTicketId: ticket?._id,
    });
    const loser = await accept(ticketId);
    expect(loser.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(loser)).toEqual([]);
    expect(refusedOf(loser)).toEqual([]);
    expect(await openRows('maint', '6006')).toBe(1);
    expect(await liveFromTicket(ticketId)).toBe(1);
  });

  it('three concurrent accepts of one ticket: one accepts it and opens ONE maintenance, none reports it refused', async () => {
    const ticketId = await ingestMail('6006');
    // The machine already in maintenance does not matter any more (OD-1c); closed only so the
    // count below is this ticket's alone.
    await AtmMaintenanceModel.updateMany(
      { machineCode: '6006', closedAt: null },
      { $set: { closedAt: new Date() } },
    ).exec();
    const responses = await Promise.all([accept(ticketId), accept(ticketId), accept(ticketId)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(responses.flatMap((r) => data<AtmMailTicketDto[]>(r).map((t) => t.id))).toEqual([
      ticketId,
    ]);
    expect(responses.flatMap((r) => refusedOf(r))).toEqual([]);
    expect((await AtmMailTicketModel.findById(ticketId).lean().exec())?.status).toBe('accepted');
    expect(await openRows('maint', '6006')).toBe(1);
    expect(await liveFromTicket(ticketId)).toBe(1);
  });

  it('three concurrent accepts of a FLAGGED ticket — its machine already in maintenance — still open exactly one more', async () => {
    expect(maintResult(await openMaints(alexToken, ['6003'])).opened).toHaveLength(1);
    const ticketId = await ingestMail('6003');
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      true,
    );
    const responses = await Promise.all([accept(ticketId), accept(ticketId), accept(ticketId)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(responses.flatMap((r) => data<AtmMailTicketDto[]>(r).map((t) => t.id))).toEqual([
      ticketId,
    ]);
    expect(responses.flatMap((r) => refusedOf(r))).toEqual([]);
    expect(await openRows('maint', '6003')).toBe(2);
    expect(await liveFromTicket(ticketId)).toBe(1);
  });
});

describe('an empty machine code identifies no machine — never flagged, and its row reopens', () => {
  it('an empty code is never "open" to the duplication question, and a reopen of such a row works beside another', async () => {
    const open = rawMaintenance({ machineCode: '', machineName: 'SYN legacy blank' });
    const closed = rawMaintenance({
      machineCode: '',
      machineName: 'SYN legacy blank',
      closedAt: new Date(),
    });
    await AtmMaintenanceModel.collection.insertMany([open, closed]);
    try {
      expect(await atmMaintenanceRepository.hasOpenOperation('', cairoDateString(new Date()))).toBe(
        false,
      );
      const res = await post(alexToken, `/atm/maintenances/${String(closed._id)}/reopen`, {
        version: 0,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(data<AtmMaintenanceDto>(res).closedAt).toBeNull();
    } finally {
      await AtmMaintenanceModel.collection.deleteMany({ _id: { $in: [open._id, closed._id] } });
    }
  });
});

describe('company-wide, without describing the other branch', () => {
  it('Tanta opens and reopens a maintenance of a machine code open in Alex — and the answer names nothing of Alex', async () => {
    // Tanta opens and closes 8001 first, so it holds a closed row to reopen later.
    const tantaRow = maintResult(await openMaints(tantaToken, ['8001']))
      .opened[0] as AtmMaintenanceDto;
    await closeMaintenanceDirectly(tantaRow.id);
    const tantaClosed = await AtmMaintenanceModel.findById(tantaRow.id).lean().exec();

    const alexOpen = maintResult(await openMaints(alexToken, ['8001']))
      .opened[0] as AtmMaintenanceDto;
    expect(alexOpen.branchId).toBe(alexBranchId);

    const res = await openMaints(tantaToken, ['8001']);
    expect(res.status).toBe(200);
    expect(maintResult(res).opened.map((m) => m.branchId)).toEqual([tantaBranchId]);
    expect(maintResult(res)).toMatchObject({ unknownCodes: [], alreadyOpenCodes: [] });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(alexBranchId);
    expect(text).not.toContain(alexOpen.id);
    expect(text).not.toContain('Alex');

    const reopen = await post(tantaToken, `/atm/maintenances/${tantaRow.id}/reopen`, {
      version: tantaClosed?.__v,
    });
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(200);
    const answer = JSON.stringify(reopen.body);
    expect(answer).not.toContain(alexBranchId);
    expect(answer).not.toContain(alexOpen.id);
    expect(await openRows('maint', '8001')).toBe(3);

    // Tanta still cannot see Alex's row.
    const list = await get(tantaToken, '/atm/maintenances?pageSize=100');
    expect(data<AtmMaintenanceDto[]>(list).map((m) => m.id)).not.toContain(alexOpen.id);
  });

  it('a replenishment open in Alex never blocks Tanta’s — replenishments are outside the rule', async () => {
    const alexRep = repResult(await openReps(alexToken, ['8001'])).opened[0] as AtmReplenishmentDto;
    expect(alexRep.branchId).toBe(alexBranchId);
    const res = await openReps(tantaToken, ['8001']);
    expect(res.status).toBe(200);
    expect(repResult(res).opened.map((r) => r.branchId)).toEqual([tantaBranchId]);
    expect(repResult(res).alreadyOpenCodes).toEqual([]);
  });
});

describe('any day — an operation open on the same day or an earlier one never blocks', () => {
  const DAY = 24 * 3600 * 1000;
  // Calendar arithmetic on the Cairo date, never «now ± 24h»: on the day Egypt leaves summer time
  // the day has 25 hours, and now − 24h can still be today.
  const dayAt = (offsetDays: number): string => {
    const [y, m, d] = cairoDateString(new Date()).split('-').map(Number) as [
      number,
      number,
      number,
    ];
    return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
  };
  const openRepsOn = (codes: string[], forceDate: string): request.Test =>
    post(alexToken, '/atm/replenishments/open', {
      rows: codes.map((machineCode) => ({ machineCode, scheduleTime: null })),
      forceDate,
    });
  const patch = (path: string, body: object): request.Test =>
    request(app).patch(`/api/v1${path}`).set('Authorization', `Bearer ${alexToken}`).send(body);

  beforeAll(async () => {
    await addMachines(alexToken, [
      { machineCode: '5101', name: 'SYN 5101' },
      { machineCode: '5102', name: 'SYN 5102' },
      { machineCode: '5103', name: 'SYN 5103' },
      { machineCode: '5104', name: 'SYN 5104' },
      { machineCode: '5105', name: 'SYN 5105' },
      { machineCode: '5106', name: 'SYN 5106' },
      { machineCode: '5107', name: 'SYN 5107' },
    ]);
  });

  it('replenishment: a machine opens yesterday, today, and again today — no day blocks it', async () => {
    expect(repResult(await openRepsOn(['5101'], dayAt(-1))).opened).toHaveLength(1);
    expect(repResult(await openReps(alexToken, ['5101'])).opened).toHaveLength(1);
    const again = repResult(await openReps(alexToken, ['5101']));
    expect(again.opened.map((r) => r.machineCode)).toEqual(['5101']);
    expect(again.alreadyOpenCodes).toEqual([]);
    expect(await openRows('rep', '5101')).toBe(3);
  });

  it('maintenance: a row stored before `openDay` existed blocks nothing — and the duplication flag still counts it by its open time', async () => {
    const legacy = rawMaintenance({
      machineCode: '5102',
      machineName: 'SYN 5102 before the field',
    });
    delete legacy.openDay;
    await AtmMaintenanceModel.collection.insertOne(legacy);
    try {
      const ticketId = await ingestMail('5102');
      expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
        true,
      );
      const opened = maintResult(await openMaints(alexToken, ['5102']));
      expect(opened.opened.map((m) => m.machineCode)).toEqual(['5102']);
      expect(opened.alreadyOpenCodes).toEqual([]);
    } finally {
      await AtmMaintenanceModel.collection.deleteOne({ _id: legacy._id });
    }
  });

  it('replenishment: schedules ahead — tomorrow opens beside today’s, and a second for tomorrow too', async () => {
    expect(repResult(await openReps(alexToken, ['5103'])).opened).toHaveLength(1);
    const tomorrow = repResult(await openRepsOn(['5103'], dayAt(1)));
    expect(tomorrow.opened).toHaveLength(1);
    expect(cairoDateString(new Date(tomorrow.opened[0]?.openedAt as string))).toBe(dayAt(1));
    expect(repResult(await openRepsOn(['5103'], dayAt(1))).opened).toHaveLength(1);
    expect(await openRows('rep', '5103')).toBe(3);
  });

  it('maintenance: a machine opens two days ago, today, and again today — no day blocks it', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString();
    expect(maintResult(await openMaints(alexToken, ['5104'], twoDaysAgo)).opened).toHaveLength(1);
    expect(maintResult(await openMaints(alexToken, ['5104'])).opened).toHaveLength(1);
    const again = maintResult(await openMaints(alexToken, ['5104']));
    expect(again.opened.map((m) => m.machineCode)).toEqual(['5104']);
    expect(again.alreadyOpenCodes).toEqual([]);
    expect(await openRows('maint', '5104')).toBe(3);
  });

  it('maintenance: a reopen is never refused — yesterday’s row and today’s both reopen beside an open one', async () => {
    const yesterday = cairoWallClockUtc(dayAt(-1), 12).toISOString();
    const y = maintResult(await openMaints(alexToken, ['5105'], yesterday))
      .opened[0] as AtmMaintenanceDto;
    const a = maintResult(await openMaints(alexToken, ['5105'])).opened[0] as AtmMaintenanceDto;
    await closeMaintenanceDirectly(y.id);
    await closeMaintenanceDirectly(a.id);
    const b = maintResult(await openMaints(alexToken, ['5105'])).opened[0] as AtmMaintenanceDto;
    expect(b).toBeDefined();

    const closedY = await AtmMaintenanceModel.findById(y.id).lean().exec();
    const reopenY = await post(alexToken, `/atm/maintenances/${y.id}/reopen`, {
      version: closedY?.__v,
    });
    expect(reopenY.status, JSON.stringify(reopenY.body)).toBe(200);
    expect((await AtmMaintenanceModel.findById(y.id).lean().exec())?.openDay).toBe(dayAt(-1));

    const closedA = await AtmMaintenanceModel.findById(a.id).lean().exec();
    const reopenA = await post(alexToken, `/atm/maintenances/${a.id}/reopen`, {
      version: closedA?.__v,
    });
    expect(reopenA.status, 'today’s row: today already has an open one').toBe(200);
    expect(await openRows('maint', '5105')).toBe(3);
  });

  it('replenishment: an edit MOVING an open row onto a day its machine is already open is allowed — single and bulk', async () => {
    const today = repResult(await openReps(alexToken, ['5106'])).opened[0] as AtmReplenishmentDto;
    const ahead = repResult(await openRepsOn(['5106'], dayAt(1))).opened[0] as AtmReplenishmentDto;

    const single = await patch(`/atm/replenishments/${ahead.id}`, {
      openedAt: cairoWallClockUtc(dayAt(0), 11).toISOString(),
      version: ahead.version,
    });
    expect(single.status, JSON.stringify(single.body)).toBe(200);
    expect((await AtmReplenishmentModel.findById(ahead.id).lean().exec())?.openDay).toBe(dayAt(0));

    // The bulk edit sets ONE instant on every checked row — two rows of one machine share it.
    const both = await patch('/atm/replenishments/bulk', {
      ids: [today.id, ahead.id],
      openedAt: cairoWallClockUtc(dayAt(2), 10).toISOString(),
    });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    for (const id of [today.id, ahead.id]) {
      expect((await AtmReplenishmentModel.findById(id).lean().exec())?.openDay).toBe(dayAt(2));
    }
    expect(await openRows('rep', '5106')).toBe(2);
  });

  it('maintenance: an edit MOVING an open row onto a day its machine is already in maintenance is allowed', async () => {
    const today = maintResult(await openMaints(alexToken, ['5107'])).opened[0] as AtmMaintenanceDto;
    const earlier = maintResult(
      await openMaints(alexToken, ['5107'], new Date(Date.now() - 2 * DAY).toISOString()),
    ).opened[0] as AtmMaintenanceDto;
    const moved = await patch(`/atm/maintenances/${earlier.id}`, {
      openedAt: today.openedAt,
      version: earlier.version,
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await AtmMaintenanceModel.findById(earlier.id).lean().exec())?.openDay).toBe(dayAt(0));
    expect(await openRows('maint', '5107')).toBe(2);
  });
});

describe('concurrent maintenance writes — no index to lose to, every one lands, never a 500', () => {
  it('two concurrent maintenance opens of one code both open', async () => {
    const [a, b] = await Promise.all([
      openMaints(alexToken, ['7101']),
      openMaints(alexToken, ['7101']),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const results = [maintResult(a), maintResult(b)];
    expect(results.flatMap((r) => r.opened)).toHaveLength(2);
    expect(results.flatMap((r) => r.alreadyOpenCodes)).toEqual([]);
    expect(await openRows('maint', '7101')).toBe(2);
  });

  it('two concurrent REOPENS of two closed maintenances of one machine: both 200', async () => {
    const ids: { id: string; version: number }[] = [];
    for (let i = 0; i < 2; i += 1) {
      const row = maintResult(await openMaints(alexToken, ['7102'])).opened[0] as AtmMaintenanceDto;
      await closeMaintenanceDirectly(row.id);
      const after = await AtmMaintenanceModel.findById(row.id).lean().exec();
      ids.push({ id: row.id, version: after?.__v as number });
    }
    const responses = await Promise.all(
      ids.map(({ id, version }) => post(alexToken, `/atm/maintenances/${id}/reopen`, { version })),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await openRows('maint', '7102')).toBe(2);
  });
});

describe('the boot and rows already stored', () => {
  it('open maintenances of one machine and day are nothing to report any more — no index skipped, nothing logged', async () => {
    const rows = [
      rawMaintenance({ machineName: 'SYN 9901 stale 1' }),
      rawMaintenance({ machineName: 'SYN 9901 stale 2' }),
    ];
    await AtmMaintenanceModel.collection.insertMany(rows);
    try {
      const errors = vi.spyOn(logger, 'error');
      const result = await migrateAtmIndexes();
      // Neither operation log has anything to say: both hold open duplicates by now (5001…).
      expect(result.skippedDuplicates.map((entry) => entry.collection)).not.toContain(
        'atm_maintenances',
      );
      expect(result.skippedDuplicates.map((entry) => entry.collection)).not.toContain(
        'atm_replenishments',
      );
      expect(
        errors.mock.calls.some((call) => JSON.stringify(call[0]).includes('atm_maintenances')),
      ).toBe(false);
      expect(maintResult(await openMaints(alexToken, ['9901'])).opened).toHaveLength(1);
      expect(await openRows('maint', '9901')).toBe(3);
    } finally {
      await AtmMaintenanceModel.collection.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
    }
  });

  it('two live maintenances of ONE ticket already stored: the per-ticket index is reported — counts only — and skipped, then built once resolved', async () => {
    const collection = AtmMaintenanceModel.collection;
    await collection.dropIndex('ux_maintenance_per_mail_ticket');
    const ticket = new Types.ObjectId();
    const rows = [
      rawMaintenance({ mailTicketId: ticket, source: 'mail', machineName: 'SYN 9901 mail 1' }),
      rawMaintenance({ mailTicketId: ticket, source: 'mail', machineName: 'SYN 9901 mail 2' }),
    ];
    await collection.insertMany(rows);
    try {
      const errors = vi.spyOn(logger, 'error');
      const result = await migrateAtmIndexes();
      expect(result.skippedDuplicates).toContainEqual({
        collection: 'atm_maintenances',
        index: 'ux_maintenance_per_mail_ticket',
        groups: 1,
      });
      const report = errors.mock.calls.find((call) =>
        JSON.stringify(call[0]).includes('atm_maintenances'),
      );
      expect(report?.[0]).toEqual({
        collection: 'atm_maintenances',
        index: 'ux_maintenance_per_mail_ticket',
        groups: 1,
        rows: 2,
      });
      const logged = JSON.stringify(report);
      expect(logged).not.toContain('9901');
      expect(logged).not.toContain(String(ticket));
      for (const row of rows) expect(logged).not.toContain(String(row._id));
    } finally {
      // Resolved → the next boot builds it.
      await collection.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
    }
    const rebuilt = await migrateAtmIndexes();
    expect(rebuilt.built).toBeGreaterThanOrEqual(1);
    const indexes = await collection.listIndexes().toArray();
    expect(indexes.map((index) => index.name)).toContain('ux_maintenance_per_mail_ticket');
  });
});

describe('the legacy importer writes every row — open duplicates included', () => {
  const noOpenDuplicate = { openDuplicate: 0, openDuplicateIds: [], openIndexMissing: false };

  it('writes every historical replenishment and maintenance — two open on one day included — and imports everything else', async () => {
    const legacyDb = `ecms-atm-legacy-${String(Date.now())}`;
    const legacy = mongoose.connection.getClient().db(legacyDb);
    const machineId = new Types.ObjectId();
    await legacy.collection('atm').insertOne({
      _id: machineId,
      mach_id: '07301',
      name: 'SYN 7301',
      bank: 'SYN BANK',
      area: 'SYN AREA',
      zone: '',
      status: 1,
      deleted: 0,
    });
    const op = (over: Record<string, unknown>) => ({
      _id: new Types.ObjectId(),
      mach_id: '7301',
      bank: 'SYN BANK',
      name: 'SYN 7301',
      area: 'SYN AREA',
      zone: '',
      open_time: new Date('2026-09-01T08:00:00.000Z'),
      deleted: 0,
      ...over,
    });
    // Replenishments: two open on one Cairo day, one closed, one open on another day — all land.
    const openA = op({});
    const openB = op({ open_time: new Date('2026-09-01T12:00:00.000Z') });
    const closedC = op({ close_time: new Date('2026-09-01T10:00:00.000Z') });
    const openD = op({ open_time: new Date('2026-09-02T08:00:00.000Z') });
    await legacy.collection('atm_rep_log').insertMany([openA, openB, closedC, openD]);
    // Maintenances: the same machine twice on one Cairo day, and once on another — all land.
    const maintA = op({});
    const maintB = op({ open_time: new Date('2026-09-01T12:00:00.000Z') });
    const maintD = op({ open_time: new Date('2026-09-02T08:00:00.000Z') });
    await legacy.collection('atm_maint_log').insertMany([maintA, maintB, maintD]);

    const options = {
      legacyUri: uriFor(legacyDb),
      branchId: portSaidBranchId,
      replenishmentTime: 'utc' as const,
      maintenanceTime: 'utc' as const,
    };
    const replenishments = { read: 4, written: 4, ...noOpenDuplicate };
    const maintenances = { read: 3, written: 3, ...noOpenDuplicate };

    const dry = await importLegacyAtmDeployment({ ...options, dryRun: true });
    expect(dry.replenishments).toMatchObject(replenishments);
    expect(dry.maintenances).toMatchObject(maintenances);
    expect(await openRows('maint', '7301')).toBe(0);

    for (let run = 0; run < 2; run += 1) {
      // Idempotent: the second run replaces the same rows.
      const report = await importLegacyAtmDeployment({ ...options, dryRun: false });
      expect(report.replenishments, `run ${String(run + 1)}`).toMatchObject(replenishments);
      expect(report.maintenances, `run ${String(run + 1)}`).toMatchObject(maintenances);
    }
    const imported = await AtmReplenishmentModel.find({ machineCode: '7301' }).lean().exec();
    expect(imported.map((row) => String(row._id)).sort()).toEqual(
      [String(openA._id), String(openB._id), String(closedC._id), String(openD._id)].sort(),
    );
    expect(await openRows('rep', '7301')).toBe(3);
    const importedMaints = await AtmMaintenanceModel.find({ machineCode: '7301' }).lean().exec();
    expect(importedMaints.map((row) => String(row._id)).sort()).toEqual(
      [String(maintA._id), String(maintB._id), String(maintD._id)].sort(),
    );
    // No ticket on an imported row: outside the per-ticket index.
    expect(importedMaints.every((row) => row.mailTicketId === null)).toBe(true);
    expect(await openRows('maint', '7301')).toBe(3);
  });

  it('a dry run predicts the real run, and neither warns about an index', async () => {
    const legacyDb = `ecms-atm-legacy-twice-${String(Date.now())}`;
    const legacy = mongoose.connection.getClient().db(legacyDb);
    await legacy.collection('atm').insertOne({
      _id: new Types.ObjectId(),
      mach_id: '7302',
      name: 'SYN 7302',
      bank: 'SYN BANK',
      area: 'SYN AREA',
      zone: '',
      status: 1,
      deleted: 0,
    });
    const op = (openTime: string) => ({
      _id: new Types.ObjectId(),
      mach_id: '7302',
      bank: 'SYN BANK',
      name: 'SYN 7302',
      area: 'SYN AREA',
      zone: '',
      open_time: new Date(openTime),
      deleted: 0,
    });
    const openA = op('2026-09-01T08:00:00.000Z');
    const openB = op('2026-09-01T12:00:00.000Z');
    await legacy.collection('atm_maint_log').insertMany([openA, openB]);
    const options = {
      legacyUri: uriFor(legacyDb),
      branchId: portSaidBranchId,
      replenishmentTime: 'utc' as const,
      maintenanceTime: 'utc' as const,
    };
    const expected = { read: 2, written: 2, ...noOpenDuplicate };
    try {
      const warnings = vi.spyOn(logger, 'warn');
      const dry = await importLegacyAtmDeployment({ ...options, dryRun: true });
      expect(dry.maintenances).toMatchObject(expected);
      expect(await openRows('maint', '7302')).toBe(0);

      const real = await importLegacyAtmDeployment({ ...options, dryRun: false });
      expect(real.maintenances).toMatchObject(expected);
      expect(real.replenishments).toMatchObject(noOpenDuplicate);
      expect(await openRows('maint', '7302')).toBe(2);
      const importWarnings = warnings.mock.calls.filter((call) =>
        call.some((arg) => typeof arg === 'string' && arg.startsWith('atm import')),
      );
      expect(importWarnings).toEqual([]);
    } finally {
      await AtmMaintenanceModel.collection.deleteMany({ _id: { $in: [openA._id, openB._id] } });
    }
  });
});
