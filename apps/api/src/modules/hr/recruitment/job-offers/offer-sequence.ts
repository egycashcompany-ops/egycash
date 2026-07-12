// Atomic offer numbering (mirrors the applicant counter, BD-002 pattern): a per-year key in
// the shared module-local `hr_sequences` collection with an upserting `$inc` — a single
// atomic op, so concurrent offer creation never collides and never skips. The offer document
// also carries a unique index on `code` as a second line of defence.
import mongoose, { Schema, type ClientSession, type Model } from 'mongoose';
import { formatOfferNumber, offerSequenceKey } from './offer-number';

interface SequenceDoc {
  _id: string; // the sequence key, e.g. "jobOffer:2026"
  value: number;
}

const sequenceSchema = new Schema<SequenceDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: 'hr_sequences' },
);

// Reuse the shared counter model if the applicants feature already registered it (same
// collection, identical schema) — avoids an OverwriteModelError regardless of import order.
const HrSequenceModel: Model<SequenceDoc> =
  (mongoose.models.HrSequence as Model<SequenceDoc> | undefined) ??
  mongoose.model<SequenceDoc>('HrSequence', sequenceSchema);

/** Atomically allocate the next offer number for `year`. */
export const nextOfferNumber = async (
  year: number = new Date().getUTCFullYear(),
  session?: ClientSession,
): Promise<string> => {
  const doc = await HrSequenceModel.findOneAndUpdate(
    { _id: offerSequenceKey(year) },
    { $inc: { value: 1 } },
    { new: true, upsert: true, session: session ?? null },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatOfferNumber(year, doc.value);
};
