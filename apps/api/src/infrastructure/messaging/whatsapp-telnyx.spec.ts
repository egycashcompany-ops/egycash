// The Telnyx WhatsApp driver, against Telnyx's published request shape (`POST /v2/messages/whatsapp`).
//
// What matters here is what leaves the process and what comes back to be STORED. A template sent
// with its variables in the wrong place is refused by Meta one employee at a time, and an error
// line that quotes the request would write a one-time setup link into the audit trail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({
  env: {
    LOG_LEVEL: 'info',
    WHATSAPP_PROVIDER: 'telnyx',
    WHATSAPP_API_TOKEN: 'KEY_test',
    WHATSAPP_ACCOUNT_ID: '',
    WHATSAPP_FROM_NUMBER: '+201000000001',
  },
  isTest: true,
  isProduction: false,
}));

const { outboundFetch } = vi.hoisted(() => ({ outboundFetch: vi.fn() }));
vi.mock('../http/outbound', () => ({ outboundFetch }));

const { env } = await import('../config/env');
const settings = env as unknown as Record<string, string>;
const { sendWhatsApp, telnyxMessageContent } = await import('./whatsapp');

const TOKEN = 'Xk3v9Qm2Lp7RtY5wZb8NcD4fGh6JsA1eXk3v9Qm2Lp7RtY5wZb8NcD4fGh6JsA1e';
const TEMPLATE = {
  name: 'ecms_account_activation',
  language: 'ar',
  bodyParams: ['e1024', 'E1024', '2026-11-03 08:00 UTC'],
  urlButtonParam: TOKEN,
};

const json = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** The request the driver made: URL, init, and the parsed JSON body. */
const lastRequest = (): { url: string; init: RequestInit; body: Record<string, unknown> } => {
  const [url, init] = outboundFetch.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
};

beforeEach(() => {
  outboundFetch.mockReset();
  outboundFetch.mockResolvedValue(json(200, { data: { id: 'msg-1', type: 'WHATSAPP' } }));
});

afterEach(() => {
  settings.WHATSAPP_PROVIDER = 'telnyx';
  settings.WHATSAPP_API_TOKEN = 'KEY_test';
  settings.WHATSAPP_ACCOUNT_ID = '';
  settings.WHATSAPP_FROM_NUMBER = '+201000000001';
});

describe('telnyx — the request', () => {
  it('sends the approved template, from the company number, to the employee in E.164', async () => {
    const result = await sendWhatsApp('010 1234 5678', 'the email text', { template: TEMPLATE });
    expect(result).toEqual({ ok: true, detail: null });

    const { url, init, body } = lastRequest();
    expect(url).toBe('https://api.telnyx.com/v2/messages/whatsapp');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer KEY_test');
    // A carrier that hangs must not hang account creation with it.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(body).toEqual({
      from: '+201000000001',
      to: '+201012345678',
      type: 'WHATSAPP',
      whatsapp_message: {
        type: 'template',
        template: {
          name: 'ecms_account_activation',
          language: { policy: 'deterministic', code: 'ar' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'e1024' },
                { type: 'text', text: 'E1024' },
                { type: 'text', text: '2026-11-03 08:00 UTC' },
              ],
            },
            // The token is the end of the button's URL — Meta approved the rest of it.
            {
              type: 'button',
              sub_type: 'url',
              index: 0,
              parameters: [{ type: 'text', text: TOKEN }],
            },
          ],
        },
      },
    });
  });

  it('never puts the composed text in a template message', async () => {
    await sendWhatsApp('01012345678', 'the email text', { template: TEMPLATE });
    expect(JSON.stringify(lastRequest().body)).not.toContain('the email text');
  });

  it('names the messaging profile when one is configured, and only then', async () => {
    settings.WHATSAPP_ACCOUNT_ID = '4001781e-626f-4a41-a914-b1b682150f94';
    await sendWhatsApp('01012345678', 'x', { template: TEMPLATE });
    expect(lastRequest().body.messaging_profile_id).toBe('4001781e-626f-4a41-a914-b1b682150f94');

    settings.WHATSAPP_ACCOUNT_ID = '';
    await sendWhatsApp('01012345678', 'x', { template: TEMPLATE });
    expect(lastRequest().body).not.toHaveProperty('messaging_profile_id');
  });

  it('falls back to plain text when no template is given', async () => {
    await sendWhatsApp('01012345678', 'hello there');
    expect(lastRequest().body.whatsapp_message).toEqual({
      type: 'text',
      text: { body: 'hello there' },
    });
  });

  it('leaves out the components a template does not use', () => {
    expect(
      telnyxMessageContent('x', { name: 'plain_notice', language: 'en', bodyParams: [] }),
    ).toEqual({
      type: 'template',
      template: { name: 'plain_notice', language: { policy: 'deterministic', code: 'en' } },
    });
  });
});

describe('telnyx — what comes back', () => {
  it('refuses to call Telnyx at all without a key or a sending number', async () => {
    settings.WHATSAPP_API_TOKEN = '';
    const noKey = await sendWhatsApp('01012345678', 'x', { template: TEMPLATE });
    settings.WHATSAPP_API_TOKEN = 'KEY_test';
    settings.WHATSAPP_FROM_NUMBER = '';
    const noNumber = await sendWhatsApp('01012345678', 'x', { template: TEMPLATE });

    expect(outboundFetch).not.toHaveBeenCalled();
    for (const result of [noKey, noNumber]) {
      expect(result.ok).toBe(false);
      expect(result.detail).toContain('telnyx is not configured');
    }
  });

  it("reports Telnyx's own code and title, so an administrator can act on it", async () => {
    outboundFetch.mockResolvedValue(
      json(400, {
        errors: [{ code: '40008', title: 'Template not found', detail: 'no such template' }],
      }),
    );
    const result = await sendWhatsApp('01012345678', 'x', { template: TEMPLATE });
    expect(result).toEqual({
      ok: false,
      detail: 'telnyx responded 400: 40008 — Template not found — no such template',
    });
  });

  it('cuts every value it sent out of the error before it is stored', async () => {
    // The detail lands on the account's delivery outcomes and in the audit trail. The request
    // carried the setup token; an error that quotes it must not carry it on into the database.
    outboundFetch.mockResolvedValue(
      json(422, {
        errors: [{ code: 10015, title: 'Bad parameter', detail: `parameter "${TOKEN}" refused` }],
      }),
    );
    const result = await sendWhatsApp('01012345678', 'x', { template: TEMPLATE });
    expect(result.ok).toBe(false);
    expect(result.detail).not.toContain(TOKEN);
    expect(result.detail).toContain('[redacted]');
  });

  it('still says something when the error body is not JSON', async () => {
    outboundFetch.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await sendWhatsApp('01012345678', 'x', { template: TEMPLATE })).toEqual({
      ok: false,
      detail: 'telnyx responded 502',
    });
  });

  it('turns a network failure or a timeout into an undelivered result, never a throw', async () => {
    outboundFetch.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const result = await sendWhatsApp('01012345678', 'x', { template: TEMPLATE });
    expect(result).toEqual({ ok: false, detail: 'The operation timed out.' });
  });

  it('rejects a phone number it cannot normalize before calling anyone', async () => {
    expect(await sendWhatsApp('abc', 'x', { template: TEMPLATE })).toEqual({
      ok: false,
      detail: 'invalid phone number',
    });
    expect(outboundFetch).not.toHaveBeenCalled();
  });
});

describe('the other drivers are untouched by templates', () => {
  it('meta still sends the plain body', async () => {
    settings.WHATSAPP_PROVIDER = 'meta';
    await sendWhatsApp('01012345678', 'the email text', { template: TEMPLATE });
    expect(lastRequest().body).toMatchObject({ type: 'text', text: { body: 'the email text' } });
  });
});

describe('the plain-text warning', () => {
  it('is said once per process, not once per message', async () => {
    vi.resetModules();
    const fresh = await import('./whatsapp');
    const { logger } = await import('../logging/logger');
    const warn = vi.spyOn(logger, 'warn');
    await fresh.sendWhatsApp('01012345678', 'one');
    await fresh.sendWhatsApp('01012345678', 'two');
    await fresh.sendWhatsApp('01012345678', 'three', { template: TEMPLATE });
    const plainText = warn.mock.calls.filter((call) => String(call[1]).includes('plain text'));
    expect(plainText).toHaveLength(1);
  });
});
