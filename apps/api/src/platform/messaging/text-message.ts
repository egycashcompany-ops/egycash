// The automatic text messages' ONE door: `sendTextMessage` routes a message the way
// «الرسائل التلقائية» says — by SMS, by WhatsApp, or by both — and reports each transport it used.
//
// Its callers are the three messages the system sends by itself: login details and setup links
// (users/credentials-delivery.ts), the recruitment portal invitation (hr applicant-portal) and
// the portal sign-in code (auth.service.ts). None of them chooses a transport any more; each hands
// over its text — and, where the WhatsApp wording is long, a shorter SMS wording — and records
// what came back.
//
// `both` sends on each and counts as delivered when EITHER delivered. Never throws: a transport
// that is down is a delivery to record, not an exception that fails what the message is about.
import {
  DEFAULT_MESSAGE_CHANNEL,
  transportsOf,
  type MessageChannel,
  type TextTransport,
} from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import { sendWhatsApp } from '../../infrastructure/messaging/whatsapp';
import { loadMessagingConfig, type MessagingConfigView } from './messaging-config.store';
import { SETTINGS_UNREADABLE, sendSmsWith } from './sms-sender';

/**
 * One message: the same text for every transport, or a wording per transport. An Arabic SMS is
 * UCS-2 — 70 characters in one part, 67 a part once it is split — so a message that is long on
 * WhatsApp gives SMS a shorter wording that keeps what matters (the code, the link).
 */
export type TextMessage = string | { whatsapp: string; sms: string };

export interface TextDeliveryResult {
  channel: TextTransport;
  ok: boolean;
  detail: string | null;
}

export interface TextMessageResult {
  /** Delivered on at least one transport. */
  ok: boolean;
  /** `null` when delivered; otherwise each failed transport's reason. */
  detail: string | null;
  /** One row per transport used, in the order `transportsOf` gives. */
  results: TextDeliveryResult[];
}

const bodyFor = (message: TextMessage, transport: TextTransport): string =>
  typeof message === 'string' ? message : message[transport];

/** Pure: one answer from the per-transport rows. */
export const summarizeDeliveries = (results: readonly TextDeliveryResult[]): TextMessageResult => {
  const ok = results.some((row) => row.ok);
  const failed = results.filter((row) => !row.ok);
  let detail: string | null = null;
  if (!ok && failed.length === 1) detail = failed[0]?.detail ?? 'failed';
  if (!ok && failed.length > 1) {
    detail = failed.map((row) => `${row.channel}: ${row.detail ?? 'failed'}`).join('; ');
  }
  return { ok, detail, results: [...results] };
};

const sendOn = async (
  transport: TextTransport,
  config: MessagingConfigView,
  phone: string,
  message: TextMessage,
): Promise<TextDeliveryResult> => {
  const body = bodyFor(message, transport);
  const sent =
    transport === 'sms' ? await sendSmsWith(config, phone, body) : await sendWhatsApp(phone, body);
  return { channel: transport, ok: sent.ok, detail: sent.detail };
};

/** The settings, or `null` when they could not be read — nothing is sent on a guess. */
const readConfig = async (): Promise<MessagingConfigView | null> => {
  try {
    return await loadMessagingConfig();
  } catch (error) {
    logger.warn({ err: error }, 'messaging settings could not be read');
    return null;
  }
};

/** The channel the settings name now — the default while they cannot be read. */
export const configuredChannel = async (): Promise<MessageChannel> =>
  (await readConfig())?.channel ?? DEFAULT_MESSAGE_CHANNEL;

/** The transports a message would go on now — what a caller with no phone to send to reports. */
export const configuredTransports = async (): Promise<TextTransport[]> =>
  transportsOf(await configuredChannel());

/** Send one automatic text message. The body is transit-only and must never be logged. */
export const sendTextMessage = async (
  phone: string,
  message: TextMessage,
): Promise<TextMessageResult> => {
  const config = await readConfig();
  if (config === null) {
    return summarizeDeliveries(
      transportsOf(DEFAULT_MESSAGE_CHANNEL).map((channel) => ({
        channel,
        ok: false,
        detail: SETTINGS_UNREADABLE,
      })),
    );
  }
  const results = await Promise.all(
    transportsOf(config.channel).map((transport) => sendOn(transport, config, phone, message)),
  );
  return summarizeDeliveries(results);
};
