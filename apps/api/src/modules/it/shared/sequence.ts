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
import mongoose, { Schema, type ClientSession, type Model } from 'mongoose';

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

/**
 * Set a counter to an exact value — the ONE exception to «only ever goes up», and it is not a
 * service call: it exists for the owner's go-live restart of the asset register
 * (`go-live/asset-restart.ts`), which frees every code above the one asset it keeps before it
 * rewinds, so nothing the counter hands out next can collide with a code still held.
 */
export const setSequenceValue = async (
  key: string,
  value: number,
  session: ClientSession,
): Promise<void> => {
  await ItSequenceModel.updateOne(
    { _id: key },
    { $set: { value } },
    { upsert: true, session },
  ).exec();
};

/**
 * `count` values for a key at once, inside the caller's transaction — the first of them is
 * returned. For the go-live inventory import (`go-live/inventory.ts`), which registers hundreds of
 * assets in one transaction: the codes are taken with the assets, so a run that rolls back gives
 * every one of them back instead of leaving a gap of hundreds in the register's numbering.
 */
export const reserveSequenceBlock = async (
  key: string,
  count: number,
  session: ClientSession,
): Promise<number> => {
  const doc = await ItSequenceModel.findOneAndUpdate(
    { _id: key },
    { $inc: { value: count } },
    { new: true, upsert: true, session },
  )
    .lean<SequenceDoc>()
    .exec();
  return doc.value - count + 1;
};

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * Mark one value of a key's series as USED, inside the caller's transaction — once. For a series
 * that more than one collection records, where each collection's unique index sees only its own
 * rows: the F-14 papers, kept as device receipts and as mobile-line acknowledgments. The claim is
 * a row beside the counter, `<key>#<value>`; a second claim of the same value is a duplicate key,
 * and answers `false` — the caller refuses, and its transaction rolls back. Two transactions
 * claiming at the same moment conflict, and the one retried finds the other's claim.
 */
export const claimSequenceValue = async (
  key: string,
  value: number,
  session: ClientSession,
): Promise<boolean> => {
  try {
    await ItSequenceModel.create([{ _id: `${key}#${String(value)}`, value }], { session });
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
};

/** The last value handed out for a key — 0 when none has been. Reads, never allocates. */
export const currentSequenceValue = async (key: string): Promise<number> => {
  const doc = await ItSequenceModel.findById(key).lean<SequenceDoc>().exec();
  return doc?.value ?? 0;
};
