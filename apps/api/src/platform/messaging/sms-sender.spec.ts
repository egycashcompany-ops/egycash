// `sendSms` against stubbed settings, secret store and transport. What is pinned: every reason a
// message cannot go is answered BEFORE any request — and before the token is opened when it could
// not be used anyway — with the reason the screen translates; the token is opened under the
// document's own context and handed to the transport, never anywhere else. Values are synthetic.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MessagingConfigView } from './messaging-config.store';

const transport = vi.hoisted(() => ({
  sendSmsThrough: vi.fn(),
  smsEndpointConfigured: vi.fn(),
}));
const store = vi.hoisted(() => ({ open: vi.fn() }));
const config = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('../../infrastructure/messaging/sms', () => transport);
vi.mock('../secrets', () => ({ getSecretStore: () => store }));
vi.mock('./messaging-config.store', () => ({
  loadMessagingConfig: config.load,
  smsTokenContext: (id: string) => `platform_messaging_config:${id}:smsToken`,
}));

const { sendSms, sendSmsWith } = await import('./sms-sender');

const ID = '66a1b2c3d4e5f60718293a4b';
const TOKEN = 'syn-etisalat-token-do-not-leak';
const REF = { provider: 'platformCrypto', keyId: 'k1', ref: { sealed: true } };

const view = (sms: Partial<MessagingConfigView['sms']> = {}): MessagingConfigView => ({
  id: ID,
  channel: 'sms',
  sms: {
    enabled: true,
    provider: 'etisalat',
    templateId: '12345',
    tokenRef: REF,
    tokenUpdatedAt: new Date('2026-11-08T08:00:00Z'),
    lastTest: null,
    ...sms,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  transport.smsEndpointConfigured.mockReturnValue(true);
  transport.sendSmsThrough.mockResolvedValue({ ok: true, detail: null });
  store.open.mockResolvedValue(TOKEN);
});

describe('what is refused before anything is sent', () => {
  it('SMS switched off', async () => {
    expect(await sendSmsWith(view({ enabled: false }), '01012345678', 'x')).toEqual({
      ok: false,
      detail: 'sms transport disabled',
    });
    expect(store.open).not.toHaveBeenCalled();
    expect(transport.sendSmsThrough).not.toHaveBeenCalled();
  });

  it('no endpoint configured', async () => {
    transport.smsEndpointConfigured.mockReturnValue(false);
    expect(await sendSmsWith(view(), '01012345678', 'x')).toEqual({
      ok: false,
      detail: 'sms endpoint not configured',
    });
    expect(store.open).not.toHaveBeenCalled();
    expect(transport.sendSmsThrough).not.toHaveBeenCalled();
  });

  it('no template id', async () => {
    expect(await sendSmsWith(view({ templateId: null }), '01012345678', 'x')).toEqual({
      ok: false,
      detail: 'sms template id not set',
    });
    expect(transport.sendSmsThrough).not.toHaveBeenCalled();
  });

  it('no token', async () => {
    expect(await sendSmsWith(view({ tokenRef: null }), '01012345678', 'x')).toEqual({
      ok: false,
      detail: 'sms token not set',
    });
    expect(store.open).not.toHaveBeenCalled();
    expect(transport.sendSmsThrough).not.toHaveBeenCalled();
  });

  it('a token that will not open — a reason, never an exception', async () => {
    store.open.mockRejectedValue(new Error('no key k1'));
    expect(await sendSmsWith(view(), '01012345678', 'x')).toEqual({
      ok: false,
      detail: 'sms token could not be opened',
    });
    expect(transport.sendSmsThrough).not.toHaveBeenCalled();
  });
});

describe('a send', () => {
  it('opens the token under the document’s context and hands it to the transport only', async () => {
    expect(await sendSmsWith(view(), '01012345678', 'نص الرسالة')).toEqual({
      ok: true,
      detail: null,
    });
    expect(store.open).toHaveBeenCalledWith(REF, `platform_messaging_config:${ID}:smsToken`);
    expect(transport.sendSmsThrough).toHaveBeenCalledWith(
      { provider: 'etisalat', templateId: '12345', token: TOKEN },
      '01012345678',
      'نص الرسالة',
    );
  });

  it('goes while switched off only for the test button', async () => {
    const off = view({ enabled: false });
    expect((await sendSmsWith(off, '01012345678', 'x', { evenIfDisabled: true })).ok).toBe(true);
    expect(transport.sendSmsThrough).toHaveBeenCalledTimes(1);
  });

  it('reads the settings as they stand now', async () => {
    config.load.mockResolvedValue(view({ enabled: false }));
    expect((await sendSms('01012345678', 'x')).detail).toBe('sms transport disabled');
  });

  it('answers a reason when the settings cannot be read', async () => {
    config.load.mockRejectedValue(new Error('mongo down'));
    expect(await sendSms('01012345678', 'x')).toEqual({
      ok: false,
      detail: 'messaging settings could not be read',
    });
    expect(transport.sendSmsThrough).not.toHaveBeenCalled();
  });
});
