// Atomic session numbering — the same BD-002 pattern the applicant and offer counters use: a
// per-year key in the shared module-local `hr_sequences` collection with an upserting `$inc`, one
// atomic op, so concurrent scheduling never collides and never skips. The session document also
// carries a unique index on `code` as a second line of defence.
import mongoose, { Schema, type ClientSession, type Model } from 'mongoose';

interface SequenceDoc {
  _id: string; // "trainingSession:2026"
  value: number;
}

const sequenceSchema = new Schema<SequenceDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: 'hr_sequences' },
);

// Reuse the shared counter model if another feature registered it first (same collection,
// identical schema) — avoids an OverwriteModelError regardless of import order.
const HrSequenceModel: Model<SequenceDoc> =
  (mongoose.models.HrSequence as Model<SequenceDoc> | undefined) ??
  mongoose.model<SequenceDoc>('HrSequence', sequenceSchema);

export const sessionSequenceKey = (year: number): string => `trainingSession:${String(year)}`;

/** `TRN-2026-000001` — the year is in the code because sessions are read by season. */
export const formatSessionNumber = (year: number, value: number): string =>
  `TRN-${String(year)}-${String(value).padStart(6, '0')}`;

export const nextSessionNumber = async (
  year: number = new Date().getUTCFullYear(),
  session?: ClientSession,
): Promise<string> => {
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: sessionSequenceKey(year) },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatSessionNumber(year, doc.value);
};
