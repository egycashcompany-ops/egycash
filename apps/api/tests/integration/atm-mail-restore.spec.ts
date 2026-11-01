// The mail log's «إسترجاع», end to end (2026-10-28): «هنا /atm/mail-tickets/log … إسترجاع ويقدر
// يرجعه مفتوح لو قبل أو رفض غلط».
//
// A decided ticket goes back to PENDING. A rejected one simply returns. An accepted one takes back
// the maintenance it opened — gone from /atm/maintenance, in the same transaction as the ticket's
// return — and is refused, with nothing written, once that maintenance is closed, or when no
// maintenance carries the ticket at all (a legacy accept). Proven here over real HTTP, real RBAC
// and a real mongod: both returns, the board, a second accept after the restore (the per-day rule
// does not count the removed maintenance), both refusals — the close also when it lands while the
// restore runs — the silent skips (already pending, outside the caller's scope, a concurrent
// restore that won), the 403, and the trail each write leaves.
//
// Every code below is synthetic.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type AtmMailAcceptMetaDto,
  type AtmMailRestoreMetaDto,
  type AtmMailTicketDto,
  type AtmMaintenanceDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmPermissions } from '../../src/modules/atm/atm.module';
import { rbacService } from '../../src/platform/rbac';
import { userService } from '../../src/platform/users';
import { settingsService } from '../../src/platform/settings';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { AtmMaintenanceModel } from '../../src/modules/atm/maintenances/maintenance.model';
import { atmMaintenanceRepository } from '../../src/modules/atm/maintenances/maintenance.repository';
import { AtmMailTicketModel } from '../../src/modules/atm/mail-tickets/mail-ticket.model';
import { atmMailTicketRepository } from '../../src/modules/atm/mail-tickets/mail-ticket.repository';
import { atmMailIngestionService } from '../../src/modules/atm/mail-tickets/mail-ingestion.service';
import { mailTicketFromLegacy } from '../../src/modules/atm/migration/legacy-transform';
import { cairoDateString } from '../../src/modules/atm/shared/cairo-time';

const PASSWORD = 'Str0ng#Pass!';
let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string;
let alexToken: string; // the operating bundle at BRANCH scope, placed in Alex — decides Alex's mail
let alexUserId: string;
let tantaToken: string; // the same bundle, placed in Tanta — Alex's mail is outside its scope
let viewerToken: string; // reads the pending list and the log, decides nothing
let alexBranch = ''; // Alex's branch id — where the legacy-shaped tickets below are written

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-mail-restore-${String(Date.now())}`;
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

const post = (token: string, path: string, body: object): request.Test =>
  request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body);
const get = (token: string, path: string): request.Test =>
  request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

const accept = (token: string, ids: string[]): request.Test =>
  post(token, '/atm/mail-tickets/accept', { ids });
const reject = (token: string, ids: string[]): request.Test =>
  post(token, '/atm/mail-tickets/reject', { ids });
const restore = (token: string, ids: string[]): request.Test =>
  post(token, '/atm/mail-tickets/restore', { ids });

const restoredIds = (res: request.Response): string[] =>
  data<AtmMailTicketDto[]>(res).map((ticket) => ticket.id);
const refusedOf = (res: request.Response): AtmMailRestoreMetaDto['refused'] =>
  (res.body as { meta: AtmMailRestoreMetaDto }).meta.refused;

const mailBody = (code: string): string =>
  `machine number: 1234_${code} ticket subject: X "Cash out" ticket number: 55`;

let mailSeq = 0;
const ingestMail = async (code: string): Promise<string> => {
  mailSeq += 1;
  const result = await atmMailIngestionService.ingest({
    providerMessageId: `mail-restore-${String(Date.now())}-${String(mailSeq)}`,
    receivedAt: new Date(),
    senderEmail: 'bank@example.test',
    subject: '',
    bodyText: mailBody(code),
  });
  expect(result.outcome).toBe('created');
  return result.ticketId as string;
};

/** A ticket accepted through the API, and the maintenance that accept opened from it. */
const acceptedTicket = async (
  code: string,
): Promise<{ ticketId: string; maintenanceId: string }> => {
  const ticketId = await ingestMail(code);
  const res = await accept(alexToken, [ticketId]);
  expect(res.status).toBe(200);
  expect((res.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([]);
  const opened = await AtmMaintenanceModel.findOne({
    mailTicketId: new Types.ObjectId(ticketId),
    isDeleted: false,
  })
    .lean()
    .exec();
  expect(opened?.closedAt).toBeNull();
  return { ticketId, maintenanceId: String(opened?._id) };
};

const ticketRow = async (id: string) => AtmMailTicketModel.findById(id).lean().exec();
const maintenanceRow = async (id: string) => AtmMaintenanceModel.findById(id).lean().exec();

/** The open maintenance board, as the operator reads it. */
const openBoard = async (): Promise<AtmMaintenanceDto[]> => {
  const res = await get(alexToken, '/atm/maintenances?pageSize=100');
  expect(res.status).toBe(200);
  return data<AtmMaintenanceDto[]>(res);
};

const pendingIds = async (): Promise<string[]> => {
  const res = await get(alexToken, '/atm/mail-tickets?pageSize=100');
  expect(res.status).toBe(200);
  return data<AtmMailTicketDto[]>(res).map((ticket) => ticket.id);
};

const auditRows = async (entityType: string, entityId: string, action: string) =>
  AuditLogModel.find({
    'entityRef.moduleId': 'atm',
    'entityRef.entityType': entityType,
    'entityRef.entityId': entityId,
    action,
  })
    .lean()
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

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminUserId = await mkUser('atm-restore-admin@ecms.local');
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
  adminToken = await login('atm-restore-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await post(adminToken, '/platform/branches', { code, name: { ar, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  const alexBranchId = await mkBranch('90', 'الإسكندرية', 'Alexandria');
  alexBranch = alexBranchId;
  const tantaBranchId = await mkBranch('91', 'طنطا', 'Tanta');

  const operatorRole = await rbacService.createRole(
    {
      name: { en: 'ATM operator', ar: 'مشغل صراف آلي' },
      permissionKeys: [
        'atmMaintenance.view',
        'atmMaintenance.create',
        'atmMaintenance.edit',
        'atmMaintenance.complete',
        'atmMailTicket.view',
        'atmMailTicket.decide',
        'atmMailTicket.viewLog',
        'atmMachine.view',
        'atmMachine.manage',
      ],
    },
    adminUserId,
  );
  alexUserId = await mkUser('atm-restore-alex@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(alexUserId, String(operatorRole._id), 'branch');
  alexToken = await login('atm-restore-alex@ecms.local');
  const tantaId = await mkUser('atm-restore-tanta@ecms.local', tantaBranchId);
  await rbacService.ensureAssignment(tantaId, String(operatorRole._id), 'branch');
  tantaToken = await login('atm-restore-tanta@ecms.local');

  // Sees both mail pages, decides nothing — the log is readable without the grant that restores.
  const viewerRole = await rbacService.createRole(
    {
      name: { en: 'ATM mail viewer', ar: 'مطلع على الرسائل' },
      permissionKeys: ['atmMailTicket.view', 'atmMailTicket.viewLog'],
    },
    adminUserId,
  );
  const viewerId = await mkUser('atm-restore-viewer@ecms.local', alexBranchId);
  await rbacService.ensureAssignment(viewerId, String(viewerRole._id), 'branch');
  viewerToken = await login('atm-restore-viewer@ecms.local');

  // Alex's master: the operator is placed in Alex, so this is where the machines — and therefore
  // their mail — land.
  const machines = await post(alexToken, '/atm/machines/bulk', {
    bankName: 'SYN BANK',
    area: 'SYN AREA',
    // One code per scenario, so no scenario's maintenance stands in another's way.
    machines: Array.from({ length: 16 }, (_, index) => String(7001 + index)).map((machineCode) => ({
      machineCode,
      name: `SYN ${machineCode}`,
    })),
  });
  expect(machines.status, JSON.stringify(machines.body)).toBe(200);
}, 240_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('mail restore — a decided ticket back to pending', () => {
  it('a rejected ticket returns to pending, the decider and the time cleared', async () => {
    const ticketId = await ingestMail('7001');
    expect((await reject(alexToken, [ticketId])).status).toBe(200);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'rejected' });

    const res = await restore(alexToken, [ticketId]);
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res)).toEqual([
      expect.objectContaining({
        id: ticketId,
        status: 'pending',
        actionByName: null,
        actionAt: null,
      }),
    ]);
    expect(refusedOf(res)).toEqual([]);
    expect(await ticketRow(ticketId)).toMatchObject({
      status: 'pending',
      actionById: null,
      actionByName: null,
      actionAt: null,
    });
    expect(await pendingIds()).toContain(ticketId);

    const trail = await auditRows('mailTicket', ticketId, 'restore');
    expect(trail).toHaveLength(1);
    expect(trail[0]?.changes).toEqual([{ field: 'status', old: 'rejected', new: 'pending' }]);
    expect(String(trail[0]?.actor.userId)).toBe(alexUserId);
  });

  it('an accepted ticket returns to pending, and the maintenance it opened leaves the board', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7002');
    expect((await openBoard()).map((row) => row.id)).toContain(maintenanceId);

    const res = await restore(alexToken, [ticketId]);
    expect(res.status).toBe(200);
    expect(restoredIds(res)).toEqual([ticketId]);
    expect(refusedOf(res)).toEqual([]);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'pending', actionByName: null });
    expect(await pendingIds()).toContain(ticketId);

    expect((await openBoard()).map((row) => row.id)).not.toContain(maintenanceId);
    const removed = await maintenanceRow(maintenanceId);
    expect(removed?.isDeleted).toBe(true);
    expect(String(removed?.deletedBy)).toBe(alexUserId);

    // The trail: the ticket's restore names the maintenance it no longer has, and the maintenance
    // carries the board's own delete row — by the caller.
    const restoreTrail = await auditRows('mailTicket', ticketId, 'restore');
    expect(restoreTrail).toHaveLength(1);
    expect(restoreTrail[0]?.changes).toEqual([
      { field: 'status', old: 'accepted', new: 'pending' },
      { field: 'maintenanceId', old: maintenanceId, new: null },
    ]);
    const deleteTrail = await auditRows('maintenance', maintenanceId, 'delete');
    expect(deleteTrail).toHaveLength(1);
    expect(deleteTrail[0]?.changes).toEqual([]);
    expect(String(deleteTrail[0]?.actor.userId)).toBe(alexUserId);
  });

  it('restored, the ticket is accepted again: a fresh maintenance opens — the removed one does not count', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7003');
    expect(restoredIds(await restore(alexToken, [ticketId]))).toEqual([ticketId]);

    // The same machine, the same day (the ticket's received day, D6) — the per-day rule (OD-1)
    // counts live maintenances only, and the restore removed the first.
    const again = await accept(alexToken, [ticketId]);
    expect(again.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(again).map((ticket) => ticket.id)).toEqual([ticketId]);
    expect((again.body as { meta: AtmMailAcceptMetaDto }).meta.refused).toEqual([]);

    const fromTicket = (await openBoard()).filter((row) => row.mailTicketId === ticketId);
    expect(fromTicket).toHaveLength(1);
    expect(fromTicket[0]?.id).not.toBe(maintenanceId);
    expect((await maintenanceRow(maintenanceId))?.isDeleted).toBe(true);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'accepted' });
  });

  it('an accepted ticket whose maintenance is CLOSED is refused, naming the machine — nothing written', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7004');
    await closeMaintenanceDirectly(maintenanceId);
    const before = await ticketRow(ticketId);
    const maintenanceBefore = await maintenanceRow(maintenanceId);
    expect(before).toMatchObject({ status: 'accepted' });
    expect(before?.actionByName).not.toBeNull();

    const res = await restore(alexToken, [ticketId]);
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res)).toEqual([]);
    expect(refusedOf(res)).toEqual([
      { ticketId, machineCode: '7004', reason: 'maintenanceClosed' },
    ]);

    const after = await ticketRow(ticketId);
    expect(after).toMatchObject({ status: 'accepted', actionByName: before?.actionByName });
    expect(after?.__v).toBe(before?.__v);
    const maintenanceAfter = await maintenanceRow(maintenanceId);
    expect(maintenanceAfter?.isDeleted).toBe(false);
    expect(maintenanceAfter?.closedAt).toEqual(maintenanceBefore?.closedAt);
    expect(maintenanceAfter?.__v).toBe(maintenanceBefore?.__v);
    expect(await auditRows('mailTicket', ticketId, 'restore')).toHaveLength(0);
    expect(await auditRows('maintenance', maintenanceId, 'delete')).toHaveLength(0);
  });

  it('a close landing WHILE the restore runs still wins: refused, the closed maintenance kept', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7015');
    // The close lands between the restore's read (still open) and its delete. The delete is then
    // a write conflict, the transaction runs again, and its second read finds the row closed.
    const read = atmMaintenanceRepository.findFromTicket.bind(atmMaintenanceRepository);
    const lookup = vi
      .spyOn(atmMaintenanceRepository, 'findFromTicket')
      .mockImplementationOnce(async (...args) => {
        const rows = await read(...args);
        await closeMaintenanceDirectly(maintenanceId);
        return rows;
      });

    const res = await restore(alexToken, [ticketId]);
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res)).toEqual([]);
    expect(refusedOf(res)).toEqual([
      { ticketId, machineCode: '7015', reason: 'maintenanceClosed' },
    ]);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'accepted' });
    const kept = await maintenanceRow(maintenanceId);
    expect(kept?.isDeleted).toBe(false);
    expect(kept?.closedAt).not.toBeNull();
    expect(await auditRows('mailTicket', ticketId, 'restore')).toHaveLength(0);
  });

  it('an accepted ticket whose maintenance was deleted on the board simply returns', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7005');
    expect(
      (await post(adminToken, '/atm/maintenances/delete', { ids: [maintenanceId] })).status,
    ).toBe(200);

    const res = await restore(alexToken, [ticketId]);
    expect(restoredIds(res)).toEqual([ticketId]);
    expect(refusedOf(res)).toEqual([]);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'pending' });
    expect((await auditRows('mailTicket', ticketId, 'restore'))[0]?.changes).toEqual([
      { field: 'status', old: 'accepted', new: 'pending' },
    ]);
  });

  it('an accepted ticket NO maintenance carries — a legacy accept — is refused, nothing written', async () => {
    // The legacy import writes decided tickets and maintenances side by side, linking none to
    // the other: the ticket says accepted, and no maintenance carries its id.
    const ticketId = await ingestMail('7016');
    await AtmMailTicketModel.updateOne(
      { _id: new Types.ObjectId(ticketId) },
      { $set: { status: 'accepted', actionByName: 'legacy operator', actionAt: null } },
    ).exec();
    const before = await ticketRow(ticketId);
    const boardBefore = (await openBoard()).map((row) => row.id);

    const res = await restore(alexToken, [ticketId]);
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res)).toEqual([]);
    expect(refusedOf(res)).toEqual([
      { ticketId, machineCode: '7016', reason: 'noLinkedMaintenance' },
    ]);
    const after = await ticketRow(ticketId);
    expect(after).toMatchObject({ status: 'accepted', actionByName: 'legacy operator' });
    expect(after?.__v).toBe(before?.__v);
    expect((await openBoard()).map((row) => row.id)).toEqual(boardBefore);
    expect(await auditRows('mailTicket', ticketId, 'restore')).toHaveLength(0);
    expect(await pendingIds()).not.toContain(ticketId);
  });

  it('tickets the legacy import wrote RAW (no __v, createdAt, updatedAt) list, restore and leave both pages readable', async () => {
    // `npm run atm:import` writes mail tickets with a raw upsert, so Mongoose stamps none of them,
    // and no boot backfill covers the mail collection. Both pages read their list WHOLE: one such
    // row must map, or every page of the pending list and of the log fails with it.
    const now = new Date();
    const legacyRow = (status: number, code: string) => {
      const row = mailTicketFromLegacy(
        {
          _id: new Types.ObjectId(),
          bank: 'SYN BANK',
          mach_id: code,
          name: `SYN ${code}`,
          area: 'SYN AREA',
          open_time: now,
          status,
          status_txt: 'Cash out',
          action_by: 'legacy operator',
          sender_mail: 'bank@example.test',
          duplication: 0,
          found: 1,
        },
        new Types.ObjectId(alexBranch),
        null,
      );
      expect(row).not.toBeNull();
      return row as NonNullable<typeof row>;
    };
    const rejected = legacyRow(2, '7017');
    const accepted = legacyRow(1, '7018');
    await AtmMailTicketModel.collection.insertMany([rejected, accepted]);
    const raw = await AtmMailTicketModel.collection.findOne({ _id: rejected._id });
    expect(raw).not.toHaveProperty('createdAt');
    expect(raw).not.toHaveProperty('__v');

    const day = (offset: number): string =>
      cairoDateString(new Date(now.getTime() + offset * 86_400_000));
    const log = await get(
      alexToken,
      `/atm/mail-tickets/log?from=${day(-1)}&to=${day(1)}&pageSize=100`,
    );
    expect(log.status).toBe(200);
    const listed = data<AtmMailTicketDto[]>(log).filter((row) =>
      [String(rejected._id), String(accepted._id)].includes(row.id),
    );
    expect(listed).toHaveLength(2);
    for (const row of listed) {
      // Read as the master rows are (DEC-23): version 0, made at the instant inside its own id.
      const minted = new Types.ObjectId(row.id).getTimestamp().toISOString();
      expect(row).toMatchObject({ version: 0, createdAt: minted, updatedAt: minted });
    }

    // A legacy rejection returns: 200, the ticket pending — and the pending list still reads.
    const res = await restore(alexToken, [String(rejected._id), String(accepted._id)]);
    expect(res.status).toBe(200);
    expect(restoredIds(res)).toEqual([String(rejected._id)]);
    expect(refusedOf(res)).toEqual([
      { ticketId: String(accepted._id), machineCode: '7018', reason: 'noLinkedMaintenance' },
    ]);
    expect(await pendingIds()).toContain(String(rejected._id));
    expect(await ticketRow(String(accepted._id))).toMatchObject({ status: 'accepted' });
  });

  it('one selection: each ticket on its own — the returned ones in `data`, the refused in `meta`', async () => {
    const rejected = await ingestMail('7006');
    expect((await reject(alexToken, [rejected])).status).toBe(200);
    const open = await acceptedTicket('7007');
    const closed = await acceptedTicket('7008');
    await closeMaintenanceDirectly(closed.maintenanceId);
    const pending = await ingestMail('7009');

    const res = await restore(alexToken, [rejected, open.ticketId, closed.ticketId, pending]);
    expect(res.status).toBe(200);
    expect(restoredIds(res)).toEqual([rejected, open.ticketId]);
    expect(refusedOf(res)).toEqual([
      { ticketId: closed.ticketId, machineCode: '7008', reason: 'maintenanceClosed' },
    ]);
    expect((await maintenanceRow(open.maintenanceId))?.isDeleted).toBe(true);
    expect((await maintenanceRow(closed.maintenanceId))?.isDeleted).toBe(false);
  });
});

describe('mail restore — skipped silently, or refused at the door', () => {
  it('a ticket already pending is skipped: nothing written, nothing refused', async () => {
    const ticketId = await ingestMail('7010');
    const before = await ticketRow(ticketId);

    const res = await restore(alexToken, [ticketId]);
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res)).toEqual([]);
    expect(refusedOf(res)).toEqual([]);
    const after = await ticketRow(ticketId);
    expect(after?.status).toBe('pending');
    expect(after?.__v).toBe(before?.__v);
    expect(await auditRows('mailTicket', ticketId, 'restore')).toHaveLength(0);
  });

  it('a caller without atmMailTicket.decide is refused with 403 — the log is readable, not undoable', async () => {
    const ticketId = await ingestMail('7011');
    expect((await reject(alexToken, [ticketId])).status).toBe(200);
    expect((await get(viewerToken, '/atm/mail-tickets/log')).status).toBe(200);

    const res = await restore(viewerToken, [ticketId]);
    expect(res.status).toBe(403);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'rejected' });
  });

  it('a ticket outside the caller’s scope is skipped — Tanta cannot return an Alex decision', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7012');

    const res = await restore(tantaToken, [ticketId]);
    expect(res.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(res)).toEqual([]);
    expect(refusedOf(res)).toEqual([]);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'accepted' });
    expect((await maintenanceRow(maintenanceId))?.isDeleted).toBe(false);
  });

  it('a restore that read the ticket as decided, and lost to one that returned it, skips it silently', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7013');
    const decidedSnapshot = await atmMailTicketRepository.findById(ticketId);
    expect(decidedSnapshot?.status).toBe('accepted');

    expect(restoredIds(await restore(alexToken, [ticketId]))).toEqual([ticketId]);

    // The loser read the ticket BEFORE the winner returned it: its versioned write is stale, and
    // the ticket is pending — which is all it asked.
    vi.spyOn(atmMailTicketRepository, 'findById').mockResolvedValueOnce(decidedSnapshot);
    const loser = await restore(alexToken, [ticketId]);
    expect(loser.status).toBe(200);
    expect(data<AtmMailTicketDto[]>(loser)).toEqual([]);
    expect(refusedOf(loser)).toEqual([]);
    expect(await auditRows('mailTicket', ticketId, 'restore')).toHaveLength(1);
    expect(await auditRows('maintenance', maintenanceId, 'delete')).toHaveLength(1);
  });

  it('two concurrent restores of one accepted ticket: one returns it, the other skips — never a 409', async () => {
    const { ticketId, maintenanceId } = await acceptedTicket('7014');
    const responses = await Promise.all([
      restore(alexToken, [ticketId]),
      restore(alexToken, [ticketId]),
    ]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(responses.flatMap((res) => restoredIds(res))).toEqual([ticketId]);
    expect(responses.flatMap((res) => refusedOf(res))).toEqual([]);
    expect(await ticketRow(ticketId)).toMatchObject({ status: 'pending' });
    expect((await maintenanceRow(maintenanceId))?.isDeleted).toBe(true);
    expect(await auditRows('maintenance', maintenanceId, 'delete')).toHaveLength(1);
  });
});
