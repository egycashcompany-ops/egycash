// SMS transport — Etisalat Egypt («etisalat by e&»), behind the same tiny interface as WhatsApp.
//
// The automatic text messages' façade (platform/messaging/text-message.ts) is the only caller,
// through platform/messaging's `sendSms`, which reads «الرسائل التلقائية»'s settings and opens the
// token. This file never reads a setting or a secret store itself (infrastructure imports only
// infrastructure and shared): it is handed the provider, the template id and the opened token.
//
// THE WIRE FORMAT IS ONE PLACE: `buildEtisalatRequest` (what goes out) and `parseEtisalatResponse`
// (what came back). Etisalat's portal gives a template id and a per-Agent REST token, but the
// request itself — endpoint, field names, how the token travels, the answer's shape — is on the
// provider's API page, which has not arrived yet. Until it does:
//   · no production endpoint is guessed: the URL is `ETISALAT_SMS_URL`, empty by default, and an
//     empty one answers `sms endpoint not configured` with no request made;
//   · the request below is a PLACEHOLDER, marked as such, to be confirmed field by field.
//
// The token and the message body are never logged, and never returned — the body carries
// passwords, setup links and sign-in codes.
import { SMS_FAILURE_DETAILS, type SmsProvider } from '@ecms/contracts';
import { env } from '../config/env';
import { outboundFetch } from '../http/outbound';
import { logger } from '../logging/logger';
import { toE164 } from './phone';

export interface SmsSendResult {
  ok: boolean;
  detail: string | null;
}

/** What the transport is handed for one send — the settings' values, the token already opened. */
export interface SmsProviderConfig {
  provider: SmsProvider;
  templateId: string;
  token: string;
}

/** Long enough for a slow carrier API, short enough that a hung one does not hold a sign-in. */
export const SMS_TIMEOUT_MS = 15_000;

/** Whether the deployment knows where to send. False until the provider's API page is in hand. */
export const smsEndpointConfigured = (): boolean => env.ETISALAT_SMS_URL.trim() !== '';

export interface EtisalatRequestInput {
  templateId: string;
  token: string;
  /** E.164, as `toE164` gives it (`+201012345678`). */
  phone: string;
  body: string;
}

/**
 * THE ETISALAT REQUEST — the one function to change when the provider's API page arrives.
 *
 * ⚠ PLACEHOLDER, TO BE CONFIRMED AGAINST ETISALAT'S API PAGE: the method, the header the token
 * travels in (`Authorization: Bearer` here), the body's encoding (JSON here) and its field names
 * (`templateId`, `msisdn` as digits without `+`, and `Body`, after the template's `{Body}` script —
 * case sensitive). Only the URL is not guessed: it is `ETISALAT_SMS_URL`, exactly as configured.
 */
export const buildEtisalatRequest = ({
  templateId,
  token,
  phone,
  body,
}: EtisalatRequestInput): { url: string; init: RequestInit } => ({
  url: env.ETISALAT_SMS_URL.trim(),
  init: {
    method: 'POST',
    headers: {
      // PLACEHOLDER — to be confirmed against Etisalat's API page.
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // PLACEHOLDER — to be confirmed against Etisalat's API page.
    body: JSON.stringify({ templateId, msisdn: phone.replace(/^\+/, ''), Body: body }),
  },
});

/** A provider code, as short and as plain as one is: never free text, which may echo the message. */
const providerCode = (payload: unknown): string | null => {
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['code', 'errorCode', 'statusCode', 'status']) {
    const value = record[key];
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,40}$/.test(value)) return value;
  }
  return null;
};

/**
 * THE ETISALAT ANSWER — the other half of the wire format, as pure as the first.
 *
 * ⚠ PLACEHOLDER, TO BE CONFIRMED AGAINST ETISALAT'S API PAGE: a 2xx is taken as accepted unless
 * the answer says `success: false`; anything else is a failure naming the status and the
 * provider's code. The answer's free text is NOT quoted — a carrier echoing a refused message
 * would put a password or a sign-in code on a screen and into the audit trail.
 */
export const parseEtisalatResponse = (status: number, payload: unknown): SmsSendResult => {
  const code = providerCode(payload);
  const refused =
    payload !== null &&
    typeof payload === 'object' &&
    (payload as Record<string, unknown>).success === false;
  if (status >= 200 && status < 300 && !refused) return { ok: true, detail: null };
  return {
    ok: false,
    detail: `etisalat responded ${String(status)}${code === null ? '' : ` (${code})`}`,
  };
};

/** The answer's body as JSON when it is JSON, as text otherwise, `null` when there is none. */
const readPayload = async (res: Response): Promise<unknown> => {
  const text = await res.text().catch(() => '');
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/** A reason with the token taken out — should a future wire format carry it somewhere quotable. */
const withoutToken = (detail: string, token: string): string =>
  token === '' ? detail : detail.split(token).join('[redacted]');

/**
 * Send one SMS. Never throws: a carrier that is down is a failed delivery to record, not an
 * exception that fails issuing an account (design R3). The body is transit-only.
 */
export const sendSmsThrough = async (
  config: SmsProviderConfig,
  phone: string,
  body: string,
): Promise<SmsSendResult> => {
  const toPhone = toE164(phone);
  if (toPhone === null) return { ok: false, detail: SMS_FAILURE_DETAILS.invalidPhone };
  if (!smsEndpointConfigured()) {
    return { ok: false, detail: SMS_FAILURE_DETAILS.endpointNotConfigured };
  }
  try {
    const { url, init } = buildEtisalatRequest({
      templateId: config.templateId,
      token: config.token,
      phone: toPhone,
      body,
    });
    const res = await outboundFetch(url, { ...init, signal: AbortSignal.timeout(SMS_TIMEOUT_MS) });
    const result = parseEtisalatResponse(res.status, await readPayload(res));
    if (!result.ok) logger.warn({ provider: config.provider, status: res.status }, 'sms refused');
    return result;
  } catch (error) {
    // The error's NAME only: a fetch failure can carry the request it failed on.
    logger.warn(
      { provider: config.provider, error: error instanceof Error ? error.name : 'unknown' },
      'sms send failed',
    );
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: withoutToken(detail, config.token) };
  }
};
