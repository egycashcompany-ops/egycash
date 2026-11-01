// WhatsApp transport (auth design §12 R9) behind one tiny interface. Provider-agnostic: `meta`
// (WhatsApp Cloud API), `twilio`, `telnyx`, or `disabled` (default — keeps dev/CI hermetic: logs a
// warning and reports not-delivered). Message bodies are never logged (they carry one-time links).
import { env } from '../config/env';
import { outboundFetch } from '../http/outbound';
import { logger } from '../logging/logger';

export interface WhatsAppSendResult {
  ok: boolean;
  detail: string | null;
}

/**
 * A WhatsApp message template Meta has approved, filled in for one send.
 *
 * WhatsApp lets a business START a conversation only with an approved template. Free text is
 * accepted only inside the 24 hours after the recipient last wrote to the business number — and a
 * new employee has never written to the company, so their setup link has to go out as a template
 * or it does not arrive at all.
 *
 * Only the `telnyx` driver reads it. `meta` and `twilio` send the plain `body`, as they always have.
 */
export interface WhatsAppTemplate {
  /** The template's name as registered with Meta (lowercase letters, digits, underscores). */
  name: string;
  /** Its language code as registered — `ar`, `en`, `en_US`. */
  language: string;
  /** Values for the body's {{1}}, {{2}}, … in that order. */
  bodyParams: readonly string[];
  /** The variable end of the template's first URL button, when it has one. */
  urlButtonParam?: string;
}

export interface WhatsAppSendOptions {
  /** Sent instead of `body` by the drivers that support templates (today: `telnyx`). */
  template?: WhatsAppTemplate | undefined;
  /**
   * What this message is (`activation`), for the logs — never its content. A plain-text warning
   * names it, so the line says WHICH flow went without a template.
   */
  purpose?: string;
  /**
   * Values that must never be stored, even quoted back by the provider — the setup token. Every
   * value sent is already cut out of a stored error; these are cut out wherever they appear, which
   * is what covers plain text, where the token is only a fragment of the body.
   */
  secrets?: readonly string[];
}

/** Normalize a local Egyptian mobile (01xxxxxxxxx) or an already-international number to E.164. */
export const toE164 = (phone: string): string | null => {
  const digits = phone.replace(/[^\d+]/g, '');
  if (/^\+\d{8,15}$/.test(digits)) return digits;
  if (/^00\d{8,15}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^01\d{9}$/.test(digits)) return `+2${digits}`;
  if (/^\d{8,15}$/.test(digits)) return `+${digits}`;
  return null;
};

const sendViaMeta = async (toPhone: string, body: string): Promise<WhatsAppSendResult> => {
  const res = await outboundFetch(
    `https://graph.facebook.com/v20.0/${env.WHATSAPP_ACCOUNT_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone.replace('+', ''),
        type: 'text',
        text: { body },
      }),
    },
  );
  if (!res.ok) return { ok: false, detail: `meta responded ${String(res.status)}` };
  return { ok: true, detail: null };
};

const sendViaTwilio = async (toPhone: string, body: string): Promise<WhatsAppSendResult> => {
  const sid = env.WHATSAPP_ACCOUNT_ID;
  const auth = Buffer.from(`${sid}:${env.WHATSAPP_API_TOKEN}`).toString('base64');
  const form = new URLSearchParams({
    From: `whatsapp:${env.WHATSAPP_FROM_NUMBER}`,
    To: `whatsapp:${toPhone}`,
    Body: body,
  });
  const res = await outboundFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    },
  );
  if (!res.ok) return { ok: false, detail: `twilio responded ${String(res.status)}` };
  return { ok: true, detail: null };
};

// ── Telnyx ─────────────────────────────────────────────────────────────────

export const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

/**
 * How long one send may take. Account creation waits on it, and the go-live backfill sends one
 * after another — a carrier that hangs must cost seconds, not the whole run.
 */
const TELNYX_TIMEOUT_MS = 15_000;

/** The `whatsapp_message` Telnyx expects: the template when one is given, plain text otherwise. */
export const telnyxMessageContent = (
  body: string,
  template: WhatsAppTemplate | undefined,
): Record<string, unknown> => {
  if (template === undefined) return { type: 'text', text: { body } };
  const components: Record<string, unknown>[] = [];
  if (template.bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: template.bodyParams.map((text) => ({ type: 'text', text })),
    });
  }
  if (template.urlButtonParam !== undefined) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: 0,
      parameters: [{ type: 'text', text: template.urlButtonParam }],
    });
  }
  return {
    type: 'template',
    template: {
      name: template.name,
      language: { policy: 'deterministic', code: template.language },
      ...(components.length > 0 ? { components } : {}),
    },
  };
};

/**
 * Cuts every value a request carried out of text the provider sent back — and, whatever was
 * listed, the value of any `token=` it quotes: a setup link echoed in some form nobody listed
 * (re-escaped, cut short, URL-encoded around the token) must still not carry its token onward.
 */
const redact = (text: string, secrets: readonly string[]): string =>
  secrets
    .filter((secret) => secret.length >= 4)
    .reduce((out, secret) => out.split(secret).join('[redacted]'), text)
    .replace(/([?&]token(?:=|%3D))[^\s&"'<>\\]+/gi, '$1[redacted]');

/**
 * A Telnyx error as one line an administrator can act on: its status, Telnyx's own code and title,
 * and its detail.
 *
 * The line is PERSISTED — it lands on the account's delivery outcomes and in the audit trail —
 * while the request it describes carried a one-time setup link. Telnyx's detail can quote the
 * parameters it refused, so every value that was sent is cut out of it before it leaves here.
 */
export const telnyxFailureDetail = async (
  res: Response,
  sent: readonly string[],
): Promise<string> => {
  const payload: unknown = await res.json().catch(() => null);
  const errors =
    typeof payload === 'object' && payload !== null
      ? (payload as { errors?: unknown }).errors
      : undefined;
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  const fields =
    typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : {};
  const reason = redact(
    [fields.code, fields.title, fields.detail]
      .filter((part) => typeof part === 'string' || typeof part === 'number')
      .map(String)
      .join(' — '),
    sent,
  ).slice(0, 300);
  const status = `telnyx responded ${String(res.status)}`;
  return reason === '' ? status : `${status}: ${reason}`;
};

const warnedPlainText = new Set<string>();

/**
 * Said once per process and purpose, not once per message: the go-live backfill sends hundreds,
 * and one line that names the problem is more use than hundreds that repeat it. Per PURPOSE, so
 * an applicant-portal message (which has no template yet) cannot use up the one line that would
 * have said the activation template is missing.
 */
const warnPlainTextOnce = (purpose: string | undefined): void => {
  const key = purpose ?? 'unlabelled';
  if (warnedPlainText.has(key)) return;
  warnedPlainText.add(key);
  logger.warn(
    { provider: 'telnyx', purpose: purpose ?? null },
    'whatsapp sent as plain text — WhatsApp delivers it only to someone who wrote to this number in the last 24 hours; this message needs an approved template',
  );
};

/**
 * `ok` means Telnyx ACCEPTED the message — the same promise the other drivers make. Whether it
 * reached the phone is reported later, to the webhook on the Telnyx messaging profile.
 */
const sendViaTelnyx = async (
  toPhone: string,
  body: string,
  options: WhatsAppSendOptions,
): Promise<WhatsAppSendResult> => {
  const { template } = options;
  const from = toE164(env.WHATSAPP_FROM_NUMBER);
  if (env.WHATSAPP_API_TOKEN === '' || from === null) {
    return {
      ok: false,
      detail: 'telnyx is not configured — set WHATSAPP_API_TOKEN and WHATSAPP_FROM_NUMBER',
    };
  }
  if (template === undefined) warnPlainTextOnce(options.purpose);
  const res = await outboundFetch(`${TELNYX_API_BASE}/messages/whatsapp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_API_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      from,
      to: toPhone,
      type: 'WHATSAPP',
      ...(env.WHATSAPP_ACCOUNT_ID === '' ? {} : { messaging_profile_id: env.WHATSAPP_ACCOUNT_ID }),
      whatsapp_message: telnyxMessageContent(body, template),
    }),
    signal: AbortSignal.timeout(TELNYX_TIMEOUT_MS),
  });
  if (!res.ok) {
    const sent = [
      ...(options.secrets ?? []),
      body,
      ...(template?.bodyParams ?? []),
      template?.urlButtonParam ?? '',
    ];
    return { ok: false, detail: await telnyxFailureDetail(res, sent) };
  }
  const accepted: unknown = await res.json().catch(() => null);
  const data =
    typeof accepted === 'object' && accepted !== null
      ? (accepted as { data?: { id?: unknown } }).data
      : undefined;
  // The message id is what the Telnyx portal is searched by. The recipient and the body are not
  // logged: one is personal data and the other carries the link.
  logger.info(
    {
      provider: 'telnyx',
      messageId: typeof data?.id === 'string' ? data.id : null,
      template: template?.name ?? null,
      purpose: options.purpose ?? null,
    },
    'whatsapp message accepted by telnyx',
  );
  return { ok: true, detail: null };
};

/**
 * Send a WhatsApp message. The body is transit-only and must never be logged. `options.template`
 * goes out instead of `body` where the provider supports templates.
 */
export const sendWhatsApp = async (
  phone: string,
  body: string,
  options: WhatsAppSendOptions = {},
): Promise<WhatsAppSendResult> => {
  const toPhone = toE164(phone);
  if (toPhone === null) return { ok: false, detail: 'invalid phone number' };
  try {
    switch (env.WHATSAPP_PROVIDER) {
      case 'meta':
        return await sendViaMeta(toPhone, body);
      case 'twilio':
        return await sendViaTwilio(toPhone, body);
      case 'telnyx':
        return await sendViaTelnyx(toPhone, body, options);
      default:
        logger.warn({ provider: 'disabled' }, 'whatsapp transport disabled — message not sent');
        return { ok: false, detail: 'whatsapp transport disabled' };
    }
  } catch (error) {
    // Provider/network errors surface as a delivery failure, never as an exception —
    // account provisioning must not fail because a carrier API is down (design R3).
    logger.warn({ err: error, provider: env.WHATSAPP_PROVIDER }, 'whatsapp send failed');
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
};
