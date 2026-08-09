// The module's atomic counter (BD-002 pattern, the `hr_sequences` precedent).
//
// One collection, one document per key, one upserting `$inc` — a single atomic op, so concurrent
// allocation never collides and never skips. The unique index on each code column is the second
// line of defence.
//
// Extracted here in IT-3 because tickets need the same allocator assets already had. Two copies of
// this model would register the same collection twice and drift the moment one changed; the design
// makes `it_sequences` one collection for `asset:global`, `ticket:global` and
// `maintenanceOrder:global` (§2.1), so the allocator is one function keyed by string.
import mongoose, { Schema, type Model } from 'mongoose';

interface SequenceDoc {
  _id: string; // the sequence key, e.g. "asset:global"
  value: number;
}

const sequenceSchema = new Schema<SequenceDoc>(
  {
    _id: { type: String, required: true },
    value: { type: Number, required: true, default: 0 },
  },
  { versionKey: false, collection: 'it_sequences' },
);

// Reuse the registered model if it already exists — avoids an OverwriteModelError regardless of
// import order across the module's features.
const ItSequenceModel: Model<SequenceDoc> =
  (mongoose.models.ItSequence as Model<SequenceDoc> | undefined) ??
  mongoose.model<SequenceDoc>('ItSequence', sequenceSchema);

/** The next value for a key. Codes are permanent and never reused, so this only ever goes up. */
export const nextSequenceValue = async (key: string): Promise<number> => {
  const doc = await ItSequenceModel.findOneAndUpdate(
    { _id: key },
    { $inc: { value: 1 } },
    { new: true, upsert: true },
  )
    .lean<SequenceDoc>()
    .exec();
  return doc.value;
};
