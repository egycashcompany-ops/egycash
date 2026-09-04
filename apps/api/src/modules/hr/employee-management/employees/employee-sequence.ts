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

/**
 * Raise the counter so the next allocation is above `value` — for loading employees whose numbers
 * were issued long before this system existed (the go-live import).
 *
 * Without it the next real hire is allocated `0001` and collides with an imported employee on the
 * unique `code` index: an import that looked fine, and hiring that breaks the following week.
 *
 * MONOTONIC BY CONSTRUCTION. The `value: { $lt: value }` filter is what makes a `$set` safe here —
 * the write matches nothing once the counter is already high enough, so this can only ever raise
 * the counter and never hand back a number twice, whoever calls it and however often. Doing it by
 * walking `nextEmployeeNumber` would be one round trip PER NUMBER — 2,718 of them for the go-live
 * workforce — to reach a state one atomic operation expresses exactly.
 */
export const raiseEmployeeSequenceTo = async (value: number): Promise<void> => {
  if (!Number.isInteger(value) || value < 0) throw new Error('sequence floor must be a whole number');
  await HrSequenceModel.updateOne(
    { _id: EMPLOYEE_SEQUENCE_KEY, value: { $lt: value } },
    { $set: { value } },
    { upsert: false },
  ).exec();
  // `upsert: false` above cannot create the document, so a database that has never hired anybody
  // needs the row put there — with the same floor, and only if it is still absent.
  await HrSequenceModel.updateOne(
    { _id: EMPLOYEE_SEQUENCE_KEY },
    { $setOnInsert: { value } },
    { upsert: true },
  ).exec();
};
