// WhatsApp transport (auth design §12 R9) behind one tiny interface — the credentials
// delivery service is the only caller. Provider-agnostic: `meta` (WhatsApp Cloud API),
// `twilio`, or `disabled` (default — keeps dev/CI hermetic: logs a warning and reports
// not-delivered). Message bodies are never logged (they carry temporary passwords).
import { env } from '../config/env';
import { logger } from '../logging/logger';

export interface WhatsAppSendResult {
  ok: boolean;
  detail: string | null;
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
  const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_ACCOUNT_ID}/messages`, {
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
  });
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
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  if (!res.ok) return { ok: false, detail: `twilio responded ${String(res.status)}` };
  return { ok: true, detail: null };
};

/** Send a WhatsApp text message. The body is transit-only and must never be logged. */
export const sendWhatsApp = async (phone: string, body: string): Promise<WhatsAppSendResult> => {
  const toPhone = toE164(phone);
  if (toPhone === null) return { ok: false, detail: 'invalid phone number' };
  try {
    switch (env.WHATSAPP_PROVIDER) {
      case 'meta':
        return await sendViaMeta(toPhone, body);
      case 'twilio':
        return await sendViaTwilio(toPhone, body);
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
