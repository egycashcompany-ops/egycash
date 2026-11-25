// A running number per key — «رقم 7» — for a module's documents and codes. One document per key,
// `seq` the last number handed out. Operational bookkeeping, not business data: no soft delete, no
// versioning. Written from Fleet's custody counter (modules/fleet/custody/custody-counter.model.ts)
// as a factory, so a module defines its own `<module>_counters` collection instead of copying the
// rule; Fleet's and ATM's counters keep their own copies for now.
//
// WHY A COUNTER and not «the highest number + 1». Two saves at the same moment would both read the
// same highest number; the unique index on the document's number would then refuse one of them with
// a duplicate key, which is not a transient error, so nothing retries it. A counter document is
// written by both instead: inside the save's transaction the second `$inc` meets a write conflict,
// which IS transient, and `unitOfWork` simply runs it again with the next number. An aborted
// transaction takes its increment back with it, so a refused save leaves no gap.
//
// THE COUNTER NEVER STARTS BELOW THE NUMBERS ALREADY USED. `ensure` raises `seq` to the floor it
// is given (`$max`), never lowers it: a counter that went missing while numbered documents exist
// comes back at the highest number ever handed out instead of at 0, where every save would collide
// with number 1 forever.
import { Schema, model, type ClientSession, type Model, type Types } from 'mongoose';
import { ConflictError } from '../errors';

export interface CounterDoc {
  _id: Types.ObjectId;
  key: string;
  seq: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Counter {
  /** The model, for the module's index list and manifest. */
  readonly model: Model<CounterDoc>;
  /**
   * Make sure the counter exists and stands at least at `floor` — create-if-missing, never lowered.
   * Safe on every boot and before every save; a racing twin's duplicate key is the same outcome.
   * Call it OUTSIDE a transaction, and only once the unique index exists, so two processes can never
   * insert two counters for one key.
   */
  ensure(key: string, floor?: number): Promise<void>;
  /**
   * The next number, inside the caller's transaction. Two at once conflict on this one document and
   * the transaction is retried, so the numbers come out distinct and consecutive.
   */
  next(key: string, session: ClientSession): Promise<number>;
  /** The number the next save would take — a preview only: somebody may save first. */
  peek(key: string, floor?: number): Promise<number>;
}

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * Define a module's counter collection. `modelName` and `collection` are the module's own
 * (`'AdministrationCounter'`, `'administration_counters'`); the unique index on `key` is
 * `ux_counter_key`. Call it once, at module load.
 */
export const defineCounter = (modelName: string, collection: string): Counter => {
  const schema = new Schema<CounterDoc>(
    {
      key: { type: String, required: true },
      seq: { type: Number, required: true, default: 0, min: 0 },
    },
    { timestamps: true, strict: true, versionKey: false },
  );
  schema.index({ key: 1 }, { name: 'ux_counter_key', unique: true });
  const CounterModel = model<CounterDoc>(modelName, schema, collection);

  return {
    model: CounterModel,

    async ensure(key, floor = 0) {
      try {
        await CounterModel.updateOne(
          { key },
          { $max: { seq: Math.max(0, Math.trunc(floor)) } },
          { upsert: true },
        ).exec();
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    },

    async next(key, session) {
      const counter = await CounterModel.findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { new: true, session },
      )
        .lean<CounterDoc>()
        .exec();
      if (counter === null) {
        throw new ConflictError(`the ${key} counter is not ready yet — try again`);
      }
      return counter.seq;
    },

    async peek(key, floor = 0) {
      const counter = await CounterModel.findOne({ key }).lean<CounterDoc>().exec();
      return Math.max(counter?.seq ?? 0, floor) + 1;
    },
  };
};
