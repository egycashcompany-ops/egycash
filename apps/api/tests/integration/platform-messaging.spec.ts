// «الرسائل التلقائية» (/platform/messaging) over real HTTP, real RBAC and the real secret store.
//
// The owner (2026-11-08): «عايز أعمل Automation بدل واتساب يبقي SMS ممكن تشرحلى المطلوب ؟ وتجهز
// السيستم على كدا». The automatic messages go by SMS through Etisalat Egypt — the template id and
// the token typed on the screen — by WhatsApp, or by both. So the claims under test are:
//
//   1. Only the system settings' own keys reach any of it: `setting.view` reads, `setting.edit`
//      held company-wide writes and tests; nothing else, and no new key.
//   2. The token goes in and never comes back out — in no answer, no stored plaintext, no audit
//      row, no refusal — and an omitted token keeps the stored one.
//   3. With no SMS endpoint configured (the provider's API page has not arrived), the test
//      answers «sms endpoint not configured» and no request leaves the process.
//   4. A save is what the next automatic message goes by, and the token rides the nightly re-wrap.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { type Express } from 'express';
import {
  SettingKeys,
  platformPermissions,
  type MessagingSettingsDto,
  type ScheduledTaskDto,
  type SmsTestResultDto,
} from '@ecms/contracts';
import { bootPlatform } from '../../src/platform/kernel/bootstrap';
import { buildApp } from '../../src/app';
import { moduleManifests } from '../../src/modules';
import { AuditLogModel } from '../../src/platform/audit/audit.model';
import { cryptoService } from '../../src/platform/crypto';
import { rotateSmsTokenKey, sendTextMessage } from '../../src/platform/messaging';
import { MessagingConfigModel } from '../../src/platform/messaging/messaging-config.model';
import { getSecretStore } from '../../src/platform/secrets';
import { rbacService } from '../../src/platform/rbac';
import { settingsService } from '../../src/platform/settings';
import { deliverCredentials, userService } from '../../src/platform/users';
import { env } from '../../src/infrastructure/config/env';
import { getCache } from '../../src/infrastructure/redis/cache';
import { disconnectMongo } from '../../src/infrastructure/database/mongo';
import { type AuthContext } from '../../src/shared/types';

const PASSWORD = 'Str0ng#Pass!';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.syn-etisalat-agent-token-do-not-leak.c2lnbmF0dXJl';
const TOKEN_2 = 'eyJhbGciOiJIUzI1NiJ9.syn-etisalat-second-token-do-not-leak.c2ln';
const KEY_B = Buffer.alloc(32, 11).toString('base64');

let replSet: MongoMemoryReplSet | null = null;
let app: Express;
let adminToken: string; // every platform key, organization scope
let readerToken: string; // setting.view only
let branchEditorToken: string; // setting.view + setting.edit at BRANCH scope
let outsiderToken: string; // user.view only

const resolveMongoUri = async (): Promise<string> => {
  const external = process.env.MONGO_TEST_URI;
  const dbName = `ecms-platform-messaging-test-${Date.now()}`;
  if (external !== undefined && external !== '') {
    const url = new URL(external);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  return replSet.getUri(dbName);
};

const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

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
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  expect(res.status, `login ${email}`).toBe(200);
  return data<{ accessToken: string }>(res).accessToken;
};

const call = (
  method: 'get' | 'patch' | 'post',
  path: string,
  token: string,
  body?: Record<string, unknown>,
) => {
  const req = request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};

const SETTINGS = '/platform/messaging/settings';
const TEST = '/platform/messaging/sms/test';

const settingsNow = async (): Promise<MessagingSettingsDto> => {
  const res = await call('get', SETTINGS, adminToken);
  expect(res.status).toBe(200);
  return data<MessagingSettingsDto>(res);
};

const rawConfig = () => MessagingConfigModel.collection.findOne({});

const settingsEnv = env as unknown as {
  ETISALAT_SMS_URL: string;
  WHATSAPP_PROVIDER: string;
  PLATFORM_ENCRYPTION_KEYS: string;
  PLATFORM_ENCRYPTION_ACTIVE_KEY: string;
};

let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
  await bootPlatform({ mongoUri: await resolveMongoUri(), modules: moduleManifests });
  app = buildApp();
  // Hermetic: no SMS endpoint (the provider's API page has not arrived) and no WhatsApp provider.
  expect(settingsEnv.ETISALAT_SMS_URL).toBe('');
  expect(settingsEnv.WHATSAPP_PROVIDER).toBe('disabled');

  const superAdmin = await rbacService.ensureSystemRole(
    'super-admin',
    { en: 'Super Admin', ar: 'مدير النظام الأعلى' },
    platformPermissions.map((p) => p.key),
  );
  const adminId = await mkUser('messaging-admin@ecms.local');
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
  adminToken = await login('messaging-admin@ecms.local');

  const branch = await call('post', '/platform/branches', adminToken, {
    code: '091',
    name: { ar: 'فرع الرسائل', en: 'Messaging Branch' },
  });
  expect(branch.status).toBe(201);
  const branchId = data<{ id: string }>(branch).id;

  const readerRole = await rbacService.createRole(
    { name: { en: 'Settings reader', ar: 'قارئ الإعدادات' }, permissionKeys: ['setting.view'] },
    adminId,
  );
  const readerId = await mkUser('messaging-reader@ecms.local');
  await rbacService.ensureAssignment(readerId, String(readerRole._id), 'organization');
  readerToken = await login('messaging-reader@ecms.local');

  const editorRole = await rbacService.createRole(
    {
      name: { en: 'Branch settings editor', ar: 'محرر إعدادات الفرع' },
      permissionKeys: ['setting.view', 'setting.edit'],
    },
    adminId,
  );
  const editorId = await mkUser('messaging-branch@ecms.local', branchId);
  await rbacService.ensureAssignment(editorId, String(editorRole._id), 'branch');
  branchEditorToken = await login('messaging-branch@ecms.local');

  const outsiderRole = await rbacService.createRole(
    { name: { en: 'Outsider', ar: 'بلا صلاحية' }, permissionKeys: ['user.view'] },
    adminId,
  );
  const outsiderId = await mkUser('messaging-outsider@ecms.local');
  await rbacService.ensureAssignment(outsiderId, String(outsiderRole._id), 'organization');
  outsiderToken = await login('messaging-outsider@ecms.local');
}, 240_000);

afterAll(async () => {
  await disconnectMongo();
  await getCache().close();
  if (replSet !== null) await replSet.stop();
});

beforeEach(async () => {
  await getCache().delByPrefix('rl:');
  // Nothing in this file may reach a network: every SMS must be answered before a request.
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

describe('who may touch the automatic messages', () => {
  it('refuses a caller without the settings keys at the route', async () => {
    expect((await call('get', SETTINGS, outsiderToken)).status).toBe(403);
    expect((await call('patch', SETTINGS, outsiderToken, { channel: 'sms' })).status).toBe(403);
    expect((await call('post', TEST, outsiderToken, { phone: '01012345678' })).status).toBe(403);
  });

  it('lets `setting.view` read, and nothing more', async () => {
    expect((await call('get', SETTINGS, readerToken)).status).toBe(200);
    expect((await call('patch', SETTINGS, readerToken, { channel: 'sms' })).status).toBe(403);
    expect((await call('post', TEST, readerToken, { phone: '01012345678' })).status).toBe(403);
  });

  it('refuses `setting.edit` held for one branch — the messages are company-wide', async () => {
    expect((await call('patch', SETTINGS, branchEditorToken, { channel: 'sms' })).status).toBe(403);
    expect((await call('post', TEST, branchEditorToken, { phone: '01012345678' })).status).toBe(
      403,
    );
    expect(await MessagingConfigModel.countDocuments().exec()).toBe(0);
  });
});

describe('before anything is saved', () => {
  it('answers the defaults: WhatsApp, as before the screen, and no SMS endpoint', async () => {
    expect(await settingsNow()).toEqual({
      channel: 'whatsapp',
      sms: {
        enabled: false,
        provider: 'etisalat',
        templateId: null,
        tokenSet: false,
        tokenUpdatedAt: null,
        endpointConfigured: false,
        lastTest: null,
      },
      whatsapp: { configured: false },
    });
  });

  it('refuses switching SMS on with nothing to send with, naming both boxes', async () => {
    const res = await call('patch', SETTINGS, adminToken, { sms: { enabled: true } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('body.sms.templateId');
    expect(JSON.stringify(res.body)).toContain('body.sms.token');
    expect(await MessagingConfigModel.countDocuments().exec()).toBe(0);
  });

  it('refuses what the contract does not know, and an empty token', async () => {
    expect((await call('patch', SETTINGS, adminToken, { other: true })).status).toBe(400);
    expect((await call('patch', SETTINGS, adminToken, { sms: { token: '' } })).status).toBe(400);
    expect((await call('patch', SETTINGS, adminToken, { channel: 'fax' })).status).toBe(400);
  });

  it('never quotes a token back in a refusal', async () => {
    const res = await call('patch', SETTINGS, adminToken, {
      sms: { templateId: 'not-digits', token: TOKEN },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });
});

describe('the token goes in and never comes back out', () => {
  it('seals it on the first save and answers only that one is set', async () => {
    const res = await call('patch', SETTINGS, adminToken, {
      channel: 'sms',
      sms: { enabled: true, templateId: '12345', token: TOKEN },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(JSON.stringify(res.body)).not.toContain('tokenRef');
    const dto = data<MessagingSettingsDto>(res);
    expect(dto).toMatchObject({
      channel: 'sms',
      sms: { enabled: true, templateId: '12345', tokenSet: true, endpointConfigured: false },
    });
    expect(Number.isNaN(Date.parse(dto.sms.tokenUpdatedAt ?? ''))).toBe(false);

    const get = await call('get', SETTINGS, adminToken);
    expect(JSON.stringify(get.body)).not.toContain(TOKEN);

    // Stored SEALED under the active key, bound to THIS document — and no plaintext in the row.
    const raw = await rawConfig();
    expect(raw?.sms?.tokenRef).toMatchObject({
      provider: 'platformCrypto',
      keyId: cryptoService.status().activeKeyId,
    });
    expect(JSON.stringify(raw)).not.toContain(TOKEN);
    const opened = await getSecretStore().open(
      raw?.sms?.tokenRef,
      `platform_messaging_config:${String(raw?._id)}:smsToken`,
    );
    expect(opened).toBe(TOKEN);
  });

  it('keeps the stored token when a save omits it', async () => {
    const before = await rawConfig();
    const res = await call('patch', SETTINGS, adminToken, { channel: 'both' });
    expect(res.status).toBe(200);
    expect(data<MessagingSettingsDto>(res)).toMatchObject({
      channel: 'both',
      sms: { tokenSet: true },
    });
    const after = await rawConfig();
    expect(after?.sms?.tokenRef).toEqual(before?.sms?.tokenRef);
  });

  it('replaces it with a new one', async () => {
    const res = await call('patch', SETTINGS, adminToken, { sms: { token: TOKEN_2 } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN_2);
    const raw = await rawConfig();
    expect(
      await getSecretStore().open(
        raw?.sms?.tokenRef,
        `platform_messaging_config:${String(raw?._id)}:smsToken`,
      ),
    ).toBe(TOKEN_2);
  });

  it('refuses clearing it while SMS stays switched on, and clears it once SMS is off', async () => {
    expect((await call('patch', SETTINGS, adminToken, { sms: { token: null } })).status).toBe(400);
    const res = await call('patch', SETTINGS, adminToken, {
      sms: { enabled: false, token: null },
    });
    expect(res.status).toBe(200);
    expect(data<MessagingSettingsDto>(res).sms).toMatchObject({
      enabled: false,
      tokenSet: false,
      tokenUpdatedAt: null,
    });
    expect((await rawConfig())?.sms?.tokenRef).toBeNull();
  });

  it('audits that the token was replaced or cleared, never what it is', async () => {
    const rows = await AuditLogModel.find({
      'entityRef.moduleId': 'platform',
      'entityRef.entityType': 'messagingConfig',
    })
      .sort({ _id: 1 })
      .lean()
      .exec();
    expect(rows.map((row) => row.action)).toEqual(['create', 'update', 'update', 'update']);
    const tokenChanges = rows.map((row) =>
      row.changes.find((change) => change.field === 'sms.token'),
    );
    expect(tokenChanges).toEqual([
      { field: 'sms.token', old: null, new: 'replaced' },
      undefined,
      { field: 'sms.token', old: '[redacted]', new: 'replaced' },
      { field: 'sms.token', old: '[redacted]', new: 'cleared' },
    ]);
    const all = JSON.stringify(rows);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(TOKEN_2);
  });
});

describe('the test, with no SMS endpoint configured', () => {
  it('answers «sms endpoint not configured», keeps the run, and makes no request', async () => {
    // Put a token back first, so the endpoint is the only thing missing.
    expect(
      (await call('patch', SETTINGS, adminToken, { sms: { enabled: true, token: TOKEN } })).status,
    ).toBe(200);
    const res = await call('post', TEST, adminToken, { phone: '01012345678' });
    expect(res.status).toBe(200);
    const run = data<SmsTestResultDto>(res);
    expect(run).toMatchObject({ ok: false, detail: 'sms endpoint not configured' });
    expect((await settingsNow()).sms.lastTest).toEqual(run);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('does not keep the number it was sent to', async () => {
    const rows = await AuditLogModel.find({ 'entityRef.entityType': 'messagingConfig' })
      .sort({ _id: 1 })
      .lean()
      .exec();
    expect(rows.at(-1)?.changes).toEqual([
      { field: 'sms.test', old: null, new: 'sms endpoint not configured' },
    ]);
    expect(JSON.stringify(rows)).not.toContain('01012345678');
    expect(JSON.stringify(await rawConfig())).not.toContain('01012345678');
  });

  it('refuses a number that is no mobile number', async () => {
    expect((await call('post', TEST, adminToken, { phone: 'abc' })).status).toBe(400);
    expect((await call('post', TEST, adminToken, {})).status).toBe(400);
  });

  it('is limited per person', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await call('post', TEST, adminToken, { phone: '01012345678' })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});

describe('the automatic messages go the way the screen says', () => {
  it('sends by the saved channel — `both` reports each transport', async () => {
    expect((await call('patch', SETTINGS, adminToken, { channel: 'both' })).status).toBe(200);
    const sent = await sendTextMessage('01012345678', { whatsapp: 'نص', sms: 'نص' });
    expect(sent.ok).toBe(false);
    expect(sent.results).toEqual([
      { channel: 'sms', ok: false, detail: 'sms endpoint not configured' },
      { channel: 'whatsapp', ok: false, detail: 'whatsapp transport disabled' },
    ]);
  });

  it('records an SMS row for a setup link once SMS is chosen', async () => {
    expect((await call('patch', SETTINGS, adminToken, { channel: 'sms' })).status).toBe(200);
    const userId = await mkUser('messaging-delivery@ecms.local');
    const results = await deliverCredentials({
      userId,
      username: 'messaging.delivery',
      employeeCode: null,
      phone: '01012345678',
      email: null,
      setupToken: 'syn-setup-token-not-a-real-one',
      expiresAt: new Date(Date.now() + 3_600_000),
      mode: 'initial',
    });
    expect(results).toEqual([
      { channel: 'sms', ok: false, detail: 'sms endpoint not configured' },
      { channel: 'email', ok: false, detail: 'no email address on file' },
    ]);
  });
});

describe('the nightly key rotation', () => {
  it('is declared among the platform’s scheduled tasks', async () => {
    const res = await call('get', '/platform/scheduled-tasks', adminToken);
    expect(res.status).toBe(200);
    const keys = data<ScheduledTaskDto[]>(res).map((task) => task.key);
    expect(keys).toContain('platform.messaging.rotateSmsTokenKey');
  });

  it('re-wraps the token onto the new key, and it still opens', async () => {
    const keys = settingsEnv.PLATFORM_ENCRYPTION_KEYS;
    const active = settingsEnv.PLATFORM_ENCRYPTION_ACTIVE_KEY;
    try {
      settingsEnv.PLATFORM_ENCRYPTION_KEYS = `${keys},b:${KEY_B}`;
      settingsEnv.PLATFORM_ENCRYPTION_ACTIVE_KEY = 'b';
      cryptoService.resetKeyRing();

      const before = await rawConfig();
      expect(await rotateSmsTokenKey()).toEqual({ rotated: 1, failed: 0 });
      const after = await rawConfig();
      expect((after?.sms?.tokenRef as { keyId?: string } | null)?.keyId).toBe('b');
      expect(after?.__v).toBe((before?.__v as number) + 1);
      expect(
        await getSecretStore().open(
          after?.sms?.tokenRef,
          `platform_messaging_config:${String(after?._id)}:smsToken`,
        ),
      ).toBe(TOKEN);
      expect(await rotateSmsTokenKey()).toEqual({ rotated: 0, failed: 0 });
    } finally {
      settingsEnv.PLATFORM_ENCRYPTION_KEYS = keys;
      settingsEnv.PLATFORM_ENCRYPTION_ACTIVE_KEY = active;
      cryptoService.resetKeyRing();
    }
  });
});
