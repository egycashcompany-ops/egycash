// A stored rule: an event, the conditions on it, who to tell, and what to say.
//
// `firedCount` / `lastFiredAt` are the only mutable state, and they exist because a rule is
// otherwise unobservable. A rule that has never fired looks exactly like one that fires correctly
// — until somebody asks why a notification never came, and there is nothing to look at. These two
// answer "is this thing alive?" without a log search.
import { Schema, model, type Types } from 'mongoose';
import { type AutomationFilter, type RuleAudience } from '@ecms/contracts';

export interface NotificationRuleDoc {
  _id: Types.ObjectId;
  name: string;
  event: string;
  filters: AutomationFilter[];
  audience: RuleAudience;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  enabled: boolean;
  firedCount: number;
  lastFiredAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
  isDeleted: boolean;
  __v: number;
}

const notificationRuleSchema = new Schema<NotificationRuleDoc>(
  {
    name: { type: String, required: true },
    event: { type: String, required: true },
    // Mixed for both: a filter is a three-field union over `unknown`, and an audience is a
    // discriminated union of four shapes. Zod validated each at the boundary; re-declaring them
    // here as schemas would be a second definition, free to drift from the first.
    filters: { type: Schema.Types.Mixed, required: true, default: [] },
    audience: { type: Schema.Types.Mixed, required: true },
    title: { ar: { type: String, required: true }, en: { type: String, required: true } },
    body: { ar: { type: String, required: true }, en: { type: String, required: true } },
    enabled: { type: Boolean, required: true, default: true },
    firedCount: { type: Number, required: true, default: 0 },
    lastFiredAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    isDeleted: { type: Boolean, required: true, default: false },
  },
  // `optimisticConcurrency` guards any `save()` path. The EDIT path does not use one — it is a
  // `findOneAndUpdate` filtered on `__v`, in the repository — because the client sends the version
  // it read and the update must fail rather than overwrite an edit it never saw.
  { strict: true, optimisticConcurrency: true },
);

// The bridge's read, on every event the platform emits: the enabled rules for one event name.
notificationRuleSchema.index({ event: 1, enabled: 1, isDeleted: 1 }, { name: 'ix_event_enabled' });

export const NotificationRuleModel = model<NotificationRuleDoc>(
  'NotificationRule',
  notificationRuleSchema,
  'hr_notification_rules',
);
