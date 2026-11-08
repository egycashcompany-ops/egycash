// «الرسائل التلقائية»'s settings service against a stubbed collection, secret store and audit.
//
// The claims: the token goes in and never comes back out — sealed under the document's own
// context before it is written, never in an answer, and audited as «replaced» or «cleared», never
// as itself; an omitted token keeps the stored one; SMS cannot be switched on with nothing to send
// with; only `setting.edit` held company-wide writes; and a save is read by the very next send.
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SecretRef } from '@ecms/contracts';
import { type AuthContext } from '../../shared/types';
import { type MessagingConfigDoc } from './messaging-config.model';

const repo = vi.hoisted(() => ({
  findSingleton: vi.fn(),
  ensureSingleton: vi.fn(),
  updateById: vi.fn(),
  recordLastTest: vi.fn(),
}));
const audit = vi.hoisted(() => ({ record: vi.fn() }));
const store = vi.hoisted(() => ({ available: vi.fn(), seal: vi.fn() }));
const sender = vi.hoisted(() => ({ sendSmsWith: vi.fn() }));

vi.mock('./messaging-config.repository', () => ({ messagingConfigRepository: repo }));
vi.mock('../audit', () => ({ auditService: audit }));
vi.mock('../secrets', () => ({ getSecretStore: () => store }));
vi.mock('./sms-sender', () => sender);
vi.mock('../../infrastructure/messaging/sms', () => ({ smsEndpointConfigured: () => false }));
vi.mock('../../infrastructure/messaging/whatsapp', () => ({ whatsappConfigured: () => true }));

const { messagingService } = await import('./messaging.service');
const { loadMessagingConfig, invalidateMessagingConfig } = await import('./messaging-config.store');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.syn-etisalat-token-do-not-leak.c2ln';
const SEALED: SecretRef = {
  provider: 'platformCrypto',
  keyId: 'k1',
  ref: { ciphertext: 'syn-sealed-ciphertext' },
};
const ID = new Types.ObjectId();

const ctx = (scope: 'organization' | 'branch' = 'organization'): AuthContext => ({
  userId: new Types.ObjectId().toHexString(),
  sessionId: 's1',
  branchId: null,
  departmentId: null,
  sectionId: null,
  locale: 'ar',
  permissions: { 'setting.view': scope, 'setting.edit': scope },
  permissionVersion: 1,
  isPrivileged: false,
});

const doc = (over: Partial<MessagingConfigDoc['sms']> = {}, channel = 'whatsapp') =>
  ({
    _id: ID,
    __v: 3,
    key: 'default',
    channel,
    sms: {
      enabled: false,
      provider: 'etisalat',
      templateId: null,
      tokenRef: null,
      tokenUpdatedAt: null,
      lastTest: null,
      ...over,
    },
  }) as unknown as MessagingConfigDoc;

/** What `updateById` would leave: the dotted `$set` applied to the document. */
const applied = (base: MessagingConfigDoc, set: Record<string, unknown>): MessagingConfigDoc => {
  const next = structuredClone(base) as unknown as Record<string, Record<string, unknown>>;
  for (const [path, value] of Object.entries(set)) {
    const [head, tail] = path.split('.') as [string, string | undefined];
    if (tail === undefined) (next as Record<string, unknown>)[head] = value;
    else (next[head] as Record<string, unknown>)[tail] = value;
  }
  return { ...(next as unknown as MessagingConfigDoc), __v: base.__v + 1 };
};

let current: MessagingConfigDoc | null;

beforeEach(() => {
  vi.clearAllMocks();
  invalidateMessagingConfig();
  current = null;
  repo.findSingleton.mockImplementation(async () => current);
  repo.ensureSingleton.mockImplementation(async () => {
    if (current !== null) return { doc: current, created: false };
    current = doc();
    return { doc: current, created: true };
  });
  repo.updateById.mockImplementation(async (_id: string, set: Record<string, unknown>) => {
    if (current === null) throw new Error('no document');
    current = applied(current, set);
    return current;
  });
  store.available.mockReturnValue(true);
  store.seal.mockResolvedValue(SEALED);
});

describe('reading the settings', () => {
  it('answers the defaults while nothing is saved — WhatsApp, as before the screen', async () => {
    expect(await messagingService.getSettings()).toEqual({
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
      whatsapp: { configured: true },
    });
  });

  it('says a token is set, and when — never the token or its sealed ref', async () => {
    current = doc({
      templateId: '12345',
      tokenRef: SEALED,
      tokenUpdatedAt: new Date('2026-11-08T08:00:00Z'),
    });
    const dto = await messagingService.getSettings();
    expect(dto.sms).toMatchObject({
      templateId: '12345',
      tokenSet: true,
      tokenUpdatedAt: '2026-11-08T08:00:00.000Z',
    });
    expect(JSON.stringify(dto)).not.toContain('syn-sealed-ciphertext');
    expect(JSON.stringify(dto)).not.toContain('tokenRef');
  });
});

describe('the token is write-only', () => {
  it('is sealed under the document’s own context before it is written, and never answered', async () => {
    const dto = await messagingService.updateSettings(
      { channel: 'sms', sms: { enabled: true, templateId: '12345', token: TOKEN } },
      ctx(),
    );
    expect(store.seal).toHaveBeenCalledWith(
      TOKEN,
      `platform_messaging_config:${ID.toHexString()}:smsToken`,
    );
    const [, set] = repo.updateById.mock.calls[0] as [string, Record<string, unknown>];
    expect(set['sms.tokenRef']).toEqual(SEALED);
    expect(set['sms.tokenUpdatedAt']).toBeInstanceOf(Date);
    expect(JSON.stringify(set)).not.toContain(TOKEN);
    expect(dto.channel).toBe('sms');
    expect(dto.sms).toMatchObject({ enabled: true, templateId: '12345', tokenSet: true });
    expect(JSON.stringify(dto)).not.toContain(TOKEN);
  });

  it('audits that it was replaced, never what it is', async () => {
    await messagingService.updateSettings({ sms: { token: TOKEN } }, ctx());
    expect(audit.record).toHaveBeenCalledTimes(1);
    const row = audit.record.mock.calls[0]?.[0] as {
      entityRef: unknown;
      action: string;
      changes: { field: string; old: unknown; new: unknown }[];
    };
    expect(row.entityRef).toEqual({
      moduleId: 'platform',
      entityType: 'messagingConfig',
      entityId: ID.toHexString(),
    });
    expect(row.action).toBe('create');
    expect(row.changes).toContainEqual({ field: 'sms.token', old: null, new: 'replaced' });
    expect(JSON.stringify(row)).not.toContain(TOKEN);
    expect(JSON.stringify(row)).not.toContain('syn-sealed-ciphertext');
  });

  it('keeps the stored token when a save omits it', async () => {
    current = doc({ templateId: '12345', tokenRef: SEALED });
    await messagingService.updateSettings({ channel: 'both' }, ctx());
    expect(store.seal).not.toHaveBeenCalled();
    const [, set] = repo.updateById.mock.calls[0] as [string, Record<string, unknown>];
    expect(set).toEqual({ channel: 'both' });
    expect(current?.sms.tokenRef).toEqual(SEALED);
  });

  it('clears it on `null`, and the audit says «cleared»', async () => {
    current = doc({ templateId: '12345', tokenRef: SEALED, tokenUpdatedAt: new Date() });
    const dto = await messagingService.updateSettings({ sms: { token: null } }, ctx());
    const [, set] = repo.updateById.mock.calls[0] as [string, Record<string, unknown>];
    expect(set).toEqual({ 'sms.tokenRef': null, 'sms.tokenUpdatedAt': null });
    expect(dto.sms).toMatchObject({ tokenSet: false, tokenUpdatedAt: null });
    const row = audit.record.mock.calls[0]?.[0] as { action: string; changes: unknown[] };
    expect(row.action).toBe('update');
    expect(row.changes).toEqual([{ field: 'sms.token', old: '[redacted]', new: 'cleared' }]);
  });

  it('clearing a token that is not there changes nothing and audits nothing', async () => {
    current = doc();
    await messagingService.updateSettings({ sms: { token: null } }, ctx());
    expect(repo.updateById).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses to store a token when the secret store has no usable key — nothing is written', async () => {
    store.available.mockReturnValue(false);
    await expect(messagingService.updateSettings({ sms: { token: TOKEN } }, ctx())).rejects.toThrow(
      /secret store/,
    );
    expect(repo.ensureSingleton).not.toHaveBeenCalled();
    expect(repo.updateById).not.toHaveBeenCalled();
  });
});

describe('what a save may leave', () => {
  it('refuses SMS switched on with no template and no token, naming both', async () => {
    const refused = messagingService.updateSettings({ sms: { enabled: true } }, ctx());
    await expect(refused).rejects.toMatchObject({
      httpStatus: 400,
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'body.sms.templateId', code: 'REQUIRED' }),
        expect.objectContaining({ field: 'body.sms.token', code: 'REQUIRED' }),
      ]),
    });
    expect(repo.ensureSingleton).not.toHaveBeenCalled();
  });

  it('refuses clearing the token while SMS stays on', async () => {
    current = doc({ enabled: true, templateId: '12345', tokenRef: SEALED });
    await expect(
      messagingService.updateSettings({ sms: { token: null } }, ctx()),
    ).rejects.toMatchObject({ httpStatus: 400 });
    expect(repo.updateById).not.toHaveBeenCalled();
  });

  it('audits the channel and the switch as a diff', async () => {
    current = doc({ templateId: '12345', tokenRef: SEALED });
    await messagingService.updateSettings({ channel: 'sms', sms: { enabled: true } }, ctx());
    const row = audit.record.mock.calls[0]?.[0] as { action: string; changes: unknown[] };
    expect(row.changes).toEqual([
      { field: 'channel', old: 'whatsapp', new: 'sms' },
      { field: 'sms.enabled', old: false, new: true },
    ]);
  });
});

describe('who may write', () => {
  it('refuses `setting.edit` held for a branch — the messages are company-wide', async () => {
    await expect(
      messagingService.updateSettings({ channel: 'sms' }, ctx('branch')),
    ).rejects.toMatchObject({ httpStatus: 403 });
    await expect(messagingService.testSms('01012345678', ctx('branch'))).rejects.toMatchObject({
      httpStatus: 403,
    });
    expect(repo.ensureSingleton).not.toHaveBeenCalled();
    expect(sender.sendSmsWith).not.toHaveBeenCalled();
  });
});

describe('a save is read by the very next send', () => {
  it('drops the cached settings', async () => {
    current = doc();
    expect((await loadMessagingConfig()).channel).toBe('whatsapp');
    expect((await loadMessagingConfig()).channel).toBe('whatsapp');
    expect(repo.findSingleton).toHaveBeenCalledTimes(1); // cached

    await messagingService.updateSettings({ channel: 'sms' }, ctx());
    expect((await loadMessagingConfig()).channel).toBe('sms');
  });

  it('keeps a cached read for its window, then reads again', async () => {
    current = doc();
    await loadMessagingConfig(1_000);
    current = doc({}, 'both');
    expect((await loadMessagingConfig(1_000 + 29_000)).channel).toBe('whatsapp');
    expect((await loadMessagingConfig(1_000 + 30_000)).channel).toBe('both');
  });
});

describe('the test button', () => {
  it('sends the fixed test message even while SMS is off, and keeps the run', async () => {
    current = doc({ templateId: '12345', tokenRef: SEALED });
    sender.sendSmsWith.mockResolvedValue({ ok: false, detail: 'sms endpoint not configured' });
    const result = await messagingService.testSms('01012345678', ctx());
    expect(result).toMatchObject({ ok: false, detail: 'sms endpoint not configured' });
    expect(Number.isNaN(Date.parse(result.at))).toBe(false);

    const [view, phone, body, options] = sender.sendSmsWith.mock.calls[0] as unknown[];
    expect((view as { sms: { enabled: boolean } }).sms.enabled).toBe(false);
    expect(phone).toBe('01012345678');
    expect(body).toBe('رسالة تجريبية من نظام ECMS.');
    expect(options).toEqual({ evenIfDisabled: true });

    expect(repo.recordLastTest).toHaveBeenCalledWith(ID, {
      at: expect.any(Date),
      ok: false,
      detail: 'sms endpoint not configured',
    });
    expect(audit.record).toHaveBeenCalledWith({
      entityRef: {
        moduleId: 'platform',
        entityType: 'messagingConfig',
        entityId: ID.toHexString(),
      },
      action: 'update',
      changes: [{ field: 'sms.test', old: null, new: 'sms endpoint not configured' }],
    });
    // The number tested is not kept anywhere.
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('01012345678');
  });
});
