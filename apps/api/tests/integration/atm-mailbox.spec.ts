// /atm/mailbox — «بريد الصيانة — بنك مصر» on /atm/settings, over real HTTP, real RBAC and the real
// secret store.
//
// The owner (2026-10-28): ONE shared mailbox for every branch; the branches switched on one at a
// time («هنبدأ بفرع المهندسين حالياً وبعدين هنبقى نزود فرع فرع»), mail for a branch not on yet
// staying UNREAD; and the mailbox credentials typed on a screen with the secret stored encrypted.
// So the claims under test are: the secret goes in and never comes back out (in no answer, no
// stored plaintext, no audit row); only `atmSettings.manage` held company-wide reaches any of it;
// a mail is filed only when its machine's branch is switched on, and is otherwise left unread; and
// with no document saved the reader behaves exactly as it did before the screen existed.
//
// The mailbox itself is a fake behind the provider seam (mail-source.ts) — the mail-poll.spec.ts
// pattern — so what is asserted is what the reader told the mailbox to do.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import { Types } from 'mongoose';
import {
  AtmSettingKeys,
  SettingKeys,
  platformPermissions,
  type AtmMailPollRunDto,
  type AtmMailboxConfigDto,
  type AtmMailboxTestResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { atmModule, atmPermissions } from '../../src/modules/atm/atm.module';
import { AtmMachineModel } from '../../src/modules/atm/machines/machine.model';
import { AtmMailTicketModel } from '../../src/modules/atm/mail-tickets/mail-ticket.model';
import { AtmMailboxConfigModel } from '../../src/modules/atm/mail-tickets/mailbox-config.model';
import { pollAtmMailbox } from '../../src/modules/atm/mail-tickets/mail-poll.service';
import { createGraphMailboxSource } from '../../src/modules/atm/mail-tickets/graph-mail.source';
import {
  registerAtmMailSource,
  registerAtmMailSourceFactory,
  resetAtmMailSource,
  type AtmMailMessage,
  type AtmMailSource,
} from '../../src/modules/atm/mail-tickets/mail-source';
import { rotateMailboxSecretKey } from '../../src/modules/atm/mail-tickets/mailbox-secret-rotation';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { cryptoService } from '../../src/platform/crypto';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { userService } from '../../src/platform/users';
import { env } from '../../src/infrastructure/config/env';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const SECRET = 'syn-graph-secret-9f2b7c41aa-do-not-leak';
const SECRET_2 = 'syn-graph-secret-second-77e1-do-not-leak';
const KEY_B = Buffer.alloc(32, 7).toString('base64');
const TENANT = 'syn-tenant.onmicrosoft.com';
const CLIENT_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string; // every key, organization scope
let branchHolderToken: string; // atmSettings.manage at BRANCH scope — refused by the services
let outsiderToken: string; // no ATM key at all
let adminCtx: AuthContext;
let mohandessinId: string;
let alexId: string;

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-atm-mailbox-test-${Date.now()}`;
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

const call = (
  method: 'get' | 'put' | 'post',
  path: string,
  token: string,
  body?: Record<string, unknown>,
  branch?: string,
) => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (branch !== undefined) req.set('x-active-branch', branch);
  return body === undefined ? req : req.send(body);
};

const mailBody = (code: string): string =>
  `machine number: 1234_${code} ticket subject: X "Cash out" ticket number: 55`;

const mail = (id: string, code: string): AtmMailMessage => ({
  providerMessageId: id,
  receivedAt: new Date(),
  senderEmail: 'bank@example.test',
  subject: 'ATM alert',
  bodyText: mailBody(code),
  isRead: false,
});

/**
 * A mailbox behind the provider seam: what is unread, what the reader marked (with which
 * category), and the secret the provider was handed — opened exactly as Graph opens it. It pages
 * NEWEST first, as Graph's `listUnreadPage` does, so the document's real reading runs against it.
 */
const fakeMailbox = (messages: AtmMailMessage[], fail: string | null = null) => {
  const state = {
    unread: [...messages],
    handled: [] as { id: string; category: string | null }[],
    listed: 0,
    secret: null as string | null,
  };
  registerAtmMailSourceFactory((connection) => {
    const list = async (limit: number, skip: number): Promise<AtmMailMessage[]> => {
      state.listed += 1;
      state.secret = await connection.openSecret();
      if (fail !== null) throw new Error(fail);
      const newestFirst = [...state.unread].sort(
        (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
      );
      return newestFirst.slice(skip, skip + limit);
    };
    const source: AtmMailSource = {
      providerId: 'fake-mailbox',
      available: () => true,
      listUnread: async (limit) => list(limit, 0),
      listUnreadPage: async (limit, skip) => {
        const page = await list(limit, skip);
        return { messages: page, listed: page.length };
      },
      markHandled: async (id, category) => {
        state.handled.push({ id, category });
        state.unread = state.unread.filter((m) => m.providerMessageId !== id);
      },
    };
    return source;
  });
  return state;
};

const saveBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  tenantId: TENANT,
  clientId: CLIENT_ID,
  userEmail: 'maintenance@bank.example',
  enabled: false,
  branches: [],
  version: null,
  ...over,
});

const current = async (): Promise<AtmMailboxConfigDto> => {
  const res = await call('get', '/atm/mailbox', adminToken);
  expect(res.status).toBe(200);
  return data<AtmMailboxConfigDto>(res);
};

/** A later save: the card as it stands, with `over` changed — as the screen sends it. */
const save = async (over: Record<string, unknown>): Promise<request.Response> => {
  const now = await current();
  return call('put', '/atm/mailbox', adminToken, {
    tenantId: now.tenantId,
    clientId: now.clientId,
    userEmail: now.userEmail,
    enabled: now.enabled,
    branches: now.branches.map(({ branchId, category }) => ({ branchId, category })),
    version: now.version,
    ...over,
  });
};

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    [...platformPermissions, ...atmPermissions].map((p) => p.key),
  );
  const adminId = await mkUser('atm-mailbox-admin@ecms.local');
  await rbacService.ensureAssignment(adminId, String(superAdmin._id), 'organization');
  adminCtx = {
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
  await settingsService.set(adminCtx, {
    key: SettingKeys.TotpEnforcedForPrivileged,
    scope: 'organization',
    value: false,
  });
  adminToken = await login('atm-mailbox-admin@ecms.local');

  const mkBranch = async (code: string, ar: string, en: string): Promise<string> => {
    const res = await call('post', '/platform/branches', adminToken, { code, name: { ar, en } });
    expect(res.status).toBe(201);
    return data<{ id: string }>(res).id;
  };
  mohandessinId = await mkBranch('80', 'المهندسين', 'Mohandessin');
  alexId = await mkBranch('81', 'الإسكندرية', 'Alexandria');

  const settingsRole = await rbacService.createRole(
    { name: { en: 'ATM settings', ar: 'إعدادات' }, permissionKeys: ['atmSettings.manage'] },
    adminId,
  );
  const holderId = await mkUser('atm-mailbox-branch@ecms.local', mohandessinId);
  await rbacService.ensureAssignment(holderId, String(settingsRole._id), 'branch');
  branchHolderToken = await login('atm-mailbox-branch@ecms.local');

  const outsiderRole = await rbacService.createRole(
    { name: { en: 'Outsider', ar: 'بلا صلاحية' }, permissionKeys: ['user.view'] },
    adminId,
  );
  const outsiderId = await mkUser('atm-mailbox-outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, String(outsiderRole._id), 'organization');
  outsiderToken = await login('atm-mailbox-outsider@ecms.local');

  // One machine per branch, filed by the top bar's branch (the admin is placed nowhere).
  const addMachine = async (branch: string, machineCode: string): Promise<void> => {
    const res = await call(
      'post',
      '/atm/machines/bulk',
      adminToken,
      {
        bankName: 'SYN BANK',
        area: 'SYN AREA',
        machines: [{ machineCode, name: `SYN ${machineCode}` }],
      },
      branch,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  await addMachine(mohandessinId, '7101');
  await addMachine(alexId, '7102');
  await addMachine(alexId, '7103');
}, 240_000);

afterAll(async () => {
  registerAtmMailSourceFactory(createGraphMailboxSource);
  resetAtmMailSource();
  await disconnectMongo();
  if (replSet !== null) await replSet.stop();
});

describe('who may touch the mailbox', () => {
  it('refuses a caller without the key at the route', async () => {
    for (const [method, path] of [
      ['get', '/atm/mailbox'],
      ['put', '/atm/mailbox'],
      ['post', '/atm/mailbox/test'],
      ['post', '/atm/mailbox/poll'],
    ] as const) {
      const res = await call(
        method,
        path,
        outsiderToken,
        method === 'get' ? undefined : saveBody(),
      );
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  it('refuses the key held for one branch — the mailbox serves every branch', async () => {
    for (const [method, path] of [
      ['get', '/atm/mailbox'],
      ['put', '/atm/mailbox'],
      ['post', '/atm/mailbox/test'],
      ['post', '/atm/mailbox/poll'],
    ] as const) {
      const res = await call(
        method,
        path,
        branchHolderToken,
        method === 'get' ? undefined : saveBody({ clientSecret: SECRET }),
      );
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    expect(await AtmMailboxConfigModel.countDocuments().exec()).toBe(0);
  });
});

describe('the secret goes in and never comes back out', () => {
  it('answers null while no document exists — the reader is still on the environment', async () => {
    const res = await call('get', '/atm/mailbox', adminToken);
    expect(res.status).toBe(200);
    expect(data(res)).toBeNull();
  });

  it('refuses to switch reading on with no secret anywhere', async () => {
    const res = await call('put', '/atm/mailbox', adminToken, saveBody({ enabled: true }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('body.clientSecret');
    expect(await AtmMailboxConfigModel.countDocuments().exec()).toBe(0);
  });

  it('never quotes a secret back in a refusal', async () => {
    const res = await call(
      'put',
      '/atm/mailbox',
      adminToken,
      saveBody({ clientId: 'not-a-guid', clientSecret: SECRET }),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('seals the secret on the first save and answers only that one is stored', async () => {
    const res = await call(
      'put',
      '/atm/mailbox',
      adminToken,
      saveBody({
        clientSecret: SECRET,
        branches: [{ branchId: mohandessinId, category: 'Green Category' }],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(JSON.stringify(res.body)).not.toContain('clientSecretRef');
    expect(data<AtmMailboxConfigDto>(res)).toEqual({
      tenantId: TENANT,
      clientId: CLIENT_ID,
      hasSecret: true,
      userEmail: 'maintenance@bank.example',
      enabled: false,
      branches: [
        {
          branchId: mohandessinId,
          branchName: { ar: 'المهندسين', en: 'Mohandessin' },
          category: 'Green Category',
        },
      ],
      lastPoll: null,
      version: 0,
    });

    const get = await call('get', '/atm/mailbox', adminToken);
    expect(JSON.stringify(get.body)).not.toContain(SECRET);

    // Stored SEALED: the store's ref under the active key, and no plaintext anywhere in the row.
    const raw = await AtmMailboxConfigModel.collection.findOne({});
    expect(raw?.clientSecretRef).toMatchObject({
      provider: 'platformCrypto',
      keyId: cryptoService.status().activeKeyId,
    });
    expect(JSON.stringify(raw)).not.toContain(SECRET);
  });

  it('keeps the stored secret when a save omits it', async () => {
    const before = await AtmMailboxConfigModel.collection.findOne({});
    const res = await save({ userEmail: 'maintenance2@bank.example' });
    expect(res.status).toBe(200);
    expect(data<AtmMailboxConfigDto>(res)).toMatchObject({ hasSecret: true, version: 1 });
    const after = await AtmMailboxConfigModel.collection.findOne({});
    expect(after?.clientSecretRef).toEqual(before?.clientSecretRef);
  });

  it('refuses a stale save and a second first save with 409', async () => {
    const stale = await call('put', '/atm/mailbox', adminToken, saveBody({ version: 0 }));
    expect(stale.status).toBe(409);
    const second = await call('put', '/atm/mailbox', adminToken, saveBody({ version: null }));
    expect(second.status).toBe(409);
    expect(await AtmMailboxConfigModel.countDocuments().exec()).toBe(1);
  });

  it('audits that the secret changed, never what it is', async () => {
    const res = await save({ clientSecret: SECRET_2 });
    expect(res.status).toBe(200);
    const rows = await AuditLogModel.find({
      'entityRef.moduleId': 'atm',
      'entityRef.entityType': 'mailboxConfig',
    })
      .sort({ _id: 1 })
      .lean()
      .exec();
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'update']);
    const secretChanges = rows.map((row) =>
      row.changes.find((change) => change.field === 'clientSecret'),
    );
    expect(secretChanges).toEqual([
      { field: 'clientSecret', old: null, new: '[redacted]' },
      undefined,
      { field: 'clientSecret', old: '[redacted]', new: '[redacted]' },
    ]);
    const all = JSON.stringify(rows);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(SECRET_2);
  });
});

describe('the connection test', () => {
  it('lists one unread message with the STORED settings, and marks nothing', async () => {
    const mailbox = fakeMailbox([mail('test-1', '7101'), mail('test-2', '7101')]);
    const res = await call('post', '/atm/mailbox/test', adminToken, {});
    expect(res.status).toBe(200);
    expect(data<AtmMailboxTestResultDto>(res)).toEqual({ ok: true, unreadSample: 1, error: null });
    // The provider was handed the secret saved last, opened from its sealed ref.
    expect(mailbox.secret).toBe(SECRET_2);
    expect(mailbox.handled).toEqual([]);
    expect(await AtmMailTicketModel.countDocuments().exec()).toBe(0);
  });

  it('answers the provider’s refusal, never the secret', async () => {
    fakeMailbox([], 'microsoft graph 401 on /syn-tenant/oauth2/v2.0/token');
    const res = await call('post', '/atm/mailbox/test', adminToken, {});
    expect(res.status).toBe(200);
    expect(data<AtmMailboxTestResultDto>(res)).toEqual({
      ok: false,
      unreadSample: 0,
      error: 'microsoft graph 401 on /syn-tenant/oauth2/v2.0/token',
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET_2);
  });
});

describe('only the switched-on branches are filed', () => {
  let mailbox: ReturnType<typeof fakeMailbox>;

  it('files Mohandessin’s mail with its category and leaves Alexandria’s UNREAD', async () => {
    expect((await save({ enabled: true })).status).toBe(200);
    mailbox = fakeMailbox([mail('gate-1', '7101'), mail('gate-2', '7102')]);

    const res = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(res.status).toBe(200);
    const run = data<AtmMailPollRunDto>(res);
    expect(run).toMatchObject({
      read: 2,
      created: 1,
      duplicates: 0,
      unmatched: 1,
      failed: 0,
      error: null,
      unmatchedReasons: ['branch not enabled for mail'],
    });
    expect(mailbox.handled).toEqual([{ id: 'gate-1', category: 'Green Category' }]);
    expect(mailbox.unread.map((m) => m.providerMessageId)).toEqual(['gate-2']);

    const tickets = await AtmMailTicketModel.find({}).lean().exec();
    expect(tickets.map((t) => [t.machineCode, String(t.branchId)])).toEqual([
      ['7101', mohandessinId],
    ]);
  });

  it('records the run on the document without moving its version', async () => {
    const config = await current();
    expect(config.lastPoll).toMatchObject({
      read: 2,
      created: 1,
      unmatched: 1,
      error: null,
      unmatchedReasons: ['branch not enabled for mail'],
    });
    // The version the screen holds stays valid: a poll a minute must not make a save stale.
    expect(config.version).toBe(3);
  });

  it('picks up a branch’s backlog on the first run after it is switched on', async () => {
    const res = await save({
      branches: [
        { branchId: mohandessinId, category: 'Green Category' },
        { branchId: alexId, category: null },
      ],
    });
    expect(res.status).toBe(200);

    const poll = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(data<AtmMailPollRunDto>(poll)).toMatchObject({ read: 1, created: 1, unmatched: 0 });
    // No category of its own and none in the old setting: marked read, untagged.
    expect(mailbox.handled).toContainEqual({ id: 'gate-2', category: null });
    const alex = await AtmMailTicketModel.find({ machineCode: '7102' }).lean().exec();
    expect(alex.map((t) => String(t.branchId))).toEqual([alexId]);
  });

  it('records a mailbox that fails as a whole as the run’s error', async () => {
    fakeMailbox([], 'microsoft graph 503 on /users/x/messages');
    const res = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(res.status).toBe(200);
    expect(data<AtmMailPollRunDto>(res)).toMatchObject({
      read: 0,
      error: 'microsoft graph 503 on /users/x/messages',
    });
    expect((await current()).lastPoll?.error).toBe('microsoft graph 503 on /users/x/messages');
  });
});

// The ONE shared mailbox fills with mail left unread on purpose (here Alexandria's, not switched
// on). Read oldest first, fifty of those would hide every later mail for good; read newest first,
// with one older page swept per run, neither a new mail nor one buried under the pile is lost.
describe('a pile of mail left unread hides nothing', () => {
  it('files a new mail and one buried under sixty of Alexandria’s, in one run', async () => {
    const saved = await save({
      branches: [{ branchId: mohandessinId, category: 'Green Category' }],
    });
    expect(saved.status).toBe(200);
    const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);
    const at = (message: AtmMailMessage, n: number): AtmMailMessage => ({
      ...message,
      receivedAt: minutesAgo(n),
    });
    const alex = Array.from({ length: 60 }, (_, i) =>
      at(mail(`pile-alex-${String(i)}`, i % 2 === 0 ? '7102' : '7103'), i < 54 ? i + 1 : i + 2),
    );
    const mailbox = fakeMailbox([
      at(mail('pile-new', '7101'), 0),
      ...alex,
      at(mail('pile-buried', '7101'), 55),
    ]);

    const res = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(res.status).toBe(200);
    expect(data<AtmMailPollRunDto>(res)).toMatchObject({
      created: 2,
      unmatched: 60,
      failed: 0,
      error: null,
    });
    expect(mailbox.handled).toEqual([
      { id: 'pile-new', category: 'Green Category' },
      { id: 'pile-buried', category: 'Green Category' },
    ]);
    expect(mailbox.unread).toHaveLength(60);
    const filed = await AtmMailTicketModel.find({
      providerMessageId: { $in: ['pile-new', 'pile-buried'] },
    })
      .lean()
      .exec();
    expect(filed.map((t) => String(t.branchId))).toEqual([mohandessinId, mohandessinId]);
  });
});

describe('switched off, the reader reads nothing', () => {
  it('refuses «قراءة الآن» and the scheduled run lists nothing', async () => {
    expect((await save({ enabled: false })).status).toBe(200);
    const mailbox = fakeMailbox([mail('off-1', '7101')]);

    const res = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(res.status).toBe(422);

    const run = await pollAtmMailbox();
    expect(run).toMatchObject({ read: 0, error: null });
    expect(mailbox.listed).toBe(0);
  });
});

describe('the nightly key rotation', () => {
  it('re-wraps the mailbox secret onto the new key, and it still opens', async () => {
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

      const versionBefore = (await current()).version;
      const task = (atmModule.scheduledTasks ?? []).find(
        (t) => t.key === 'atm.rotateRegisterCombinationKeys',
      );
      if (task === undefined) throw new Error('rotation task not declared');
      await task.handler();

      const raw = await AtmMailboxConfigModel.collection.findOne({});
      expect((raw?.clientSecretRef as { keyId?: string } | null)?.keyId).toBe('b');
      expect((await current()).version).toBe(versionBefore + 1);

      const mailbox = fakeMailbox([]);
      const test = await call('post', '/atm/mailbox/test', adminToken, {});
      expect(data<AtmMailboxTestResultDto>(test).ok).toBe(true);
      expect(mailbox.secret).toBe(SECRET_2);
      expect(await rotateMailboxSecretKey()).toEqual({ rotated: 0, failed: 0 });
    } finally {
      settings.PLATFORM_ENCRYPTION_KEYS = keys;
      settings.PLATFORM_ENCRYPTION_ACTIVE_KEY = active;
      cryptoService.resetKeyRing();
    }
  });
});

describe('with no document, the environment mode is exactly what it was', () => {
  it('files every branch through the environment, with the old category setting', async () => {
    await AtmMailboxConfigModel.deleteMany({}).exec();
    expect(data(await call('get', '/atm/mailbox', adminToken))).toBeNull();

    await settingsService.set(adminCtx, {
      key: AtmSettingKeys.MailBranchCategories,
      scope: 'organization',
      value: [{ branchId: alexId, category: 'Blue Category' }],
    });
    const handled: { id: string; category: string | null }[] = [];
    registerAtmMailSource({
      providerId: 'fake-environment',
      available: () => true,
      listUnread: async () => [mail('env-1', '7103')],
      markHandled: async (id, category) => {
        handled.push({ id, category });
      },
    });

    const res = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(res.status).toBe(200);
    expect(data<AtmMailPollRunDto>(res)).toMatchObject({ read: 1, created: 1, error: null });
    expect(handled).toEqual([{ id: 'env-1', category: 'Blue Category' }]);
    const ticket = await AtmMailTicketModel.findOne({ machineCode: '7103' }).lean().exec();
    expect(String(ticket?.branchId)).toBe(alexId);
    // The run's record never creates the document — that would end the environment mode.
    expect(await AtmMailboxConfigModel.countDocuments().exec()).toBe(0);
  });
});

// The owner's report (2026-10-28): a Mohandessin machine's mail showed only under «كل الشركة» — the
// machine was still filed under the October branch that works as Mohandessin (`atm.branchLinks`),
// and so was its mail. A mail is filed under its machine's RESOLVED branch, the switched-on set and
// the colours are resolved the same way, and the card's save stores a linked source as its target.
describe('mail through a branch link', () => {
  let octoberId: string;

  beforeAll(async () => {
    const res = await call('post', '/platform/branches', adminToken, {
      code: '82',
      name: { ar: 'أكتوبر', en: 'October' },
    });
    expect(res.status).toBe(201);
    octoberId = data<{ id: string }>(res).id;
    // Filed under October as production's workbook import filed it, before the link existed.
    await AtmMachineModel.create([
      {
        branchId: new Types.ObjectId(octoberId),
        machineCode: '7201',
        name: 'SYN 7201',
        bankName: 'SYN BANK',
        area: 'SYN AREA',
        zone: '',
        isActive: true,
      },
    ]);
    await settingsService.set(adminCtx, {
      key: AtmSettingKeys.BranchLinks,
      scope: 'organization',
      value: [{ branchId: octoberId, actsAsBranchId: mohandessinId }],
    });
  });

  afterAll(async () => {
    await settingsService.set(adminCtx, {
      key: AtmSettingKeys.BranchLinks,
      scope: 'organization',
      value: [],
    });
  });

  it('saves a linked source as its target, and drops it beside the target’s own row', async () => {
    const first = await call(
      'put',
      '/atm/mailbox',
      adminToken,
      saveBody({
        enabled: true,
        clientSecret: SECRET,
        branches: [{ branchId: octoberId, category: 'Orange Category' }],
      }),
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(data<AtmMailboxConfigDto>(first).branches).toEqual([
      {
        branchId: mohandessinId,
        branchName: { ar: 'المهندسين', en: 'Mohandessin' },
        category: 'Orange Category',
      },
    ]);
    const both = await save({
      branches: [
        { branchId: octoberId, category: 'Orange Category' },
        { branchId: mohandessinId, category: 'Green Category' },
      ],
    });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    expect(
      data<AtmMailboxConfigDto>(both).branches.map(({ branchId, category }) => [
        branchId,
        category,
      ]),
    ).toEqual([[mohandessinId, 'Green Category']]);
  });

  it('files an October machine’s mail under Mohandessin — switched on and coloured as Mohandessin', async () => {
    const mailbox = fakeMailbox([mail('link-1', '7201')]);
    const res = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(data<AtmMailPollRunDto>(res)).toMatchObject({ read: 1, created: 1, unmatched: 0 });
    expect(mailbox.handled).toEqual([{ id: 'link-1', category: 'Green Category' }]);
    const ticket = await AtmMailTicketModel.findOne({ machineCode: '7201' }).lean().exec();
    expect(String(ticket?.branchId)).toBe(mohandessinId);
  });

  it('reads a document saved before the link the same way: October’s row switches Mohandessin on', async () => {
    // Saved before this change: the row names October itself.
    await AtmMailboxConfigModel.updateOne(
      { key: 'default' },
      {
        $set: {
          branches: [{ branchId: new Types.ObjectId(octoberId), category: 'Orange Category' }],
        },
      },
    ).exec();
    await AtmMailTicketModel.deleteMany({ machineCode: '7201' }).exec();
    const mailbox = fakeMailbox([mail('link-2', '7201')]);
    const res = await call('post', '/atm/mailbox/poll', adminToken, {});
    expect(data<AtmMailPollRunDto>(res)).toMatchObject({ read: 1, created: 1, unmatched: 0 });
    expect(mailbox.handled).toEqual([{ id: 'link-2', category: 'Orange Category' }]);
    const ticket = await AtmMailTicketModel.findOne({ machineCode: '7201' }).lean().exec();
    expect(String(ticket?.branchId)).toBe(mohandessinId);
  });
});
