// The record of a message that was sent.
//
// WHY IT EXISTS. The notifications it produced are the recipients' — each person's row is theirs,
// they can archive it, and none of them says who else got one. The sender's question is the other
// one: what did we announce, to whom, and how many did it actually reach? Without this row that
// question has no answer, because re-running the filter tomorrow answers a different one — people
// join, transfer and leave, and a filter is a description of a moment.
//
// So the counts are FROZEN at send time rather than derived. `matched` was the audience;
// `recipients` is who had a login; `unreachable` is the gap between them, which is the number a
// sender needs and the one they would never otherwise see.
import { Schema, model, type Types } from 'mongoose';
import { NOTIFICATION_CHANNELS, type AnnouncementAudience } from '@ecms/contracts';

export interface AnnouncementDoc {
  _id: Types.ObjectId;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  /** The audience AS CHOSEN — kept verbatim so "who was this for?" is answerable, not re-derived. */
  audience: AnnouncementAudience;
  priority: string;
  channels: string[];
  matched: number;
  recipients: number;
  unreachable: number;
  sentBy: Types.ObjectId;
  sentAt: Date;
}

const announcementSchema = new Schema<AnnouncementDoc>(
  {
    title: {
      ar: { type: String, required: true },
      en: { type: String, required: true },
    },
    body: {
      ar: { type: String, required: true },
      en: { type: String, required: true },
    },
    // `Mixed` because the audience is a discriminated union of three shapes; Zod validated it at
    // the boundary, and re-declaring it here as a schema would be a second, drifting definition.
    audience: { type: Schema.Types.Mixed, required: true },
    priority: { type: String, required: true },
    channels: { type: [String], enum: NOTIFICATION_CHANNELS, required: true },
    matched: { type: Number, required: true },
    recipients: { type: Number, required: true },
    unreachable: { type: Number, required: true },
    sentBy: { type: Schema.Types.ObjectId, required: true },
    sentAt: { type: Date, required: true, default: () => new Date() },
  },
  { strict: true, versionKey: false },
);

/** The list reads newest-first, and nothing else reads this collection. */
announcementSchema.index({ sentAt: -1 }, { name: 'ix_sentAt' });

export const AnnouncementModel = model<AnnouncementDoc>(
  'Announcement',
  announcementSchema,
  'hr_announcements',
);
