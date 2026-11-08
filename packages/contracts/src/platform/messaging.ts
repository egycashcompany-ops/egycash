// The automatic text messages — «الرسائل التلقائية» on /system/messaging.
//
// The owner (2026-11-08): «عايز أعمل Automation بدل واتساب يبقي SMS ممكن تشرحلى المطلوب ؟ وتجهز
// السيستم على كدا». The messages the system sends by itself to a person's mobile — login details
// and setup links, recruitment portal invitations, portal sign-in codes — go by SMS through
// Etisalat Egypt («etisalat by e&») instead of WhatsApp, or by both.
//
// Etisalat's portal gives two values for API use, and both are typed on the screen: a TEMPLATE ID
// (an "API" SMS template whose script is exactly `{Body}`, bound to an approved sender name) and a
// TOKEN generated per "Agent" (REST). The token is a secret: it only ever travels TOWARD the
// server, is sealed by the platform secret store before anything is written, and no answer, log
// line or audit row carries it — the DTO says only `tokenSet` and when it was set.
import { z } from 'zod';

/**
 * Which transport the automatic messages take. `both` sends on each and counts as delivered when
 * either one delivered — a person reached once is a person reached.
 */
export const MESSAGE_CHANNELS = ['sms', 'whatsapp', 'both'] as const;
export const MessageChannelSchema = z.enum(MESSAGE_CHANNELS);
export type MessageChannel = z.infer<typeof MessageChannelSchema>;

/** The two transports a channel resolves to. */
export const TEXT_TRANSPORTS = ['sms', 'whatsapp'] as const;
export type TextTransport = (typeof TEXT_TRANSPORTS)[number];

/**
 * The channel while nothing has been saved: WhatsApp, exactly as before the screen existed. A
 * deployment changes nothing until an administrator chooses SMS — which they do on the same page
 * where they enter the template and the token, so the switch costs no extra visit.
 */
export const DEFAULT_MESSAGE_CHANNEL: MessageChannel = 'whatsapp';

/** The transports one channel sends on, in the order they are tried. */
export const transportsOf = (channel: MessageChannel): TextTransport[] =>
  channel === 'both' ? ['sms', 'whatsapp'] : [channel];

/** SMS providers ECMS can drive. One today; another is a new entry plus its wire format. */
export const SMS_PROVIDERS = ['etisalat'] as const;
export const SmsProviderSchema = z.enum(SMS_PROVIDERS);
export type SmsProvider = z.infer<typeof SmsProviderSchema>;

/** What «إرسال رسالة تجريبية» sends — fixed and short: one SMS part, nobody's data in it. */
export const SMS_TEST_MESSAGE = 'رسالة تجريبية من نظام ECMS.';

/**
 * The reasons an SMS is not sent before any provider is asked, as the API words them. The screen
 * translates each into a sentence; anything else is the provider's own answer and is shown as is.
 */
export const SMS_FAILURE_DETAILS = {
  disabled: 'sms transport disabled',
  endpointNotConfigured: 'sms endpoint not configured',
  templateMissing: 'sms template id not set',
  tokenMissing: 'sms token not set',
  tokenUnreadable: 'sms token could not be opened',
  invalidPhone: 'invalid phone number',
} as const;
export type SmsFailureDetailKey = keyof typeof SMS_FAILURE_DETAILS;

/** The last «إرسال رسالة تجريبية»: when, whether it went, and the provider's or our reason. */
export interface SmsTestRunDto {
  at: string;
  ok: boolean;
  detail: string | null;
}

/** `GET /platform/messaging/settings` — never the token, sealed or plain. */
export interface MessagingSettingsDto {
  channel: MessageChannel;
  sms: {
    enabled: boolean;
    provider: SmsProvider;
    /** Etisalat's template id — digits; `null` until one is entered. */
    templateId: string | null;
    /** Whether a token is stored. The token itself is write-only. */
    tokenSet: boolean;
    /** When the stored token was entered; `null` while none is stored. */
    tokenUpdatedAt: string | null;
    /**
     * Whether the deployment knows where to send (`ETISALAT_SMS_URL`). False until the provider's
     * API page is in hand: every SMS then answers `sms endpoint not configured`, with no request
     * made — the screen says so before anybody tries.
     */
    endpointConfigured: boolean;
    lastTest: SmsTestRunDto | null;
  };
  whatsapp: {
    /** Whether the deployment's WhatsApp transport is set up (`WHATSAPP_PROVIDER` is not `disabled`). */
    configured: boolean;
  };
}

export const SMS_TEMPLATE_ID_MAX = 20;
export const SMS_TOKEN_MAX = 4096;

export const SmsTemplateIdSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{1,${String(SMS_TEMPLATE_ID_MAX)}}$`), 'digits only, at most 20');

/**
 * A token as typed. Never empty — an empty box on the screen means «keep the stored one» and is
 * simply not sent — and never with a space inside: a token is one word, and «Bearer eyJ…» pasted
 * whole is a mistake to refuse, not to store.
 */
export const SmsTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(SMS_TOKEN_MAX)
  .regex(/^\S+$/, 'one word, with no spaces');

/**
 * `PATCH /platform/messaging/settings` — only what changes. In `sms`, `token` OMITTED keeps the
 * stored token, a string REPLACES it and `null` CLEARS it; `templateId: null` clears the template.
 */
export const UpdateMessagingSettingsSchema = z
  .object({
    channel: MessageChannelSchema.optional(),
    sms: z
      .object({
        enabled: z.boolean().optional(),
        templateId: SmsTemplateIdSchema.nullable().optional(),
        token: SmsTokenSchema.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UpdateMessagingSettings = z.infer<typeof UpdateMessagingSettingsSchema>;
export type UpdateMessagingSettingsInput = z.input<typeof UpdateMessagingSettingsSchema>;

/** A mobile the test may go to: an Egyptian one (01xxxxxxxxx) or an international one (+…). */
export const SmsTestPhoneSchema = z
  .string()
  .trim()
  .regex(
    /^(?:01\d{9}|\+[1-9]\d{7,14})$/,
    'an Egyptian mobile (01xxxxxxxxx) or an international number (+…)',
  );

/** `POST /platform/messaging/sms/test` — the number to send «رسالة تجريبية» to. */
export const TestSmsSchema = z.object({ phone: SmsTestPhoneSchema }).strict();
export type TestSms = z.infer<typeof TestSmsSchema>;

/** The test's answer — the same run the settings' `lastTest` now holds. */
export type SmsTestResultDto = SmsTestRunDto;
