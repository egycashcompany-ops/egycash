// The custody screen's running numbers — «مذكرة … رقم 7». One document per key, `seq` the last
// number handed out. Operational bookkeeping, not business data: no soft delete, no versioning.
//
// WHY A COUNTER and not «the highest number + 1». Two memos saved at the same moment would both
// read the same highest number; the unique index on the memo's `no` would then refuse one of them
// with a duplicate key, which is not a transient error, so nothing retries it. A counter document
// is written by both instead: inside the memo's transaction the second `$inc` meets a write
// conflict, which IS transient, and `unitOfWork` simply runs it again with the next number. An
// aborted transaction takes its increment back with it, so a refused memo leaves no gap.
//
// THE COUNTER NEVER STARTS BELOW THE NUMBERS ALREADY USED. `ensureCustodyCounter` raises `seq` to
// the floor it is given (`$max`), never lowers it: a counter that went missing while memos exist
// comes back at the highest number ever handed out — deleted memos included, since a number is
// never reused — instead of at 0, where every save would collide with memo 1 forever.
import { Schema, model, type ClientSession, type Types } from 'mongoose';
import { ConflictError } from '../../../shared/errors';

export interface FleetCustodyCounterDoc {
  _id: Types.ObjectId;
  key: string;
  seq: number;
  createdAt: Date;
  updatedAt: Date;
}

const custodyCounterSchema = new Schema<FleetCustodyCounterDoc>(
  {
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true, strict: true, versionKey: false },
);

custodyCounterSchema.index({ key: 1 }, { name: 'ux_custody_counter_key', unique: true });

export const FleetCustodyCounterModel = model<FleetCustodyCounterDoc>(
  'FleetCustodyCounter',
  custodyCounterSchema,
  'fleet_custody_counters',
);

/** The memos' number — one running number across the four kinds. */
export const CUSTODY_MEMO_COUNTER = 'custodyMemo';

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * Make sure the counter exists and stands at least at `floor` — create-if-missing, never lowered.
 * Safe on every boot and before every save; a racing twin's duplicate key is the same outcome.
 * Call it OUTSIDE a transaction, and only once the unique index exists (the seed runs it after the
 * index step), so two processes can never insert two counters for one key.
 */
export const ensureCustodyCounter = async (key: string, floor = 0): Promise<void> => {
  try {
    await FleetCustodyCounterModel.updateOne(
      { key },
      { $max: { seq: Math.max(0, Math.trunc(floor)) } },
      { upsert: true },
    ).exec();
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
};

/**
 * The next number, inside the caller's transaction. Two at once conflict on this one document and
 * the transaction is retried, so the numbers come out distinct and consecutive.
 */
export const nextCustodyNumber = async (key: string, session: ClientSession): Promise<number> => {
  const counter = await FleetCustodyCounterModel.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, session },
  )
    .lean<FleetCustodyCounterDoc>()
    .exec();
  if (counter === null) {
    throw new ConflictError(`the ${key} counter is not ready yet — try again`);
  }
  return counter.seq;
};

/** The number the next save would take — a preview only: somebody may save first. */
export const peekCustodyNumber = async (key: string, floor = 0): Promise<number> => {
  const counter = await FleetCustodyCounterModel.findOne({ key })
    .lean<FleetCustodyCounterDoc>()
    .exec();
  return Math.max(counter?.seq ?? 0, floor) + 1;
};
