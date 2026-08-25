// Data access for registered browsers. A leaf: no service imports, so the channel adapter and the
// notify() capability check can both read it without a cycle.
import { Types } from 'mongoose';
import { PushSubscriptionModel, type PushSubscriptionDoc } from './push-subscription.model';

/** Soft failures a device is forgiven before it is dropped — see the model's note on the counter. */
export const MAX_PUSH_FAILURES = 5;

export const pushSubscriptionRepository = {
  /**
   * Register a browser, or refresh the row it already has.
   *
   * Upserting on the ENDPOINT rather than on `(userId, endpoint)` is what re-owns a shared
   * machine: the same browser registering under a second account moves to that account instead of
   * gaining a second row that keeps delivering to the first. `failureCount` resets, because a
   * browser that just registered is by definition reachable.
   */
  async upsert(params: {
    userId: string;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent: string | null;
    now: Date;
  }): Promise<PushSubscriptionDoc> {
    const doc = await PushSubscriptionModel.findOneAndUpdate(
      { endpoint: params.endpoint },
      {
        $set: {
          userId: new Types.ObjectId(params.userId),
          keys: params.keys,
          userAgent: params.userAgent,
          lastSeenAt: params.now,
          failureCount: 0,
        },
        $setOnInsert: { endpoint: params.endpoint, createdAt: params.now },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
      .lean<PushSubscriptionDoc>()
      .exec();
    return doc as PushSubscriptionDoc;
  },

  async listForUser(userId: string): Promise<PushSubscriptionDoc[]> {
    return PushSubscriptionModel.find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: 1 })
      .lean<PushSubscriptionDoc[]>()
      .exec();
  },

  /** Whether this user has any device to push to — the capability `notify()` asks about. */
  async hasAny(userId: string): Promise<boolean> {
    const count = await PushSubscriptionModel.countDocuments({
      userId: new Types.ObjectId(userId),
    })
      .limit(1)
      .exec();
    return count > 0;
  },

  /** Remove one of MINE. Scoped by user so an endpoint cannot be unregistered by a stranger. */
  async removeOwned(userId: string, endpoint: string): Promise<boolean> {
    const result = await PushSubscriptionModel.deleteOne({
      userId: new Types.ObjectId(userId),
      endpoint,
    }).exec();
    return result.deletedCount > 0;
  },

  /** A push service said this endpoint is gone for good (404/410). Not a soft failure. */
  async removeByEndpoint(endpoint: string): Promise<void> {
    await PushSubscriptionModel.deleteOne({ endpoint }).exec();
  },

  /**
   * Count one soft failure, and drop the device once it has had enough of them.
   *
   * Returns whether the row survived, so a caller can log the difference between "will try again"
   * and "gave up on this device".
   */
  async recordFailure(endpoint: string): Promise<boolean> {
    const doc = await PushSubscriptionModel.findOneAndUpdate(
      { endpoint },
      { $inc: { failureCount: 1 } },
      { new: true },
    )
      .lean<PushSubscriptionDoc>()
      .exec();
    if (doc === null) return false;
    if (doc.failureCount < MAX_PUSH_FAILURES) return true;
    await PushSubscriptionModel.deleteOne({ endpoint }).exec();
    return false;
  },

  /** A delivery got through, so whatever went wrong before is behind this device. */
  async recordSuccess(endpoint: string, now: Date): Promise<void> {
    await PushSubscriptionModel.updateOne(
      { endpoint },
      { $set: { lastSeenAt: now, failureCount: 0 } },
    ).exec();
  },
};
