// The automatic text messages' façade: `sms`, `whatsapp` and `both` each reach exactly the
// transports they name, with the wording meant for each; `both` is delivered when either one
// delivered; and nothing is sent on a guess when the settings cannot be read.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MessageChannel } from '@ecms/contracts';
import { type MessagingConfigView } from './messaging-config.store';

const config = vi.hoisted(() => ({ load: vi.fn() }));
const sms = vi.hoisted(() => ({ sendSmsWith: vi.fn() }));
const whatsapp = vi.hoisted(() => ({ sendWhatsApp: vi.fn() }));

vi.mock('./messaging-config.store', () => ({ loadMessagingConfig: config.load }));
vi.mock('./sms-sender', () => ({
  sendSmsWith: sms.sendSmsWith,
  SETTINGS_UNREADABLE: 'messaging settings could not be read',
}));
vi.mock('../../infrastructure/messaging/whatsapp', () => whatsapp);

const { configuredTransports, sendTextMessage, summarizeDeliveries } =
  await import('./text-message');

const view = (channel: MessageChannel): MessagingConfigView => ({
  id: '66a1b2c3d4e5f60718293a4b',
  channel,
  sms: {
    enabled: true,
    provider: 'etisalat',
    templateId: '12345',
    tokenRef: { provider: 'platformCrypto', keyId: 'k1', ref: {} },
    tokenUpdatedAt: null,
    lastTest: null,
  },
});

const MESSAGE = { whatsapp: 'نص واتساب الطويل', sms: 'نص قصير' };

beforeEach(() => {
  vi.clearAllMocks();
  sms.sendSmsWith.mockResolvedValue({ ok: true, detail: null });
  whatsapp.sendWhatsApp.mockResolvedValue({ ok: true, detail: null });
});

describe('routing by the configured channel', () => {
  it('sms — the SMS wording, by SMS only', async () => {
    config.load.mockResolvedValue(view('sms'));
    expect(await sendTextMessage('01012345678', MESSAGE)).toEqual({
      ok: true,
      detail: null,
      results: [{ channel: 'sms', ok: true, detail: null }],
    });
    expect(sms.sendSmsWith).toHaveBeenCalledWith(view('sms'), '01012345678', 'نص قصير');
    expect(whatsapp.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('whatsapp — the WhatsApp wording, by WhatsApp only', async () => {
    config.load.mockResolvedValue(view('whatsapp'));
    const sent = await sendTextMessage('01012345678', MESSAGE);
    expect(sent.results).toEqual([{ channel: 'whatsapp', ok: true, detail: null }]);
    expect(whatsapp.sendWhatsApp).toHaveBeenCalledWith('01012345678', 'نص واتساب الطويل');
    expect(sms.sendSmsWith).not.toHaveBeenCalled();
  });

  it('both — one row each, in order, each with its own wording', async () => {
    config.load.mockResolvedValue(view('both'));
    const sent = await sendTextMessage('01012345678', MESSAGE);
    expect(sent.results.map((row) => row.channel)).toEqual(['sms', 'whatsapp']);
    expect(sms.sendSmsWith).toHaveBeenCalledWith(view('both'), '01012345678', 'نص قصير');
    expect(whatsapp.sendWhatsApp).toHaveBeenCalledWith('01012345678', 'نص واتساب الطويل');
  });

  it('a single text goes unchanged on every transport', async () => {
    config.load.mockResolvedValue(view('both'));
    await sendTextMessage('01012345678', 'نص واحد');
    expect(sms.sendSmsWith).toHaveBeenCalledWith(view('both'), '01012345678', 'نص واحد');
    expect(whatsapp.sendWhatsApp).toHaveBeenCalledWith('01012345678', 'نص واحد');
  });
});

describe('what counts as delivered', () => {
  it('both — delivered when either one delivered', async () => {
    config.load.mockResolvedValue(view('both'));
    sms.sendSmsWith.mockResolvedValue({ ok: false, detail: 'sms endpoint not configured' });
    expect(await sendTextMessage('01012345678', MESSAGE)).toEqual({
      ok: true,
      detail: null,
      results: [
        { channel: 'sms', ok: false, detail: 'sms endpoint not configured' },
        { channel: 'whatsapp', ok: true, detail: null },
      ],
    });
  });

  it('both failing — each transport’s reason, named', async () => {
    config.load.mockResolvedValue(view('both'));
    sms.sendSmsWith.mockResolvedValue({ ok: false, detail: 'sms endpoint not configured' });
    whatsapp.sendWhatsApp.mockResolvedValue({ ok: false, detail: 'whatsapp transport disabled' });
    const sent = await sendTextMessage('01012345678', MESSAGE);
    expect(sent.ok).toBe(false);
    expect(sent.detail).toBe(
      'sms: sms endpoint not configured; whatsapp: whatsapp transport disabled',
    );
  });

  it('one transport failing — its reason as is', () => {
    expect(
      summarizeDeliveries([{ channel: 'sms', ok: false, detail: 'sms transport disabled' }]),
    ).toEqual({
      ok: false,
      detail: 'sms transport disabled',
      results: [{ channel: 'sms', ok: false, detail: 'sms transport disabled' }],
    });
  });
});

describe('when the settings cannot be read', () => {
  it('sends nothing and reports the default channel as not delivered', async () => {
    config.load.mockRejectedValue(new Error('mongo down'));
    expect(await sendTextMessage('01012345678', MESSAGE)).toEqual({
      ok: false,
      detail: 'messaging settings could not be read',
      results: [{ channel: 'whatsapp', ok: false, detail: 'messaging settings could not be read' }],
    });
    expect(sms.sendSmsWith).not.toHaveBeenCalled();
    expect(whatsapp.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('names the default channel’s transports for a caller with no phone to send to', async () => {
    config.load.mockRejectedValue(new Error('mongo down'));
    expect(await configuredTransports()).toEqual(['whatsapp']);
    config.load.mockResolvedValue(view('both'));
    expect(await configuredTransports()).toEqual(['sms', 'whatsapp']);
  });
});
