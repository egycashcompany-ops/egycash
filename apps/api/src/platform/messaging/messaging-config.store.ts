// How the automatic text messages travel RIGHT NOW — the document as every send reads it.
//
// Read on every send, so a save on /system/messaging takes effect on the next message without a
// restart; cached for a few seconds, because a burst of sends (an import issuing fifty accounts)
// must not be fifty reads of a document that did not change. A save in THIS process clears the
// cache at once; another process (the worker) catches up within `MESSAGING_CONFIG_TTL_MS`.
import { DEFAULT_MESSAGE_CHANNEL, type MessageChannel } from '@ecms/contracts';
import { type MessagingConfigDoc, type SmsConfigRecord } from './messaging-config.model';
import { messagingConfigRepository } from './messaging-config.repository';

/** The AAD context the SMS token is sealed under: the record and the field (platform/crypto). */
export const smsTokenContext = (id: string): string => `platform_messaging_config:${id}:smsToken`;

/** The settings as a send reads them — the document, or the defaults while there is none. */
export interface MessagingConfigView {
  /** The document's id; `null` while none exists. A stored token is always bound to one. */
  id: string | null;
  channel: MessageChannel;
  sms: SmsConfigRecord;
}

const DEFAULT_SMS: SmsConfigRecord = {
  enabled: false,
  provider: 'etisalat',
  templateId: null,
  tokenRef: null,
  tokenUpdatedAt: null,
  lastTest: null,
};

/** Pure: the document as a send reads it; no document reads as the defaults. */
export const messagingConfigViewOf = (doc: MessagingConfigDoc | null): MessagingConfigView =>
  doc === null
    ? { id: null, channel: DEFAULT_MESSAGE_CHANNEL, sms: { ...DEFAULT_SMS } }
    : {
        id: String(doc._id),
        channel: doc.channel,
        sms: {
          enabled: doc.sms.enabled,
          provider: doc.sms.provider,
          templateId: doc.sms.templateId ?? null,
          tokenRef: doc.sms.tokenRef ?? null,
          tokenUpdatedAt: doc.sms.tokenUpdatedAt ?? null,
          lastTest: doc.sms.lastTest ?? null,
        },
      };

export const MESSAGING_CONFIG_TTL_MS = 30_000;

let cached: { at: number; view: MessagingConfigView } | null = null;

/** The settings every send reads — at most `MESSAGING_CONFIG_TTL_MS` old. */
export const loadMessagingConfig = async (now = Date.now()): Promise<MessagingConfigView> => {
  if (cached !== null && now - cached.at < MESSAGING_CONFIG_TTL_MS) return cached.view;
  const view = messagingConfigViewOf(await messagingConfigRepository.findSingleton());
  cached = { at: now, view };
  return view;
};

/** After a save, a test or a re-wrap: the next send reads the document again. */
export const invalidateMessagingConfig = (): void => {
  cached = null;
};
