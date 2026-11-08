// Public surface of «الرسائل التلقائية» — the automatic text messages (SMS / WhatsApp / both).
// A caller sending a message imports `sendTextMessage`; nothing outside chooses a transport.
export {
  configuredChannel,
  configuredTransports,
  sendTextMessage,
  type TextDeliveryResult,
  type TextMessage,
  type TextMessageResult,
} from './text-message';
export { sendSms } from './sms-sender';
export { messagingService } from './messaging.service';
export { buildMessagingRouter } from './messaging.routes';
export { rotateSmsTokenKey } from './sms-token-rotation';
