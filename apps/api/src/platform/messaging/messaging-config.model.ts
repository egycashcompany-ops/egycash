// «الرسائل التلقائية» — how the automatic text messages travel. ONE document (`key: 'default'`),
// edited on /system/messaging.
//
// While no document exists the messages go exactly as they did before the screen existed: by
// WhatsApp, through the deployment's `WHATSAPP_*` environment (`DEFAULT_MESSAGE_CHANNEL`).
//
// `sms.tokenRef` is the platform secret store's SEALED ref, bound to this document's id
// (`platform_messaging_config:<id>:smsToken`), so a ref copied onto another record fails to open.
// It is never returned, logged or audited — the DTO says only `tokenSet` and `tokenUpdatedAt`.
//
// `sms.lastTest` is the test button's status line. It is written WITHOUT `__v` or `updatedAt`
// moving, as the ATM mailbox's `lastPoll` is: a test must never turn the screen's next save stale.
import { Schema, model } from 'mongoose';
import {
  DEFAULT_MESSAGE_CHANNEL,
  MESSAGE_CHANNELS,
  SMS_PROVIDERS,
  type MessageChannel,
  type SecretRef,
  type SmsProvider,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../shared/base/base.model';

/** The one document's key — a second document is a bug, and the unique index says so. */
export const MESSAGING_CONFIG_KEY = 'default';

/** One «إرسال رسالة تجريبية», as `sms.lastTest` keeps it (`SmsTestRunDto` with a Date). */
export interface SmsTestRunRecord {
  at: Date;
  ok: boolean;
  detail: string | null;
}

export interface SmsConfigRecord {
  enabled: boolean;
  provider: SmsProvider;
  templateId: string | null;
  tokenRef: SecretRef | null;
  tokenUpdatedAt: Date | null;
  lastTest: SmsTestRunRecord | null;
}

export interface MessagingConfigDoc extends BaseDocFields {
  key: string;
  channel: MessageChannel;
  sms: SmsConfigRecord;
}

// The secret store's ref, the mailbox's shape: `provider` and `keyId` in the clear for the
// rotation sweep, `ref` opaque to everyone but the store.
const secretRefSchema = new Schema(
  {
    provider: { type: String, required: true },
    keyId: { type: String, default: null },
    ref: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const testRunSchema = new Schema<SmsTestRunRecord>(
  {
    at: { type: Date, required: true },
    ok: { type: Boolean, required: true },
    detail: { type: String, default: null },
  },
  { _id: false },
);

const smsSchema = new Schema<SmsConfigRecord>(
  {
    enabled: { type: Boolean, required: true, default: false },
    provider: { type: String, enum: SMS_PROVIDERS, required: true, default: 'etisalat' },
    templateId: { type: String, default: null },
    tokenRef: { type: secretRefSchema, default: null },
    tokenUpdatedAt: { type: Date, default: null },
    lastTest: { type: testRunSchema, default: null },
  },
  { _id: false },
);

const messagingConfigSchema = new Schema<MessagingConfigDoc>(
  {
    key: { type: String, required: true, default: MESSAGING_CONFIG_KEY },
    channel: {
      type: String,
      enum: MESSAGE_CHANNELS,
      required: true,
      default: DEFAULT_MESSAGE_CHANNEL,
    },
    sms: { type: smsSchema, required: true, default: () => ({}) },
    ...baseFields,
  },
  baseSchemaOptions,
);

messagingConfigSchema.index(
  { key: 1 },
  { unique: true, name: 'ux_messaging_config_key', partialFilterExpression: { isDeleted: false } },
);

export const MessagingConfigModel = model<MessagingConfigDoc>(
  'MessagingConfig',
  messagingConfigSchema,
  'platform_messaging_config',
);
