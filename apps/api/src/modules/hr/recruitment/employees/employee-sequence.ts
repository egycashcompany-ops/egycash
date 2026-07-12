// Atomic employee numbering (same BD-002 pattern as applicants/offers): a per-year key in the
// shared module-local `hr_sequences` collection with an upserting `$inc` — a single atomic op,
// so concurrent hiring never collides and never skips. The employee document also carries a
// unique index on `code` as a second line of defence.
import mongoose, { Schema, type ClientSession, type Model } from 'mongoose';
import { employeeSequenceKey, formatEmployeeNumber } from './employee-number';

interface SequenceDoc {
  _id: string; // the sequence key, e.g. "employee:2026"
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

/** Atomically allocate the next employee number for `year`. */
export const nextEmployeeNumber = async (
  year: number = new Date().getUTCFullYear(),
  session?: ClientSession,
): Promise<string> => {
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: employeeSequenceKey(year) },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatEmployeeNumber(year, doc.value);
};
