// One person's activity on one Cairo day — the «وقت كل واحد على السيستم» half of the active users
// page.
//
// A SET of minutes rather than a running total. A heartbeat marks the minute of the day it landed
// in, and `$addToSet` makes marking it twice a no-op, so two tabs, two devices or a retried request
// in the same minute are one minute — nothing on the browser side has to coordinate with anything.
// The time on the system is the size of the set: at most 1440, and an exact answer to "in how many
// minutes of the day was this person working".
//
// Kept for `PRESENCE_RETENTION_DAYS` after the day ends, then removed by the TTL index. Not
// audited and not a session: a heartbeat never extends one and never touches `lastUsedAt`, so the
// idle sign-out decides on renewals alone, exactly as before this collection existed.
import { Schema, model, type Types } from 'mongoose';

export interface UserActivityDayDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** The Cairo calendar day, `YYYY-MM-DD`. */
  day: string;
  /** Minutes of that Cairo day (0‥1439) with at least one heartbeat — a set, never repeated. */
  minutes: number[];
  /** The first and the last heartbeat of the day. */
  firstAt: Date;
  lastAt: Date;
  /** The end of the Cairo day plus the retention; the TTL index removes the row then. */
  expiresAt: Date;
}

const userActivityDaySchema = new Schema<UserActivityDayDoc>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    day: { type: String, required: true },
    minutes: { type: [Number] },
    firstAt: { type: Date, required: true },
    lastAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { strict: true, versionKey: false },
);
// The upsert key: one row per person per day, whichever replica takes the heartbeat.
userActivityDaySchema.index({ userId: 1, day: 1 }, { unique: true, name: 'ux_userId_day' });
// The page's read: everybody on one day, most recent first.
userActivityDaySchema.index({ day: 1, lastAt: -1 }, { name: 'ix_day_lastAt' });
userActivityDaySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });

export const UserActivityDayModel = model<UserActivityDayDoc>(
  'UserActivityDay',
  userActivityDaySchema,
  'user_activity_days',
);
