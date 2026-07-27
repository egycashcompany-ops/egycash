// Atomic batch numbering (mirrors the offer counter): a per-prefix, per-year key in the shared
// module-local `hr_sequences` collection with an upserting `$inc` — a single atomic op, so
// concurrent batch creation never collides and never skips. The batch document also carries a
// unique index on `code` as a second line of defence.
import mongoose, { Schema, type ClientSession, type Model } from 'mongoose';

interface SequenceDoc {
  _id: string; // the sequence key, e.g. "evaluationBatch:SEC:2026"
  value: number;
}

const sequenceSchema = new Schema<SequenceDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: 'hr_sequences' },
);

// Reuse the shared counter model if another feature already registered it (same collection,
// identical schema) — avoids an OverwriteModelError regardless of import order.
const HrSequenceModel: Model<SequenceDoc> =
  (mongoose.models.HrSequence as Model<SequenceDoc> | undefined) ??
  mongoose.model<SequenceDoc>('HrSequence', sequenceSchema);

/**
 * The code prefix a phase's batches carry. Known phases get their business prefix; an
 * admin-created batch phase falls back to a sanitized key so its numbering is still readable.
 */
export const batchPrefixFor = (phaseKey: string): string => {
  if (phaseKey === 'securityCheck') return 'SEC';
  if (phaseKey === 'drivingTest') return 'DRV';
  const letters = phaseKey.replace(/[^a-zA-Z]/g, '').toUpperCase();
  return (letters.length >= 3 ? letters.slice(0, 3) : `${letters}BAT`.slice(0, 3)) || 'BAT';
};

export const batchSequenceKey = (prefix: string, year: number): string =>
  `evaluationBatch:${prefix}:${year}`;

export const formatBatchNumber = (prefix: string, year: number, value: number): string =>
  `${prefix}-${year}-${String(value).padStart(6, '0')}`;

/** Atomically allocate the next batch number for a phase in `year`. */
export const nextBatchNumber = async (
  phaseKey: string,
  year: number = new Date().getUTCFullYear(),
  session?: ClientSession,
): Promise<string> => {
  const prefix = batchPrefixFor(phaseKey);
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: batchSequenceKey(prefix, year) },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatBatchNumber(prefix, year, doc.value);
};
