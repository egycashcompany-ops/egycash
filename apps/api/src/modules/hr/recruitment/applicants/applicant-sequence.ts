// Atomic applicant numbering (BD-002): organization-wide, yearly-reset sequence.
// A module-local counter collection (`hr_sequences`) with an upserting `$inc` gives a
// gap-free, race-safe allocation without a platform-wide sequence service (which does
// not exist yet — this is the self-contained, buildable piece per OQ-30). When a shared
// sequence service arrives, this becomes a thin adapter over it.
import { Schema, model, type ClientSession } from 'mongoose';
import { applicantSequenceKey, formatApplicantNumber } from './applicant-number';

interface SequenceDoc {
  _id: string; // the sequence key, e.g. "applicant:2026"
  value: number;
}

const sequenceSchema = new Schema<SequenceDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: 'hr_sequences' },
);

const HrSequenceModel = model<SequenceDoc>('HrSequence', sequenceSchema);

/**
 * Atomically allocate the next applicant number for `year`. `findOneAndUpdate` with
 * `upsert` + `$inc` is a single atomic op — concurrent registrations never collide and
 * never skip. The applicant document also carries a unique index on `code` as a
 * second line of defence.
 */
export const nextApplicantNumber = async (
  year: number = new Date().getUTCFullYear(),
  session?: ClientSession,
): Promise<string> => {
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: applicantSequenceKey(year) },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatApplicantNumber(year, doc.value);
};
