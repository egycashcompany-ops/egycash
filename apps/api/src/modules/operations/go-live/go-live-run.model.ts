// Operations' go-live runs — «done, and never again», for the owner's data the deploy loads once
// (Round 29b: the four banks' branch lists, `bank-branches.ts`). IT's `it_go_live_runs` to the
// letter, kept inside the module because Operations imports no other module's internals.
//
// A RUN ROW IS A STEP'S LAST WORD. Each step is ONE transaction that writes its run row as its last
// act. The row and the work commit together or not at all, so a process killed half-way leaves
// nothing behind — the next boot runs the step again — and a committed row means the step is over:
// no later boot repeats it, so what an operator edits or deletes afterwards stays as he left it.
// The row says how it ended (`outcome.status`): `done`, or `skipped` (the step found nothing it may
// write without a person — that is final too: a later load is a new key, a person's decision), or
// `gaveUp` (it kept failing past its days). The unique `key` is what turns a second process's racing
// run into a conflict instead of a second load.
//
// A STEP THAT FAILS leaves no run row: it is tried again on the next boot. Its failed tries are
// counted under `<key>:failed` (never a run row: `isOperationsGoLiveRunDone` asks the run's own key)
// — the first and the last, how many, the last error — so the database says what the log said,
// and the step can stop being tried once its days are past (Round 29b critic: a step armed for
// months loads a sheet over months of operators' edits). Operational bookkeeping, not business
// data: no soft delete, no versioning, never read to answer a business question.
import { Schema, model, type ClientSession } from 'mongoose';

export interface OperationsGoLiveRunDoc {
  key: string;
  finishedAt: Date;
  /** What the run did — readable from the database, because the owner cannot read the log. */
  outcome: Record<string, unknown>;
}

const goLiveRunSchema = new Schema<OperationsGoLiveRunDoc>(
  {
    key: { type: String, required: true },
    finishedAt: { type: Date, required: true },
    outcome: { type: Schema.Types.Mixed, required: true },
  },
  { versionKey: false },
);

goLiveRunSchema.index({ key: 1 }, { unique: true, name: 'ux_key' });

export const OperationsGoLiveRunModel = model<OperationsGoLiveRunDoc>(
  'OperationsGoLiveRun',
  goLiveRunSchema,
  'operations_go_live_runs',
);

/**
 * Build the unique index BEFORE any step runs. `autoIndex` is off in production, and the index is
 * what turns a second, concurrent run's insert into a refusal instead of a second row.
 */
export const ensureOperationsGoLiveRunIndexes = async (): Promise<void> => {
  await OperationsGoLiveRunModel.createIndexes();
};

export const isOperationsGoLiveRunDone = async (
  key: string,
  session?: ClientSession,
): Promise<boolean> => {
  const query = OperationsGoLiveRunModel.exists({ key });
  if (session !== undefined) query.session(session);
  return (await query.exec()) !== null;
};

/** The step's last write, inside its own transaction. */
export const recordOperationsGoLiveRun = async (
  key: string,
  outcome: Record<string, unknown>,
  session: ClientSession,
): Promise<void> => {
  await OperationsGoLiveRunModel.create([{ key, finishedAt: new Date(), outcome }], { session });
};

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * A run row written on its own, outside any transaction — a step that ends without writing any
 * data (it gave up). False when another process wrote the row first: the step is over either way.
 */
export const recordOperationsGoLiveRunAlone = async (
  key: string,
  outcome: Record<string, unknown>,
): Promise<boolean> => {
  try {
    await OperationsGoLiveRunModel.create([{ key, finishedAt: new Date(), outcome }]);
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
};

/** Where a step's failed tries are counted — never its run row. */
export const operationsGoLiveFailedKey = (key: string): string => `${key}:failed`;

/** A step's failed tries, as `<key>:failed` keeps them. */
export interface OperationsGoLiveFailures {
  firstFailedAt: Date;
  lastFailedAt: Date;
  failures: number;
  lastError: string;
}

/** The step's failed tries so far; null when it has not failed. */
export const operationsGoLiveFailuresOf = async (
  key: string,
): Promise<OperationsGoLiveFailures | null> => {
  const doc = await OperationsGoLiveRunModel.findOne({ key: operationsGoLiveFailedKey(key) })
    .lean<OperationsGoLiveRunDoc>()
    .exec();
  if (doc === null) return null;
  const outcome = doc.outcome as Partial<OperationsGoLiveFailures>;
  return {
    firstFailedAt: outcome.firstFailedAt ?? doc.finishedAt,
    lastFailedAt: doc.finishedAt,
    failures: outcome.failures ?? 1,
    lastError: outcome.lastError ?? '',
  };
};

/** One more failed try of the step, counted — the first one's time kept. */
export const recordOperationsGoLiveFailure = async (
  key: string,
  error: string,
  at: Date,
): Promise<void> => {
  await OperationsGoLiveRunModel.updateOne(
    { key: operationsGoLiveFailedKey(key) },
    {
      $set: { finishedAt: at, 'outcome.status': 'failed', 'outcome.lastError': error },
      $inc: { 'outcome.failures': 1 },
      $setOnInsert: { 'outcome.firstFailedAt': at },
    },
    { upsert: true },
  ).exec();
};
