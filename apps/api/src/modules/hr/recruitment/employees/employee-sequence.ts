// Atomic employee-code allocation (BD-002 pattern): a SINGLE global key in the shared module-local
// `hr_sequences` collection with an upserting `$inc` — one atomic op, so concurrent hiring in any
// branch never collides and never skips. The global number is then prefixed with the hiring
// branch's code. The employee document also carries a unique index on `code` as a second line of
// defence.
import mongoose, { Schema, type ClientSession, type Model } from 'mongoose';
import { EMPLOYEE_SEQUENCE_KEY, formatEmployeeCode } from './employee-number';

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
 * Atomically allocate the next GLOBAL employee sequence and format it with the branch code.
 * `<branchCode><globalSeq>`; the numeric suffix is company-wide unique and never reused.
 */
export const nextEmployeeCode = async (
  branchCode: string,
  session?: ClientSession,
): Promise<string> => {
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: EMPLOYEE_SEQUENCE_KEY },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatEmployeeCode(branchCode, doc.value);
};
