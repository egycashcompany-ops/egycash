// The Web Push channel's decisions, as pure functions — no database, no push service, no adapter.
//
// They live here rather than inline in the two places that take them because each one has a
// consequence that is invisible where it is used and expensive when it is wrong, and because a
// rule stated inside a private method or a `catch` block can only be tested through the thing
// around it. This is the same split `notification.quiet-hours` and `filter-eval` already use.
import { type NotificationChannel } from '@ecms/contracts';

/**
 * Whether a push service has disowned an endpoint for good.
 *
 * 404 and 410 mean the subscription is gone — the browser was uninstalled, its site data cleared,
 * the permission revoked. Those rows are deleted on sight, because keeping them means every later
 * send to that person fails a little, forever.
 *
 * EVERYTHING ELSE IS SOFT. A 503 from the push service, a timeout, a phone that has been off since
 * Friday — deleting a live device over any of those loses a real person's notifications for good,
 * and the only way they would find out is by noticing they had stopped arriving.
 */
export const isGoneEndpoint = (statusCode: number | undefined): boolean =>
  statusCode === 404 || statusCode === 410;

/**
 * Whether a notification should carry a push channel for this recipient at all.
 *
 * ASKED BEFORE ANY PREFERENCE IS, and that order is the whole point. Push is the first channel
 * with a CAPABILITY question — it reaches a registered browser, and a recipient with none has
 * nowhere for it to go. A preference row cannot answer that: somebody who enabled push on a
 * laptop and then removed it still has `enabled: true` on record, and honouring it would put a
 * push row on every notification they receive — delivering nothing, retrying five times, and
 * settling on `failed` with a `deliveryFailed` event, for a notification they read in the app an
 * hour earlier. Across a company-wide announcement that is thousands of them.
 *
 * Answering it here means the channel simply is not created, which is the same quiet shape an
 * opt-out produces.
 *
 * `preference` is `null` when the recipient has no row — the default is to allow, as it is for
 * every other channel.
 */
export const shouldOfferPush = (params: {
  configured: boolean;
  hasDevice: boolean;
  preference: boolean | null;
}): boolean => {
  if (!params.configured) return false;
  if (!params.hasDevice) return false;
  return params.preference ?? true;
};

/**
 * Whether a fan-out across one recipient's devices counts as delivered.
 *
 * ANY device is enough. A person's laptop and phone are separate subscriptions, and reporting
 * failure because the phone has been off would earn a retry that re-pushes to the laptop that
 * already buzzed — five times, at widening intervals, for one notification.
 */
export const pushDeliverySucceeded = (perDevice: readonly boolean[]): boolean =>
  perDevice.some((ok) => ok);

/** The channel this module is about, named once so the string is not spelled in four files. */
export const PUSH_CHANNEL: NotificationChannel = 'push';
