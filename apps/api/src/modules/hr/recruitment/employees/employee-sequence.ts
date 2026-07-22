// Atomic Global-Employee-Number allocation (BD-002 pattern): a SINGLE global key in the shared
// module-local `hr_sequences` collection with an upserting `$inc` — one atomic op, so concurrent
// hiring in any branch never collides and never skips. This yields the PERMANENT identity; the
// displayed Employee Code (current branch + this number) is derived separately (ADR-017). A unique
// index on `employeeNumber` is the second line of defence.
import mongoose, { Schema, type ClientSession, type Model } from 'mongoose';
import { EMPLOYEE_SEQUENCE_KEY, formatEmployeeNumber } from './employee-number';

interface SequenceDoc {
  _id: string; // the sequence key, e.g. "employee:global"
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
 * Atomically allocate the next Global Employee Number (the permanent, company-wide-unique identity).
 * Branch-agnostic — the displayed Employee Code is derived from the current branch separately.
 */
export const nextEmployeeNumber = async (session?: ClientSession): Promise<string> => {
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: EMPLOYEE_SEQUENCE_KEY },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatEmployeeNumber(doc.value);
};
