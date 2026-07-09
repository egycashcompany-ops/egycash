// In-app channel: delivery IS the Notification document (already created by the time
// this runs, synchronously, inside `notify()` — Sprint 3.3 plan §2 step 3). This
// adapter's only job is the live push; a missed push is not a lost notification, the
// persisted inbox is the delivery guarantee.
import { type ChannelAdapter } from './channel-adapter';
import { emitNotificationEvent } from '../notification.socket';
import { toNotificationDto } from '../notification.mapper';

export const inAppChannelAdapter: ChannelAdapter = {
  id: 'inApp',
  send: (notification) => {
    emitNotificationEvent(
      String(notification.recipientUserId),
      'notification:new',
      toNotificationDto(notification),
    );
    return Promise.resolve({ ok: true });
  },
};

export const emitNotificationRead = (recipientUserId: string, notificationId: string): void => {
  emitNotificationEvent(recipientUserId, 'notification:read', { id: notificationId });
};
