// A registered browser, for the Web Push channel.
//
// THE ENDPOINT IS THE IDENTITY, not the user. A subscription belongs to a BROWSER — one person
// with a laptop and a phone has two rows, and the push service keeps accepting deliveries for an
// endpoint until it is removed, whoever is signed in. So `endpoint` is unique across the whole
// collection and the same endpoint arriving for a different user RE-OWNS the row: a shared
// machine where somebody else signs in must not keep pushing the first person's notifications to
// the second person's screen.
//
// `failureCount` is the only mutable state besides `lastSeenAt`. A push service answers 404/410
// for an endpoint that is gone for good, and those rows are deleted on the spot rather than
// counted — the counter is for the softer failures (a timeout, a 5xx) that should not delete a
// live device on one bad night, but should not be retried forever either.
import { Schema, model, type Types } from 'mongoose';

export interface PushSubscriptionDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Whatever the browser called itself when it registered — the only way to tell devices apart. */
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  failureCount: number;
}

const pushSubscriptionSchema = new Schema<PushSubscriptionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
    lastSeenAt: { type: Date, required: true, default: () => new Date() },
    failureCount: { type: Number, required: true, default: 0 },
  },
  { strict: true, versionKey: false },
);

// One row per browser, globally. Not `(userId, endpoint)`: that would let two users hold the same
// endpoint, which is the shared-machine leak this index exists to make impossible.
pushSubscriptionSchema.index({ endpoint: 1 }, { name: 'ux_endpoint', unique: true });
// The delivery read: every device belonging to one recipient.
pushSubscriptionSchema.index({ userId: 1 }, { name: 'ix_userId' });

export const PushSubscriptionModel = model<PushSubscriptionDoc>(
  'PushSubscription',
  pushSubscriptionSchema,
  'push_subscriptions',
);
