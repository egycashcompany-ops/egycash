// The SMS transport against a stubbed `outboundFetch`. What is pinned: the wire format lives in
// ONE pure function and is the marked placeholder it says it is; no endpoint is guessed — with
// `ETISALAT_SMS_URL` empty nothing goes out at all; and neither the token nor the message ever
// reaches a log line or a returned reason. Every value below is synthetic.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetched: { url: string; init: RequestInit | undefined }[] = [];
let respond: () => Promise<Response> = async () => new Response(null, { status: 200 });

vi.mock('../http/outbound', () => ({
  outboundFetch: async (input: string | URL, init?: RequestInit) => {
    fetched.push({ url: String(input), init });
    return respond();
  },
}));

const logged = vi.hoisted(() => [] as unknown[]);
vi.mock('../logging/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => logged.push(args),
    info: (...args: unknown[]) => logged.push(args),
    error: (...args: unknown[]) => logged.push(args),
  },
}));

const { env } = await import('../config/env');
const { buildEtisalatRequest, parseEtisalatResponse, sendSmsThrough, smsEndpointConfigured } =
  await import('./sms');

const settings = env as unknown as { ETISALAT_SMS_URL: string };
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.syn-etisalat-token-do-not-leak.c2ln';
const BODY = 'كلمة المرور المؤقتة: Syn#Pass-7731';
const CONFIG = { provider: 'etisalat' as const, templateId: '12345', token: TOKEN };
const ENDPOINT = 'https://sms.example.test/api/send';

beforeEach(() => {
  fetched.length = 0;
  logged.length = 0;
  settings.ETISALAT_SMS_URL = '';
  respond = async () => new Response(null, { status: 200 });
});

afterEach(() => {
  settings.ETISALAT_SMS_URL = '';
});

describe('the endpoint is not guessed', () => {
  it('defaults to empty — the deployment says where to send, the code does not', () => {
    expect(smsEndpointConfigured()).toBe(false);
  });

  it('answers «sms endpoint not configured» and makes no request while it is empty', async () => {
    expect(await sendSmsThrough(CONFIG, '01012345678', BODY)).toEqual({
      ok: false,
      detail: 'sms endpoint not configured',
    });
    expect(fetched).toEqual([]);
  });

  it('names no production host anywhere in the transport', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'sms.ts'), 'utf8');
    expect(source).not.toMatch(/https?:\/\/[a-z0-9.-]*etisalat/i);
  });
});

describe('buildEtisalatRequest — the one wire-format function', () => {
  it('posts JSON to the configured URL, the token as a bearer header, msisdn without +', () => {
    settings.ETISALAT_SMS_URL = ENDPOINT;
    const { url, init } = buildEtisalatRequest({
      templateId: '12345',
      token: TOKEN,
      phone: '+201012345678',
      body: BODY,
    });
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    // `Body` after the template's `{Body}` script — case sensitive.
    expect(JSON.parse(String(init.body))).toEqual({
      templateId: '12345',
      msisdn: '201012345678',
      Body: BODY,
    });
  });

  it('is marked as a placeholder to confirm against the provider’s API page', () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'sms.ts'), 'utf8');
    const fn = source.slice(source.indexOf('export const buildEtisalatRequest'));
    const before = source.slice(0, source.indexOf('export const buildEtisalatRequest'));
    expect(before.slice(before.lastIndexOf('/**'))).toContain(
      'PLACEHOLDER, TO BE CONFIRMED AGAINST ETISALAT',
    );
    expect(fn.slice(0, fn.indexOf('\n});'))).toContain('PLACEHOLDER');
  });
});

describe('parseEtisalatResponse', () => {
  it('takes a 2xx as accepted', () => {
    expect(parseEtisalatResponse(200, { messageId: 'm1' })).toEqual({ ok: true, detail: null });
    expect(parseEtisalatResponse(202, null)).toEqual({ ok: true, detail: null });
  });

  it('takes a 2xx that says `success: false` as refused', () => {
    expect(parseEtisalatResponse(200, { success: false, code: 'E42' })).toEqual({
      ok: false,
      detail: 'etisalat responded 200 (E42)',
    });
  });

  it('names the status and the provider code, never the provider’s free text', () => {
    const refused = parseEtisalatResponse(401, {
      code: 401,
      message: `Body rejected: ${BODY}`,
    });
    expect(refused).toEqual({ ok: false, detail: 'etisalat responded 401 (401)' });
    expect(parseEtisalatResponse(500, 'gateway exploded')).toEqual({
      ok: false,
      detail: 'etisalat responded 500',
    });
  });
});

describe('sendSmsThrough', () => {
  it('refuses a number that is no phone number, before anything', async () => {
    settings.ETISALAT_SMS_URL = ENDPOINT;
    expect(await sendSmsThrough(CONFIG, 'abc', BODY)).toEqual({
      ok: false,
      detail: 'invalid phone number',
    });
    expect(fetched).toEqual([]);
  });

  it('sends the built request to the configured endpoint, the number in E.164', async () => {
    settings.ETISALAT_SMS_URL = ENDPOINT;
    respond = async () =>
      new Response(JSON.stringify({ id: 'syn-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    expect(await sendSmsThrough(CONFIG, '010 1234 5678', BODY)).toEqual({ ok: true, detail: null });
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.url).toBe(ENDPOINT);
    expect(JSON.parse(String(fetched[0]?.init?.body))).toMatchObject({ msisdn: '201012345678' });
    expect(fetched[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('turns a network failure into a reason, with neither the token nor the body logged', async () => {
    settings.ETISALAT_SMS_URL = ENDPOINT;
    respond = async () => {
      throw new Error(`connect failed for ${TOKEN}`);
    };
    const result = await sendSmsThrough(CONFIG, '01012345678', BODY);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('connect failed for [redacted]');
    const everything = JSON.stringify(logged);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(BODY);
  });

  it('logs a refusal by status only', async () => {
    settings.ETISALAT_SMS_URL = ENDPOINT;
    respond = async () => new Response(JSON.stringify({ code: 'E1' }), { status: 400 });
    expect(await sendSmsThrough(CONFIG, '01012345678', BODY)).toEqual({
      ok: false,
      detail: 'etisalat responded 400 (E1)',
    });
    const everything = JSON.stringify(logged);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(BODY);
  });
});
