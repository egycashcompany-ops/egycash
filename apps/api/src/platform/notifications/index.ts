// Public surface of the notifications feature — nothing else is importable (ADR-003).
export { notificationsService, type NotifyInput, type NotifyOptions, type NotifyRecipients } from './notification.service';
export { registerNotificationJobHandlers } from './notification.delivery';
export { registerBuiltinChannelAdapters } from './notification.adapters';
export { registerNotificationSettings } from './notification.settings';
export { registerNotificationEventHandlers } from './notification.events';
export { ensureBuiltinNotificationTemplates } from './notification.seeds';
export { attachNotificationSocket } from './notification.socket';
export {
  buildNotificationPreferencesRouter,
  buildNotificationsRouter,
} from './notification.routes';
export { buildNotificationTemplatesRouter } from './notification-template.routes';
export { type NotificationDoc } from './notification.model';
export { type NotificationTemplateDoc } from './notification-template.model';
