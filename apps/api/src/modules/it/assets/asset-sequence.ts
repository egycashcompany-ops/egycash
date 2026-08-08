// Atomic asset-code allocation (BD-002 pattern, the hr_sequences precedent): a SINGLE global key
// in the module-local `it_sequences` collection with an upserting `$inc` — one atomic op, so
// concurrent registration never collides and never skips. A unique index on `assetCode` is the
// second line of defence.
import mongoose, { Schema, type Model } from 'mongoose';
import { ASSET_SEQUENCE_KEY, formatAssetCode } from './asset-number';

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

// Reuse the shared counter model if another IT feature already registered it (same collection,
// identical schema) — avoids an OverwriteModelError regardless of import order.
const ItSequenceModel: Model<SequenceDoc> =
  (mongoose.models.ItSequence as Model<SequenceDoc> | undefined) ??
  mongoose.model<SequenceDoc>('ItSequence', sequenceSchema);

export const nextAssetCode = async (): Promise<string> => {
  const doc = await ItSequenceModel.findOneAndUpdate(
    { _id: ASSET_SEQUENCE_KEY },
    { $inc: { value: 1 } },
    { new: true, upsert: true },
  )
    .lean<SequenceDoc>()
    .exec();
  return formatAssetCode(doc.value);
};
