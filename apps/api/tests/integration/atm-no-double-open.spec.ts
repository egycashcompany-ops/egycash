// The owner's rule, end to end (2026-10-13, narrowed to the day 2026-10-27 — port doc OD-1):
//
//   «في ملحوظه مهمه جداً .. إن مينفعش أضيف ماكينة مرتين سواء فى عملية التغذية أو الصيانة»
//   «خلى الرفض دا يحصل فقط إذا كانت الماكينات مفتوحه في نفس اليوم ولم تُغلق ! مش يرفضها لو
//    مفتوحه أمبارح ومتقفلتش»
//
// A machine has at most ONE open replenishment and at most ONE open maintenance PER CAIRO DAY,
// company-wide, and the two are independent; one left open on an earlier day does not block. Proven here over real HTTP, real RBAC and a real mongod: every path that
// creates or re-opens an open operation refuses the second one on that day (the two batch opens,
// the two reopens, the mail accept, an edit moving the open time), a race past the service check lands on the unique index and is
// answered the same way — never a 500 — and a refusal never describes another branch. The boot
// index builder's report of pre-existing duplicates names the collection and counts only, and the
// legacy importer reports the historical duplicates the index refuses instead of crashing.
//
// Every code below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  ErrorCodes,
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
import { atmReplenishmentRepository } from '../../src/modules/atm/replenishments/replenishment.repository';
import { atmMaintenanceRepository } from '../../src/modules/atm/maintenances/maintenance.repository';
import { atmMailTicketRepository } from '../../src/modules/atm/mail-tickets/mail-ticket.repository';
import { atmMailIngestionService } from '../../src/modules/atm/mail-tickets/mail-ingestion.service';
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
  await addMachines(tantaToken, [{ machineCode: '8001', name: 'SYN 8001 Tanta' }]);
}, 240_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('the race-proof index exists after boot', () => {
  it.each([
    ['atm_replenishments', 'ux_open_replenishment_per_code_day'],
    ['atm_maintenances', 'ux_open_maintenance_per_code_day'],
  ])(
    '%s carries %s — unique on the code AND day over open, live rows',
    async (collection, name) => {
      const indexes = await mongoose.connection.db?.collection(collection).listIndexes().toArray();
      const index = indexes?.find((entry) => entry.name === name);
      expect(index, `${name} on ${collection}`).toBeDefined();
      expect(index?.key).toEqual({ machineCode: 1, openDay: 1 });
      expect(index?.unique).toBe(true);
      expect(index?.partialFilterExpression).toEqual({
        closedAt: null,
        isDeleted: false,
        machineCode: { $gt: '' },
        openDay: { $gt: '' },
      });
    },
  );

  it.each(['atm_replenishments', 'atm_maintenances'])(
    '%s carries the index the rule’s day question runs on — not a scan of the log',
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

  it('drops the any-day index of the rule’s first form, and nothing else', async () => {
    const collection = AtmMaintenanceModel.collection;
    // A database that ran the first form carries it.
    await collection.createIndex(
      { machineCode: 1 },
      {
        name: 'ux_open_maintenance_per_code',
        unique: true,
        partialFilterExpression: { closedAt: null, isDeleted: false, machineCode: { $gt: '' } },
      },
    );
    const result = await migrateAtmIndexes();
    expect(result.dropped).toEqual([
      { collection: 'atm_maintenances', index: 'ux_open_maintenance_per_code' },
    ]);
    const names = (await collection.listIndexes().toArray()).map((index) => index.name);
    expect(names).not.toContain('ux_open_maintenance_per_code');
    expect(names).toContain('ux_open_maintenance_per_code_day');
    // Idempotent: nothing left to drop.
    expect((await migrateAtmIndexes()).dropped).toEqual([]);
  });
});

describe('replenishment — one open per machine', () => {
  it('refuses a second open of the same machine and reports it, opening nothing', async () => {
    const first = await openReps(alexToken, ['5001']);
    expect(first.status).toBe(200);
    expect(repResult(first).opened.map((r) => r.machineCode)).toEqual(['5001']);
    expect(repResult(first).alreadyOpenCodes).toEqual([]);

    const second = await openReps(alexToken, ['5001']);
    expect(second.status).toBe(200);
    expect(repResult(second).opened).toEqual([]);
    expect(repResult(second).alreadyOpenCodes).toEqual(['5001']);
    expect(repResult(second).unknownCodes).toEqual([]);
    expect(await openRows('rep', '5001')).toBe(1);
  });

  it('opens a code repeated in ONE batch once, reports the repeats, and still opens the rest', async () => {
    const res = await openReps(alexToken, ['5002', '5002', '9999', '5005', '5002', '5001']);
    expect(res.status).toBe(200);
    const body = repResult(res);
    expect(body.opened.map((r) => r.machineCode)).toEqual(['5002', '5005']);
    // One entry per refused line: two repeats of 5002, and 5001 still open from the test above.
    expect(body.alreadyOpenCodes).toEqual(['5002', '5002', '5001']);
    expect(body.unknownCodes).toEqual(['9999']);
    expect(await openRows('rep', '5002')).toBe(1);
    expect(await openRows('rep', '5005')).toBe(1);
  });

  it('allows a new open once the earlier one is closed', async () => {
    const open = repResult(await openReps(alexToken, ['5003'])).opened[0] as AtmReplenishmentDto;
    const close = await post(alexToken, '/atm/replenishments/close', { ids: [open.id] });
    expect(close.status).toBe(200);

    const again = await openReps(alexToken, ['5003']);
    expect(repResult(again).opened.map((r) => r.machineCode)).toEqual(['5003']);
    expect(repResult(again).alreadyOpenCodes).toEqual([]);
  });

  it('refuses a REOPEN while another replenishment of the machine is open (409), allows it after', async () => {
    // 5003 now has one closed row (the first) and one open row (from the test above).
    const closed = await AtmReplenishmentModel.findOne({
      machineCode: '5003',
      closedAt: { $ne: null },
    })
      .lean()
      .exec();
    const open = await AtmReplenishmentModel.findOne({ machineCode: '5003', closedAt: null })
      .lean()
      .exec();
    expect(closed).not.toBeNull();

    const refused = await post(alexToken, `/atm/replenishments/${String(closed?._id)}/reopen`, {
      version: closed?.__v,
    });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
    );
    expect(await openRows('rep', '5003')).toBe(1);

    expect(
      (await post(alexToken, '/atm/replenishments/close', { ids: [String(open?._id)] })).status,
    ).toBe(200);
    const reopened = await post(alexToken, `/atm/replenishments/${String(closed?._id)}/reopen`, {
      version: closed?.__v,
    });
    expect(reopened.status).toBe(200);
    expect(data<AtmReplenishmentDto>(reopened).closedAt).toBeNull();
  });
});

describe('maintenance — one open per machine, independent of replenishment', () => {
  it('opens a maintenance on a machine whose replenishment is open — the kinds are independent', async () => {
    expect(await openRows('rep', '5001')).toBe(1);
    const res = await openMaints(alexToken, ['5001']);
    expect(res.status).toBe(200);
    expect(maintResult(res).opened.map((m) => m.machineCode)).toEqual(['5001']);
    expect(maintResult(res).alreadyOpenCodes).toEqual([]);
  });

  it('refuses a second open maintenance, and a code repeated in the batch', async () => {
    const res = await openMaints(alexToken, ['5001', '5006', '5006']);
    expect(res.status).toBe(200);
    expect(maintResult(res).opened.map((m) => m.machineCode)).toEqual(['5006']);
    expect(maintResult(res).alreadyOpenCodes).toEqual(['5001', '5006']);
    expect(await openRows('maint', '5001')).toBe(1);
    expect(await openRows('maint', '5006')).toBe(1);
  });

  it('refuses a REOPEN while another maintenance of the machine is open, and allows a new open after a close', async () => {
    const first = maintResult(await openMaints(alexToken, ['5004'])).opened[0] as AtmMaintenanceDto;
    await closeMaintenanceDirectly(first.id);
    const second = await openMaints(alexToken, ['5004']);
    expect(maintResult(second).opened.map((m) => m.machineCode)).toEqual(['5004']);

    const refused = await post(alexToken, `/atm/maintenances/${first.id}/reopen`, {
      version: first.version,
    });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
    );
    expect(await openRows('maint', '5004')).toBe(1);
  });
});

describe('mail accept — a machine already in maintenance is not accepted', () => {
  it('flags an open maintenance of the TICKET’S day only, refuses the ticket, and leaves it pending', async () => {
    const ticketId = await ingestMail('6001');
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      false,
    );

    // Opened two days ago and never closed — an earlier day: no duplicate, nothing blocked.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const stale = maintResult(await openMaints(alexToken, ['6001'], twoDaysAgo));
    expect(stale.opened).toHaveLength(1);
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      false,
    );

    // Opened on the ticket's own day — that is the duplicate accept refuses.
    const opened = maintResult(await openMaints(alexToken, ['6001']));
    expect(opened.opened).toHaveLength(1);
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      true,
    );

    const accept = await post(alexToken, '/atm/mail-tickets/accept', { ids: [ticketId] });
    expect(accept.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(accept)).toEqual([]);
    expect((accept.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([
      { ticketId, machineCode: '6001', reason: 'maintenanceAlreadyOpen' },
    ]);
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.status).toBe(
      'pending',
    );
    expect(await openRows('maint', '6001')).toBe(2);

    // The ingest-time flag asks the same question now.
    const later = await ingestMail('6001');
    expect((await AtmMailTicketModel.findById(later).lean().exec())?.duplicationAtIngest).toBe(
      true,
    );

    // Once today's maintenance is closed, the same ticket is accepted — the stale one, still
    // open two days back, does not stand in the way.
    await closeMaintenanceDirectly(String(opened.opened[0]?.id));
    expect((await pendingTickets(alexToken)).find((t) => t.id === ticketId)?.duplication).toBe(
      false,
    );
    const retry = await post(alexToken, '/atm/mail-tickets/accept', { ids: [ticketId] });
    expect(retry.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(retry).map((t) => t.id)).toEqual([ticketId]);
    expect((retry.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([]);
    await closeMaintenanceDirectly(String(stale.opened[0]?.id));
  });

  it('accepts the first of two tickets for one machine in a selection and refuses the second', async () => {
    const a = await ingestMail('6002');
    const b = await ingestMail('6002');
    const res = await post(alexToken, '/atm/mail-tickets/accept', { ids: [a, b] });
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res).map((t) => t.id)).toEqual([a]);
    expect((res.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([
      { ticketId: b, machineCode: '6002', reason: 'maintenanceAlreadyOpen' },
    ]);
    expect(await openRows('maint', '6002')).toBe(1);
    const pending = await pendingTickets(alexToken);
    expect(pending.find((t) => t.id === b)).toMatchObject({ status: 'pending', duplication: true });
  });
});

describe('mail accept — a concurrent accept of the SAME ticket is not reported as refused', () => {
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
    // maintenance opened from this very ticket — which is an accept, not a refusal.
    vi.spyOn(atmMailTicketRepository, 'findById').mockResolvedValueOnce(pendingSnapshot);
    const loser = await accept(ticketId);
    expect(loser.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(loser)).toEqual([]);
    expect(refusedOf(loser)).toEqual([]);
    expect((await AtmMailTicketModel.findById(ticketId).lean().exec())?.status).toBe('accepted');
    expect(await openRows('maint', '6004')).toBe(1);
  });

  it('a stale read of a ticket decided since is skipped, even when ANOTHER maintenance refused it', async () => {
    const ticketId = await ingestMail('6005');
    const pendingSnapshot = await atmMailTicketRepository.findById(ticketId);
    const winner = await accept(ticketId);
    const fromTicket = await AtmMaintenanceModel.findOne({ machineCode: '6005', closedAt: null })
      .lean()
      .exec();
    expect(data<AtmMailTicketDto[]>(winner)).toHaveLength(1);
    await closeMaintenanceDirectly(String(fromTicket?._id));
    expect(maintResult(await openMaints(alexToken, ['6005'])).opened).toHaveLength(1);

    vi.spyOn(atmMailTicketRepository, 'findById').mockResolvedValueOnce(pendingSnapshot);
    const loser = await accept(ticketId);
    expect(loser.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(loser)).toEqual([]);
    expect(refusedOf(loser)).toEqual([]);
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
  });

  it('three concurrent accepts of one ticket: one accepts it, none reports it refused', async () => {
    const ticketId = await ingestMail('6006');
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
  });
});

describe('an empty machine code identifies no machine — it never blocks', () => {
  it('a reopen of an empty-code row is not refused by another empty-code open row', async () => {
    const raw = (closedAt: Date | null) => ({
      _id: new Types.ObjectId(),
      branchId: new Types.ObjectId(alexBranchId),
      machineId: new Types.ObjectId(),
      machineCode: '',
      bankName: 'SYN BANK',
      machineName: 'SYN legacy blank',
      zone: '',
      area: 'SYN AREA',
      openedAt: new Date(),
      closedAt,
      scheduleTime: null,
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
    });
    const open = raw(null);
    const closed = raw(new Date());
    await AtmReplenishmentModel.collection.insertMany([open, closed]);
    try {
      expect(
        await atmReplenishmentRepository.hasOpenOperation('', cairoDateString(new Date())),
      ).toBe(false);
      const res = await post(alexToken, `/atm/replenishments/${String(closed._id)}/reopen`, {
        version: 0,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(data<AtmReplenishmentDto>(res).closedAt).toBeNull();
    } finally {
      await AtmReplenishmentModel.collection.deleteMany({ _id: { $in: [open._id, closed._id] } });
    }
  });
});

describe('company-wide, without describing the other branch', () => {
  it('refuses Tanta a machine code that is open in Alex — and the answer names only the code', async () => {
    // Tanta opens and closes 8001 first, so it holds a closed row to try reopening later.
    const tantaRow = repResult(await openReps(tantaToken, ['8001']))
      .opened[0] as AtmReplenishmentDto;
    const closed = await post(tantaToken, '/atm/replenishments/close', { ids: [tantaRow.id] });
    const tantaClosed = data<AtmReplenishmentDto[]>(closed)[0] as AtmReplenishmentDto;

    const alexOpen = repResult(await openReps(alexToken, ['8001']))
      .opened[0] as AtmReplenishmentDto;
    expect(alexOpen.branchId).toBe(alexBranchId);

    const res = await openReps(tantaToken, ['8001']);
    expect(res.status).toBe(200);
    expect(repResult(res)).toEqual({ opened: [], unknownCodes: [], alreadyOpenCodes: ['8001'] });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(alexBranchId);
    expect(text).not.toContain(alexOpen.id);
    expect(text).not.toContain('Alex');

    const reopen = await post(tantaToken, `/atm/replenishments/${tantaClosed.id}/reopen`, {
      version: tantaClosed.version,
    });
    expect(reopen.status).toBe(409);
    expect((reopen.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
    );
    const refusal = JSON.stringify(reopen.body);
    expect(refusal).not.toContain(alexBranchId);
    expect(refusal).not.toContain(alexOpen.id);
    expect(refusal).not.toContain('Alex');

    // Tanta still cannot see Alex's row, and its maintenance — the other kind — is free.
    const list = await get(tantaToken, '/atm/replenishments?pageSize=100');
    expect(data<AtmReplenishmentDto[]>(list).map((r) => r.id)).not.toContain(alexOpen.id);
    expect(maintResult(await openMaints(tantaToken, ['8001'])).opened).toHaveLength(1);
  });
});

describe('per day — an operation left open on an earlier day does not block', () => {
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
  const refusedCode = (res: request.Response): string =>
    (res.body as { error: { code: string } }).error.code;

  beforeAll(async () => {
    await addMachines(alexToken, [
      { machineCode: '5101', name: 'SYN 5101' },
      { machineCode: '5102', name: 'SYN 5102' },
      { machineCode: '5103', name: 'SYN 5103' },
      { machineCode: '5104', name: 'SYN 5104' },
      { machineCode: '5105', name: 'SYN 5105' },
      { machineCode: '5106', name: 'SYN 5106' },
      { machineCode: '5107', name: 'SYN 5107' },
      { machineCode: '5108', name: 'SYN 5108' },
      { machineCode: '5109', name: 'SYN 5109' },
    ]);
  });

  it('opens today a machine left open YESTERDAY and never closed — and still refuses a second today', async () => {
    const yesterday = repResult(await openRepsOn(['5101'], dayAt(-1)));
    expect(yesterday.opened.map((r) => r.machineCode)).toEqual(['5101']);

    const today = await openReps(alexToken, ['5101']);
    expect(repResult(today).opened.map((r) => r.machineCode)).toEqual(['5101']);
    expect(repResult(today).alreadyOpenCodes).toEqual([]);
    expect(await openRows('rep', '5101')).toBe(2);

    const again = await openReps(alexToken, ['5101']);
    expect(repResult(again).opened).toEqual([]);
    expect(repResult(again).alreadyOpenCodes).toEqual(['5101']);
  });

  it('a row stored before `openDay` existed still blocks its own day — the check reads the open time', async () => {
    const legacy = {
      _id: new Types.ObjectId(),
      branchId: new Types.ObjectId(alexBranchId),
      machineId: new Types.ObjectId(),
      machineCode: '5102',
      bankName: 'SYN BANK',
      machineName: 'SYN 5102 before the field',
      zone: '',
      area: 'SYN AREA',
      openedAt: new Date(),
      closedAt: null,
      isDeleted: false,
      schemaVersion: 1,
    };
    await AtmReplenishmentModel.collection.insertOne(legacy);
    try {
      expect(repResult(await openReps(alexToken, ['5102'])).alreadyOpenCodes).toEqual(['5102']);
      // …and only its own day: tomorrow opens.
      expect(repResult(await openRepsOn(['5102'], dayAt(1))).opened).toHaveLength(1);
    } finally {
      await AtmReplenishmentModel.collection.deleteOne({ _id: legacy._id });
    }
  });

  it('schedules ahead: tomorrow opens beside today’s, and a second one for tomorrow is refused', async () => {
    expect(repResult(await openReps(alexToken, ['5103'])).opened).toHaveLength(1);
    const tomorrow = repResult(await openRepsOn(['5103'], dayAt(1)));
    expect(tomorrow.opened).toHaveLength(1);
    expect(cairoDateString(new Date(tomorrow.opened[0]?.openedAt as string))).toBe(dayAt(1));
    expect(repResult(await openRepsOn(['5103'], dayAt(1))).alreadyOpenCodes).toEqual(['5103']);
  });

  it('maintenance: the same rule, its own kind', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString();
    expect(maintResult(await openMaints(alexToken, ['5104'], twoDaysAgo)).opened).toHaveLength(1);
    expect(maintResult(await openMaints(alexToken, ['5104'])).opened).toHaveLength(1);
    expect(maintResult(await openMaints(alexToken, ['5104'])).alreadyOpenCodes).toEqual(['5104']);
    expect(await openRows('maint', '5104')).toBe(2);
  });

  it('a reopen is refused only by an open row of the reopened row’s OWN day', async () => {
    const y = repResult(await openRepsOn(['5105'], dayAt(-1))).opened[0] as AtmReplenishmentDto;
    const a = repResult(await openReps(alexToken, ['5105'])).opened[0] as AtmReplenishmentDto;
    expect((await post(alexToken, '/atm/replenishments/close', { ids: [y.id, a.id] })).status).toBe(
      200,
    );
    const b = repResult(await openReps(alexToken, ['5105'])).opened[0] as AtmReplenishmentDto;
    expect(b).toBeDefined();

    const closedY = await AtmReplenishmentModel.findById(y.id).lean().exec();
    const reopenY = await post(alexToken, `/atm/replenishments/${y.id}/reopen`, {
      version: closedY?.__v,
    });
    expect(reopenY.status, 'yesterday’s row: today’s open row is another day').toBe(200);
    expect((await AtmReplenishmentModel.findById(y.id).lean().exec())?.openDay).toBe(dayAt(-1));

    const closedA = await AtmReplenishmentModel.findById(a.id).lean().exec();
    const reopenA = await post(alexToken, `/atm/replenishments/${a.id}/reopen`, {
      version: closedA?.__v,
    });
    expect(reopenA.status, 'today’s row: today is taken').toBe(409);
    expect(refusedCode(reopenA)).toBe(ErrorCodes.ATM_OPERATION_ALREADY_OPEN);
    expect(await openRows('rep', '5105')).toBe(2);
  });

  it('an edit MOVING an open row onto a day its machine is already open is refused, nothing written', async () => {
    const today = repResult(await openReps(alexToken, ['5106'])).opened[0] as AtmReplenishmentDto;
    const ahead = repResult(await openRepsOn(['5106'], dayAt(1))).opened[0] as AtmReplenishmentDto;

    const single = await patch(`/atm/replenishments/${ahead.id}`, {
      openedAt: cairoWallClockUtc(dayAt(0), 11).toISOString(),
      version: ahead.version,
    });
    expect(single.status).toBe(409);
    expect(refusedCode(single)).toBe(ErrorCodes.ATM_OPERATION_ALREADY_OPEN);
    const unmoved = await AtmReplenishmentModel.findById(ahead.id).lean().exec();
    expect(unmoved?.openedAt.toISOString()).toBe(ahead.openedAt);

    // The bulk edit sets ONE instant on every checked row: two rows of one machine cannot share it.
    const both = await patch('/atm/replenishments/bulk', {
      ids: [today.id, ahead.id],
      openedAt: cairoWallClockUtc(dayAt(2), 10).toISOString(),
    });
    expect(both.status).toBe(409);
    expect(refusedCode(both)).toBe(ErrorCodes.ATM_OPERATION_ALREADY_OPEN);
    expect(
      (await AtmReplenishmentModel.findById(today.id).lean().exec())?.openedAt.toISOString(),
    ).toBe(today.openedAt);

    // Onto a free day it moves — and its stored day moves with it.
    const free = await patch('/atm/replenishments/bulk', {
      ids: [ahead.id],
      openedAt: cairoWallClockUtc(dayAt(2), 10).toISOString(),
    });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    expect((await AtmReplenishmentModel.findById(ahead.id).lean().exec())?.openDay).toBe(dayAt(2));
  });

  it('a bulk move the index refuses half-way writes NOTHING — one transaction, never a partial move', async () => {
    // A then B, so the move reaches A before the row B collides on.
    const a = repResult(await openRepsOn(['5108'], dayAt(-1))).opened[0] as AtmReplenishmentDto;
    const b = repResult(await openRepsOn(['5109'], dayAt(-1))).opened[0] as AtmReplenishmentDto;
    const holder = repResult(await openRepsOn(['5109'], dayAt(3))).opened[0] as AtmReplenishmentDto;
    expect(holder).toBeDefined();
    // As if a concurrent open landed between the rule's check and the write.
    vi.spyOn(atmReplenishmentRepository, 'codesBlockedOnDay').mockResolvedValue([]);
    const res = await patch('/atm/replenishments/bulk', {
      ids: [a.id, b.id],
      openedAt: cairoWallClockUtc(dayAt(3), 10).toISOString(),
    });
    expect(res.status).toBe(409);
    expect(refusedCode(res)).toBe(ErrorCodes.ATM_OPERATION_ALREADY_OPEN);
    const storedA = await AtmReplenishmentModel.findById(a.id).lean().exec();
    expect(storedA?.openedAt.toISOString(), 'A rolled back with B').toBe(a.openedAt);
    expect(storedA?.openDay).toBe(dayAt(-1));
    expect(storedA?.__v).toBe(a.version);
  });

  it('maintenance: an edit moving an open row onto a taken day is refused too', async () => {
    const today = maintResult(await openMaints(alexToken, ['5107'])).opened[0] as AtmMaintenanceDto;
    const earlier = maintResult(
      await openMaints(alexToken, ['5107'], new Date(Date.now() - 2 * DAY).toISOString()),
    ).opened[0] as AtmMaintenanceDto;
    const moved = await patch(`/atm/maintenances/${earlier.id}`, {
      openedAt: today.openedAt,
      version: earlier.version,
    });
    expect(moved.status).toBe(409);
    expect(refusedCode(moved)).toBe(ErrorCodes.ATM_OPERATION_ALREADY_OPEN);
    expect(await openRows('maint', '5107')).toBe(2);
  });
});

describe('a forced race lands on the index — exactly one opened, never a 500', () => {
  it('two concurrent replenishment opens of one code, both past the service check', async () => {
    vi.spyOn(atmReplenishmentRepository, 'openMachineCodes').mockResolvedValue(new Set());
    const [a, b] = await Promise.all([
      openReps(alexToken, ['7101']),
      openReps(alexToken, ['7101']),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const results = [repResult(a), repResult(b)];
    expect(results.flatMap((r) => r.opened)).toHaveLength(1);
    expect(results.flatMap((r) => r.alreadyOpenCodes)).toEqual(['7101']);
    expect(await openRows('rep', '7101')).toBe(1);
  });

  it('two concurrent maintenance opens of one code, both past the service check', async () => {
    vi.spyOn(atmMaintenanceRepository, 'openMachineCodes').mockResolvedValue(new Set());
    const [a, b] = await Promise.all([
      openMaints(alexToken, ['7101']),
      openMaints(alexToken, ['7101']),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const results = [maintResult(a), maintResult(b)];
    expect(results.flatMap((r) => r.opened)).toHaveLength(1);
    expect(results.flatMap((r) => r.alreadyOpenCodes)).toEqual(['7101']);
    expect(await openRows('maint', '7101')).toBe(1);
  });

  it('two concurrent opens WITHOUT forcing — the same single row, whichever guard answers', async () => {
    const [a, b] = await Promise.all([
      openReps(alexToken, ['7103']),
      openReps(alexToken, ['7103']),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([repResult(a), repResult(b)].flatMap((r) => r.opened)).toHaveLength(1);
    expect(await openRows('rep', '7103')).toBe(1);
  });

  it('two concurrent REOPENS of two closed rows of one machine: one 200, one 409', async () => {
    const ids: { id: string; version: number }[] = [];
    for (let i = 0; i < 2; i += 1) {
      const row = repResult(await openReps(alexToken, ['7102'])).opened[0] as AtmReplenishmentDto;
      const closed = await post(alexToken, '/atm/replenishments/close', { ids: [row.id] });
      const after = data<AtmReplenishmentDto[]>(closed)[0] as AtmReplenishmentDto;
      ids.push({ id: after.id, version: after.version });
    }
    vi.spyOn(atmReplenishmentRepository, 'hasOpenOperation').mockResolvedValue(false);
    const responses = await Promise.all(
      ids.map(({ id, version }) =>
        post(alexToken, `/atm/replenishments/${id}/reopen`, { version }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const refused = responses.find((r) => r.status === 409);
    expect((refused?.body as { error: { code: string } }).error.code).toBe(
      ErrorCodes.ATM_OPERATION_ALREADY_OPEN,
    );
    expect(await openRows('rep', '7102')).toBe(1);
  });

  it('a mail accept that loses the race leaves the ticket pending and reports it', async () => {
    expect(maintResult(await openMaints(alexToken, ['6003'])).opened).toHaveLength(1);
    const ticketId = await ingestMail('6003');
    vi.spyOn(atmMaintenanceRepository, 'hasOpenOperation').mockResolvedValue(false);
    const res = await post(alexToken, '/atm/mail-tickets/accept', { ids: [ticketId] });
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res)).toEqual([]);
    expect((res.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([
      { ticketId, machineCode: '6003', reason: 'maintenanceAlreadyOpen' },
    ]);
    expect((await AtmMailTicketModel.findById(ticketId).lean().exec())?.status).toBe('pending');
    expect(await openRows('maint', '6003')).toBe(1);
  });
});

describe('existing duplicates: the boot reports the collection, the service check still holds', () => {
  it('skips the index over duplicate open rows, logs no row data, and refuses new opens', async () => {
    const collection = AtmReplenishmentModel.collection;
    await collection.dropIndex('ux_open_replenishment_per_code_day');
    const stale = (n: number) => ({
      _id: new Types.ObjectId(),
      branchId: new Types.ObjectId(alexBranchId),
      machineId: new Types.ObjectId(),
      machineCode: '9901',
      bankName: 'SYN BANK',
      machineName: `SYN 9901 stale ${String(n)}`,
      zone: '',
      area: 'SYN AREA',
      openedAt: new Date(),
      openDay: cairoDateString(new Date()),
      closedAt: null,
      isDeleted: false,
      schemaVersion: 1,
    });
    const rows = [stale(1), stale(2)];
    await collection.insertMany(rows);

    const errors = vi.spyOn(logger, 'error');
    const result = await migrateAtmIndexes();
    expect(result.skippedDuplicates).toContainEqual({
      collection: 'atm_replenishments',
      index: 'ux_open_replenishment_per_code_day',
      groups: 1,
    });
    const report = errors.mock.calls.find((call) =>
      JSON.stringify(call[0]).includes('atm_replenishments'),
    );
    expect(report).toBeDefined();
    expect(report?.[0]).toEqual({
      collection: 'atm_replenishments',
      index: 'ux_open_replenishment_per_code_day',
      groups: 1,
      rows: 2,
    });
    const logged = JSON.stringify(report);
    expect(logged).not.toContain('9901');
    for (const row of rows) expect(logged).not.toContain(String(row._id));

    // Without the index the service check is what holds.
    const refused = await openReps(alexToken, ['9901']);
    expect(repResult(refused).alreadyOpenCodes).toEqual(['9901']);

    // Resolved → the next boot builds it.
    await collection.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
    const rebuilt = await migrateAtmIndexes();
    expect(rebuilt.built).toBeGreaterThanOrEqual(1);
    const indexes = await collection.listIndexes().toArray();
    expect(indexes.map((index) => index.name)).toContain('ux_open_replenishment_per_code_day');
  });
});

describe('the legacy importer is exempt, and never crashes on the index', () => {
  it('reports the historical open duplicate the index refuses, and imports everything else', async () => {
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
    const openA = op({});
    // The same machine, the same Cairo day — the one the index refuses.
    const openB = op({ open_time: new Date('2026-09-01T12:00:00.000Z') });
    const closedC = op({ close_time: new Date('2026-09-01T10:00:00.000Z') });
    // The same machine left open on ANOTHER day — per day, it lands.
    const openD = op({ open_time: new Date('2026-09-02T08:00:00.000Z') });
    await legacy.collection('atm_rep_log').insertMany([openA, openB, closedC, openD]);
    // One open maintenance for the same machine — the other kind, not a duplicate.
    await legacy.collection('atm_maint_log').insertOne(op({}));

    const options = {
      legacyUri: uriFor(legacyDb),
      branchId: portSaidBranchId,
      replenishmentTime: 'utc' as const,
      maintenanceTime: 'utc' as const,
    };

    const dry = await importLegacyAtmDeployment({ ...options, dryRun: true });
    expect(dry.replenishments).toMatchObject({
      read: 4,
      written: 3,
      openDuplicate: 1,
      openDuplicateIds: [String(openB._id)],
      openIndexMissing: false,
    });

    for (let run = 0; run < 2; run += 1) {
      // Idempotent: the second run replaces the same rows and refuses the same one.
      const report = await importLegacyAtmDeployment({ ...options, dryRun: false });
      expect(report.replenishments, `run ${String(run + 1)}`).toMatchObject({
        read: 4,
        written: 3,
        openDuplicate: 1,
        openDuplicateIds: [String(openB._id)],
        openIndexMissing: false,
      });
      expect(report.maintenances).toMatchObject({
        read: 1,
        written: 1,
        openDuplicate: 0,
        openIndexMissing: false,
      });
    }
    const imported = await AtmReplenishmentModel.find({ machineCode: '7301' }).lean().exec();
    expect(imported.map((row) => String(row._id)).sort()).toEqual(
      [String(openA._id), String(closedC._id), String(openD._id)].sort(),
    );
    expect(await openRows('rep', '7301')).toBe(2);
    expect(await openRows('maint', '7301')).toBe(1);
  });

  it('says so when the index is ABSENT: nothing refused, the duplicates named as written, dry run = real run', async () => {
    const collection = AtmReplenishmentModel.collection;
    await collection.dropIndex('ux_open_replenishment_per_code_day');
    const legacyDb = `ecms-atm-legacy-noindex-${String(Date.now())}`;
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
    await legacy.collection('atm_rep_log').insertMany([openA, openB]);
    const options = {
      legacyUri: uriFor(legacyDb),
      branchId: portSaidBranchId,
      replenishmentTime: 'utc' as const,
      maintenanceTime: 'utc' as const,
    };
    const expected = {
      read: 2,
      written: 2,
      openDuplicate: 1,
      openDuplicateIds: [String(openB._id)],
      openIndexMissing: true,
    };
    try {
      const warnings = vi.spyOn(logger, 'warn');
      const dry = await importLegacyAtmDeployment({ ...options, dryRun: true });
      expect(dry.replenishments).toMatchObject(expected);
      expect(await openRows('rep', '7302')).toBe(0);

      const real = await importLegacyAtmDeployment({ ...options, dryRun: false });
      expect(real.replenishments).toMatchObject(expected);
      expect(await openRows('rep', '7302')).toBe(2);
      // The maintenance log still has its index: unaffected.
      expect(real.maintenances.openIndexMissing).toBe(false);

      const warning = warnings.mock.calls.find((call) =>
        JSON.stringify(call[0]).includes('ux_open_replenishment_per_code_day'),
      );
      expect(warning?.[0]).toEqual({
        collection: 'atm_replenishments',
        index: 'ux_open_replenishment_per_code_day',
        openDuplicate: 1,
      });
      const logged = JSON.stringify(warning);
      expect(logged).not.toContain('7302');
      expect(logged).not.toContain(String(openB._id));
    } finally {
      await collection.deleteMany({ _id: { $in: [openA._id, openB._id] } });
      await migrateAtmIndexes();
    }
    const indexes = await collection.listIndexes().toArray();
    expect(indexes.map((index) => index.name)).toContain('ux_open_replenishment_per_code_day');
  });
});
