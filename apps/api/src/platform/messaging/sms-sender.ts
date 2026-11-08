// `sendSms` — one SMS with the settings of «الرسائل التلقائية»: the switch, the template id and
// the token, opened from the secret store for this send only. The wire format is not here; it is
// `buildEtisalatRequest` in infrastructure/messaging/sms.ts, which this hands the opened token to.
//
// Every refusal below is answered BEFORE any request is made and before the token is opened when
// it could not be used anyway, each with the reason the screen translates (SMS_FAILURE_DETAILS).
// Never throws: a message that could not go is a delivery to record, not an exception.
import { SMS_FAILURE_DETAILS } from '@ecms/contracts';
import { logger } from '../../infrastructure/logging/logger';
import {
  sendSmsThrough,
  smsEndpointConfigured,
  type SmsSendResult,
} from '../../infrastructure/messaging/sms';
import { getSecretStore } from '../secrets';
import {
  loadMessagingConfig,
  smsTokenContext,
  type MessagingConfigView,
} from './messaging-config.store';

export interface SendSmsOptions {
  /**
   * The test button sends while SMS is still switched off: testing before switching on is the
   * point (the ATM mailbox's connection test, the same rule). Nothing else passes this.
   */
  evenIfDisabled?: boolean;
}

/** One SMS with the given settings — the seam the façade and the test button share. */
export const sendSmsWith = async (
  config: MessagingConfigView,
  phone: string,
  body: string,
  options: SendSmsOptions = {},
): Promise<SmsSendResult> => {
  const { sms } = config;
  if (!sms.enabled && options.evenIfDisabled !== true) {
    return { ok: false, detail: SMS_FAILURE_DETAILS.disabled };
  }
  if (!smsEndpointConfigured()) {
    return { ok: false, detail: SMS_FAILURE_DETAILS.endpointNotConfigured };
  }
  if (sms.templateId === null) return { ok: false, detail: SMS_FAILURE_DETAILS.templateMissing };
  if (sms.tokenRef === null || config.id === null) {
    return { ok: false, detail: SMS_FAILURE_DETAILS.tokenMissing };
  }

  let token: string;
  try {
    token = await getSecretStore().open(sms.tokenRef, smsTokenContext(config.id));
  } catch (error) {
    // The store's own reason (a retired key, a ref moved between records) — never the token.
    logger.warn(
      { error: error instanceof Error ? error.name : 'unknown' },
      'sms token could not be opened',
    );
    return { ok: false, detail: SMS_FAILURE_DETAILS.tokenUnreadable };
  }
  return sendSmsThrough({ provider: sms.provider, templateId: sms.templateId, token }, phone, body);
};

/** Why nothing went when the settings themselves could not be read. */
export const SETTINGS_UNREADABLE = 'messaging settings could not be read';

/** One SMS with the settings as they stand now. The body is transit-only and never logged. */
export const sendSms = async (
  phone: string,
  body: string,
  options: SendSmsOptions = {},
): Promise<SmsSendResult> => {
  let config: MessagingConfigView;
  try {
    config = await loadMessagingConfig();
  } catch (error) {
    logger.warn({ err: error }, 'messaging settings could not be read');
    return { ok: false, detail: SETTINGS_UNREADABLE };
  }
  return sendSmsWith(config, phone, body, options);
};
