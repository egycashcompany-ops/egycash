// Pure helpers for «الرسائل التلقائية»: the form's draft, the save it sends, and the reasons an
// SMS did not go, said as a sentence.
import {
  SMS_FAILURE_DETAILS,
  SmsTemplateIdSchema,
  SmsTestPhoneSchema,
  SmsTokenSchema,
  type MessageChannel,
  type MessagingSettingsDto,
  type SmsFailureDetailKey,
  type UpdateMessagingSettingsInput,
} from '@ecms/contracts';

export interface MessagingDraft {
  channel: MessageChannel;
  smsEnabled: boolean;
  templateId: string;
  /** Typed only to REPLACE the stored token; never filled from the server. */
  token: string;
  /** «إزالة» pressed: the save clears the stored token. */
  clearToken: boolean;
}

export const messagingDraftOf = (settings: MessagingSettingsDto): MessagingDraft => ({
  channel: settings.channel,
  smsEnabled: settings.sms.enabled,
  templateId: settings.sms.templateId ?? '',
  token: '',
  clearToken: false,
});

/** What the save compares — a token of blanks is no token, as the schema reads it. */
export const draftSignature = (draft: MessagingDraft): string =>
  JSON.stringify({ ...draft, templateId: draft.templateId.trim(), token: draft.token.trim() });

/**
 * The PATCH body: only what differs from what is stored. The token only when one was typed (an
 * empty box keeps the stored one), `null` when «إزالة» was pressed and nothing typed instead.
 */
export const messagingPatchBody = (
  stored: MessagingSettingsDto,
  draft: MessagingDraft,
): UpdateMessagingSettingsInput => {
  const sms: NonNullable<UpdateMessagingSettingsInput['sms']> = {};
  if (draft.smsEnabled !== stored.sms.enabled) sms.enabled = draft.smsEnabled;
  const templateId = draft.templateId.trim() === '' ? null : draft.templateId.trim();
  if (templateId !== stored.sms.templateId) sms.templateId = templateId;
  const token = draft.token.trim();
  if (token !== '') sms.token = token;
  else if (draft.clearToken && stored.sms.tokenSet) sms.token = null;
  return {
    ...(draft.channel === stored.channel ? {} : { channel: draft.channel }),
    ...(Object.keys(sms).length === 0 ? {} : { sms }),
  };
};

/** Will a token be stored once this draft is saved? */
export const tokenAfterSave = (stored: MessagingSettingsDto, draft: MessagingDraft): boolean =>
  draft.token.trim() !== '' || (stored.sms.tokenSet && !draft.clearToken);

/** The contract's own rules for the two boxes — not a copy of them. */
export const templateIdValid = (value: string): boolean =>
  value.trim() === '' || SmsTemplateIdSchema.safeParse(value).success;
export const tokenValid = (value: string): boolean =>
  value.trim() === '' || SmsTokenSchema.safeParse(value).success;
export const testPhoneValid = (value: string): boolean =>
  SmsTestPhoneSchema.safeParse(value).success;

const DETAIL_KEYS = new Map<string, SmsFailureDetailKey>(
  (Object.entries(SMS_FAILURE_DETAILS) as [SmsFailureDetailKey, string][]).map(([key, text]) => [
    text,
    key,
  ]),
);

/**
 * The i18n key for a reason the API words itself (`sms endpoint not configured` …), or `null` for
 * the provider's own answer, which is shown as it came.
 */
export const smsDetailKey = (detail: string | null): string | null => {
  if (detail === null) return null;
  const key = DETAIL_KEYS.get(detail);
  return key === undefined ? null : `systemAdmin.messaging.detail.${key}`;
};
