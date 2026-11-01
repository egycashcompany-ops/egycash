// The activation link on WhatsApp: sent as the approved template when one is configured, and never
// written down anywhere on the way (§14, R11/R12).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/config/env', () => ({
  env: {
    LOG_LEVEL: 'info',
    WEB_PUBLIC_URL: 'https://ecms.egycash.com.eg',
    WHATSAPP_ACTIVATION_TEMPLATE: 'ecms_account_activation',
    WHATSAPP_TEMPLATE_LANGUAGE: 'ar',
  },
  isTest: true,
  isProduction: false,
}));

const mocks = vi.hoisted(() => ({
  sendWhatsApp: vi.fn(),
  sendMail: vi.fn(),
  record: vi.fn(),
  findLatestByKey: vi.fn(),
}));
vi.mock('../../infrastructure/messaging/whatsapp', () => ({ sendWhatsApp: mocks.sendWhatsApp }));
vi.mock('../../infrastructure/email/mailer', () => ({ sendMail: mocks.sendMail }));
vi.mock('../audit', () => ({ auditService: { record: mocks.record } }));
vi.mock('../notifications/notification-template.repository', () => ({
  notificationTemplateRepository: { findLatestByKey: mocks.findLatestByKey },
}));

const { env } = await import('../../infrastructure/config/env');
const settings = env as unknown as Record<string, string>;
const { deliverCredentials } = await import('./credentials-delivery');

const TOKEN = 'tok_ZZZZ_one_time_secret_0123456789abcdef';
const INPUT = {
  userId: '64b7f1f1f1f1f1f1f1f1f1f1',
  username: 'e2001',
  employeeCode: 'E2001',
  phone: '01012345678',
  email: 'e2001@example.com',
  setupToken: TOKEN,
  expiresAt: new Date('2026-11-03T08:00:00.000Z'),
  mode: 'initial' as const,
};

beforeEach(() => {
  mocks.sendWhatsApp.mockReset().mockResolvedValue({ ok: true, detail: null });
  mocks.sendMail.mockReset().mockResolvedValue(undefined);
  mocks.record.mockReset().mockResolvedValue(undefined);
  mocks.findLatestByKey.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  settings.WHATSAPP_ACTIVATION_TEMPLATE = 'ecms_account_activation';
});

describe('the activation link on WhatsApp', () => {
  it('goes as the approved template, with the token as the button variable', async () => {
    const results = await deliverCredentials(INPUT);

    expect(mocks.sendWhatsApp).toHaveBeenCalledTimes(1);
    const [phone, , options] = mocks.sendWhatsApp.mock.calls[0] as [string, string, unknown];
    expect(phone).toBe('01012345678');
    expect(options).toEqual({
      template: {
        name: 'ecms_account_activation',
        language: 'ar',
        bodyParams: ['e2001', 'E2001', '2026-11-03 08:00 UTC'],
        urlButtonParam: TOKEN,
      },
    });
    expect(results).toContainEqual({ channel: 'whatsapp', ok: true, detail: null });
  });

  it('still hands the transport the composed text, for the drivers that send text', async () => {
    await deliverCredentials(INPUT);
    const [, body] = mocks.sendWhatsApp.mock.calls[0] as [string, string];
    expect(body).toContain('https://ecms.egycash.com.eg/activate?token=' + TOKEN);
  });

  it('goes as plain text when no template is configured', async () => {
    settings.WHATSAPP_ACTIVATION_TEMPLATE = '';
    await deliverCredentials(INPUT);
    const [, , options] = mocks.sendWhatsApp.mock.calls[0] as [
      string,
      string,
      { template?: unknown },
    ];
    expect(options.template).toBeUndefined();
  });

  it('records a refused send as undelivered — and the email still goes', async () => {
    mocks.sendWhatsApp.mockResolvedValue({
      ok: false,
      detail: 'telnyx responded 400: 40008 — Template not found',
    });
    const results = await deliverCredentials(INPUT);
    expect(results).toContainEqual({
      channel: 'whatsapp',
      ok: false,
      detail: 'telnyx responded 400: 40008 — Template not found',
    });
    expect(results).toContainEqual({ channel: 'email', ok: true, detail: null });
  });

  it('does not try WhatsApp without a phone number', async () => {
    const results = await deliverCredentials({ ...INPUT, phone: '  ' });
    expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
    expect(results).toContainEqual({
      channel: 'whatsapp',
      ok: false,
      detail: 'no phone number on file',
    });
  });

  it('never writes the token into the audit trail', async () => {
    await deliverCredentials(INPUT);
    expect(mocks.record).toHaveBeenCalled();
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain(TOKEN);
  });
});
