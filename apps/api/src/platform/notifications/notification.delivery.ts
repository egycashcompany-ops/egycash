// The delivery job handlers (Sprint 3.3 plan §2/§2a/§2c/§2d/§3d) — run in the worker.
// Retry is self-managed (a payload `attempt` counter + explicit re-enqueue with
// exponential backoff) rather than relying on BullMQ's own throw-based retry, so the
// handler can positively detect "this was the final attempt" without needing the raw
// BullMQ job object (the shared `JobHandler` type only carries `(data, jobName)`).
import { registerJobHandler } from '../../infrastructure/queue/jobs';
import { logger } from '../../infrastructure/logging/logger';
import { isExpired } from './notification.expiry';
import { computeQuietHoursDeferralMs } from './notification.quiet-hours';
import { getChannelAdapter } from './channel-adapters/channel-adapter';
import { notificationPreferenceRepository } from './notification-preference.repository';
import { notificationRepository } from './notification.repository';
import {
  DELIVER_JOB,
  MAX_DELIVERY_ATTEMPTS,
  SCHEDULED_SEND_JOB,
  computeDeliveryBackoffMs,
  deserializeScheduledPayload,
  notificationsService,
} from './notification.service';

interface DeliverPayload {
  notificationId: string;
  channel: string;
  attempt: number;
}

const handleDeliver = async (raw: unknown): Promise<void> => {
  const { notificationId, channel, attempt } = raw as DeliverPayload;
  const doc = await notificationRepository.findAnyById(notificationId);
  if (doc === null) return; // deleted/purged before delivery — nothing to do

  const channelState = doc.channels.find((c) => c.channel === channel);
  if (channelState === undefined) return;
  // Idempotency (§2a, layer 3): a re-attempted job is a no-op once past `queued`.
  if (channelState.status !== 'queued') return;

  const now = new Date();

  if (doc.priority !== 'critical') {
    const quietHours = await notificationPreferenceRepository.getQuietHours(
      String(doc.recipientUserId),
    );
    if (quietHours !== null) {
      const deferral = computeQuietHoursDeferralMs(now, quietHours);
      if (deferral !== null) {
        await notificationsService.enqueueDelivery(doc, channel, attempt, now);
        return; // still `queued` — no status transition, no audit row
      }
    }
  }

  if (isExpired(doc.expiresAt, now)) {
    await notificationsService.transitionChannel(doc._id, channel, 'cancelled', now);
    return;
  }

  await notificationsService.transitionChannel(doc._id, channel, 'processing', now);

  const adapter = getChannelAdapter(channel);
  if (adapter === undefined) {
    const error = `no channel adapter registered for "${channel}"`;
    await notificationsService.transitionChannel(doc._id, channel, 'failed', new Date(), { error });
    await notificationsService.emitDeliveryFailed(doc, channel, error);
    return;
  }

  const result = await adapter.send(doc, { subject: doc.title, body: doc.body });
  if (result.ok) {
    await notificationsService.transitionChannel(doc._id, channel, 'sent', new Date(), {
      sentAt: new Date(),
    });
    return;
  }

  const error = result.error ?? 'delivery failed';
  if (attempt < MAX_DELIVERY_ATTEMPTS) {
    logger.warn({ notificationId, channel, attempt, error }, 'delivery failed — retrying');
    // Retry is self-managed via re-enqueue (file header). Status intentionally stays
    // `processing` across the retry sequence — matching §3b's diagram exactly (no
    // undocumented `processing → queued` edge) — and doubles as the idempotency guard:
    // a duplicate/concurrent job attempt sees a non-`queued` status and no-ops.
    await notificationsService.enqueueDelivery(
      doc,
      channel,
      attempt + 1,
      new Date(),
      computeDeliveryBackoffMs(attempt),
    );
    return;
  }

  await notificationsService.transitionChannel(doc._id, channel, 'failed', new Date(), { error });
  await notificationsService.emitDeliveryFailed(doc, channel, error);
};

export const registerNotificationJobHandlers = (): void => {
  registerJobHandler('notifications', DELIVER_JOB, handleDeliver);

  registerJobHandler('notifications', SCHEDULED_SEND_JOB, async (data) => {
    const { input, options } = deserializeScheduledPayload(data);
    await notificationsService.notify(input, options);
  });
};
