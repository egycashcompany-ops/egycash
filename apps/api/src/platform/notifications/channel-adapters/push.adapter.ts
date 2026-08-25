// Web Push channel: the browser's own notification, on a device that is not looking at ECMS.
//
// Runs in the worker from the `notifications.deliver` job, exactly like email. What it sends is
// ENCRYPTED to the device's own keys before it leaves this process — neither Google's nor
// Mozilla's push service can read it, which is what makes it acceptable to put the real title and
// body in the payload rather than a "you have a notification" stub the user has to go and decode.
//
// ONE RECIPIENT, MANY DEVICES. A person's laptop and phone are two subscriptions and both should
// buzz, so this fans out. It reports success when ANY device took it: a phone that has been off
// for a week must not turn a delivered laptop notification into a retry, and eventually a failure,
// on a notification the person has already read.
//
// DEAD DEVICES ARE DELETED, NOT RETRIED. 404 and 410 are the push services' way of saying an
// endpoint is gone for good — the browser was uninstalled, the site data cleared, the permission
// revoked. Keeping those rows means every future send to that person fails a little, forever.
import webpush, { type WebPushError } from 'web-push';
import { logger } from '../../../infrastructure/logging/logger';
import { userService } from '../../users';
import { type ChannelAdapter } from './channel-adapter';
import { isPushConfigured } from '../push-config';
import { isGoneEndpoint, pushDeliverySucceeded } from '../push-eligibility';
import { pushSubscriptionRepository } from '../push-subscription.repository';
import { type NotificationDoc } from '../notification.model';
import { type RenderedTemplate } from '../notification.rendering';

/** What the service worker receives and turns into `showNotification`. */
export interface PushPayload {
  title: string;
  body: string;
  notificationId: string;
  /** Where clicking it should land — the entity the notification is about, when there is one. */
  url: string;
  category: string;
  priority: string;
}

/**
 * The payload, in the recipient's own language.
 *
 * A push is read on a lock screen with no chance to switch language, so it is rendered once, for
 * them, the same way the email adapter picks its side of the bilingual body.
 */
export const buildPushPayload = (
  notification: NotificationDoc,
  rendered: RenderedTemplate,
  locale: 'ar' | 'en',
): PushPayload => ({
  title: rendered.subject?.[locale] ?? rendered.body[locale],
  body: rendered.body[locale],
  notificationId: String(notification._id),
  url: '/',
  category: notification.category,
  priority: notification.priority,
});

export const pushChannelAdapter: ChannelAdapter = {
  id: 'push',
  send: async (notification, rendered) => {
    if (!isPushConfigured()) {
      // Reachable only if a deployment loses its keys between `notify()` and delivery — the
      // capability check keeps a push row off the notification otherwise.
      return { ok: false, error: 'push is not configured on this deployment' };
    }

    const userId = String(notification.recipientUserId);
    const subscriptions = await pushSubscriptionRepository.listForUser(userId);
    if (subscriptions.length === 0) {
      return { ok: false, error: 'recipient has no registered device' };
    }

    let locale: 'ar' | 'en' = 'ar';
    try {
      const user = await userService.getById(userId);
      locale = user.locale === 'en' ? 'en' : 'ar';
    } catch {
      // A recipient whose account has gone is not worth failing the delivery over; the default
      // language still produces a correct notification.
    }

    const payload = JSON.stringify(buildPushPayload(notification, rendered, locale));
    const now = new Date();
    const perDevice: boolean[] = [];
    const errors: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
          },
          payload,
          // `critical` is the one priority worth waking a dozing device for; everything else can
          // wait for the next time it checks in, which is easier on the battery.
          { urgency: notification.priority === 'critical' ? 'high' : 'normal' },
        );
        perDevice.push(true);
        await pushSubscriptionRepository.recordSuccess(subscription.endpoint, now);
      } catch (error) {
        perDevice.push(false);
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        if (isGoneEndpoint((error as WebPushError | undefined)?.statusCode)) {
          await pushSubscriptionRepository.removeByEndpoint(subscription.endpoint);
          logger.info({ userId }, 'push endpoint gone — registration removed');
          continue;
        }
        const kept = await pushSubscriptionRepository.recordFailure(subscription.endpoint);
        if (!kept) logger.warn({ userId }, 'push endpoint failing repeatedly — registration removed');
      }
    }

    if (pushDeliverySucceeded(perDevice)) return { ok: true };
    return { ok: false, error: errors[0] ?? 'no device accepted the push' };
  },
};
