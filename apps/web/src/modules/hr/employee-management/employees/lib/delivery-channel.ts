// The label for each way a setup link went — SMS and WhatsApp are the text transports
// «الرسائل التلقائية» chooses between, email always rides beside them. A record keyed on the
// contract's union, so a channel added there cannot reach the screen without a label.
import { type CredentialsDeliveryChannel } from '@ecms/contracts';

export const DELIVERY_CHANNEL_LABEL_KEYS: Record<CredentialsDeliveryChannel, string> = {
  sms: 'employees.account.channelSms',
  whatsapp: 'employees.account.channelWhatsapp',
  email: 'employees.account.channelEmail',
};
