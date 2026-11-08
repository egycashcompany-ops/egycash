// Credentials delivery through «الرسائل التلقائية»: one result row for each text transport the
// settings name — SMS, WhatsApp, or both — beside email, each audited by outcome; WhatsApp and
// email keep the template's wording word for word, and SMS gets the short Arabic wording that
// carries the link in as few parts as an Arabic SMS allows. The setup link is in no audit row.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type TextTransport } from '@ecms/contracts';

const text = vi.hoisted(() => ({ configuredTransports: vi.fn(), sendTextMessage: vi.fn() }));
const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
const audit = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock('../messaging/text-message', () => text);
vi.mock('../../infrastructure/email/mailer', () => mail);
vi.mock('../audit', () => ({ auditService: audit }));
vi.mock('../notifications/notification-template.repository', () => ({
  notificationTemplateRepository: { findLatestByKey: async () => null },
}));

const { credentialsSmsText, deliverCredentials, setupLinkUrl } =
  await import('./credentials-delivery');

const TOKEN = 'syn-setup-token-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTU';
const INPUT = {
  userId: '66a1b2c3d4e5f60718293a4b',
  username: 'ahmed.mahmoud',
  employeeCode: '0100201',
  phone: '01012345678',
  email: 'ahmed@example.test',
  setupToken: TOKEN,
  expiresAt: new Date('2026-11-09T14:30:00Z'),
  mode: 'initial' as const,
};

/** Parts an SMS takes: UCS-2 for anything outside GSM-7 — 70 alone, 67 a part once split. */
const smsParts = (body: string): number => {
  const length = [...body].length;
  const gsm = /^[\x20-\x7E\n]*$/.test(body);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return length <= single ? 1 : Math.ceil(length / multi);
};

const sentOn = (transports: TextTransport[]) =>
  text.sendTextMessage.mockImplementation(async () => ({
    ok: false,
    detail: 'x',
    results: transports.map((channel) => ({ channel, ok: false, detail: `${channel} down` })),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mail.sendMail.mockResolvedValue(undefined);
  audit.record.mockResolvedValue(undefined);
  text.configuredTransports.mockResolvedValue(['sms']);
  sentOn(['sms']);
});

describe('the text message goes the way «الرسائل التلقائية» says', () => {
  it('SMS — one sms row beside the email row, each audited by outcome', async () => {
    const results = await deliverCredentials(INPUT);
    expect(results).toEqual([
      { channel: 'sms', ok: false, detail: 'sms down' },
      { channel: 'email', ok: true, detail: null },
    ]);
    const row = audit.record.mock.calls[0]?.[0] as { action: string; changes: unknown[] };
    expect(row.action).toBe('credentialsDelivered');
    expect(row.changes).toEqual([
      { field: 'mode', old: null, new: 'initial' },
      { field: 'sms', old: null, new: 'sms down' },
      { field: 'email', old: null, new: 'sent' },
    ]);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(TOKEN);
  });

  it('both — a row for each transport used', async () => {
    sentOn(['sms', 'whatsapp']);
    const results = await deliverCredentials(INPUT);
    expect(results.map((row) => row.channel)).toEqual(['sms', 'whatsapp', 'email']);
  });

  it('hands WhatsApp the template’s wording and SMS the short one', async () => {
    await deliverCredentials(INPUT);
    const [phone, message] = text.sendTextMessage.mock.calls[0] as [
      string,
      { whatsapp: string; sms: string },
    ];
    expect(phone).toBe('01012345678');
    // The built-in bilingual wording, unchanged — both languages and the expiry.
    expect(message.whatsapp).toContain('اسم المستخدم: ahmed.mahmoud');
    expect(message.whatsapp).toContain('Username: ahmed.mahmoud');
    expect(message.whatsapp).toContain('2026-11-09 14:30 UTC');
    expect(message.whatsapp).toContain(setupLinkUrl(TOKEN));
    expect(message.sms).toBe(credentialsSmsText(INPUT));
  });

  it('with no phone, says so for each transport the settings name, and sends no text', async () => {
    text.configuredTransports.mockResolvedValue(['sms', 'whatsapp']);
    const results = await deliverCredentials({ ...INPUT, phone: null });
    expect(results).toEqual([
      { channel: 'sms', ok: false, detail: 'no phone number on file' },
      { channel: 'whatsapp', ok: false, detail: 'no phone number on file' },
      { channel: 'email', ok: true, detail: null },
    ]);
    expect(text.sendTextMessage).not.toHaveBeenCalled();
  });
});

describe('the SMS wording', () => {
  it('carries who they are and the one-time link, Arabic only', () => {
    const sms = credentialsSmsText(INPUT);
    expect(sms).toContain('ahmed.mahmoud');
    expect(sms).toContain('0100201');
    expect(sms).toContain(setupLinkUrl(TOKEN));
    expect(sms).toContain('لمرة واحدة');
    expect(sms).not.toMatch(/Username|Employee Code|expires/);
  });

  it('fits the link in a few parts — the bilingual wording takes several times more', async () => {
    await deliverCredentials(INPUT);
    const [, message] = text.sendTextMessage.mock.calls[0] as [
      string,
      { whatsapp: string; sms: string },
    ];
    expect(smsParts(message.sms)).toBeLessThanOrEqual(4);
    expect(smsParts(message.whatsapp)).toBeGreaterThan(2 * smsParts(message.sms));
  });

  it('says «—» for an account with no employee code', () => {
    expect(credentialsSmsText({ ...INPUT, employeeCode: null })).toContain('كود الموظف —');
  });
});
