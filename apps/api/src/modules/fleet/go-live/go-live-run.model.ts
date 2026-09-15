// A go-live run, as a LEASE — the bookkeeping that lets a long boot-time job survive being killed.
//
// `markOnce` (sweeps) is the right primitive for «say this once»: insert against a unique index,
// and exactly one caller wins, forever. It is the wrong primitive for «do this once», because a
// job is not finished at the moment it is claimed. The first vehicle import learned that in
// production: it claimed its mark, created the vehicle types and the licence classes, and was
// then cut off before the cars — and because the mark said «done», no later boot would touch it,
// and the owner has no shell to finish it from. A registry with every dropdown filled and no
// vehicles in it is the exact shape of that failure.
//
// So a run has THREE states rather than two. `running` with a lease that has not expired belongs
// to somebody; `running` with an expired lease belonged to a process that died and may be taken
// over; `done` is permanent. Claiming is one atomic upsert against the unique key, so `server.ts`
// and `worker.ts` still elect exactly one of themselves, and a process that dies mid-run hands
// the job to the next boot after the lease runs out. The work it hands over is re-runnable by
// construction — `applyImport` updates a car it finds and creates one it does not.
//
// Operational bookkeeping, not business data: no soft delete, no versioning, nothing here is read
// to answer a business question.
import { Schema, model } from 'mongoose';

export type GoLiveRunStatus = 'running' | 'done';

export interface FleetGoLiveRunDoc {
  key: string;
  status: GoLiveRunStatus;
  /** While `running`: the instant after which another process may take the job over. */
  leaseUntil: Date;
  startedAt: Date;
  finishedAt: Date | null;
  /** What the run reported when it finished — readable from the database, not only the log. */
  outcome: Record<string, unknown> | null;
}

const goLiveRunSchema = new Schema<FleetGoLiveRunDoc>(
  {
    key: { type: String, required: true },
    status: { type: String, enum: ['running', 'done'], required: true },
    leaseUntil: { type: Date, required: true },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    outcome: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false },
);

goLiveRunSchema.index({ key: 1 }, { unique: true, name: 'ux_key' });

export const FleetGoLiveRunModel = model<FleetGoLiveRunDoc>(
  'FleetGoLiveRun',
  goLiveRunSchema,
  'fleet_go_live_runs',
);

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * Try to take the job. True to exactly one caller at a time; false when it is done, or somebody
 * else holds a live lease on it.
 *
 * ONE upsert does all three cases. The filter matches a row that is not done and whose lease has
 * lapsed; a match is updated and taken over. No match plus `upsert` means an INSERT — which is
 * either the first claim ever (no row: it succeeds, and we own it) or a collision with the row
 * the filter refused (done, or leased: the unique index rejects the insert with E11000, and we
 * do not). The index is the guarantee, exactly as it is for the sweep marks — so it is built here
 * first, because `autoIndex` is off in production and the claim must never run ahead of it.
 */
export const claimGoLiveRun = async (key: string, leaseMs: number): Promise<boolean> => {
  await FleetGoLiveRunModel.createIndexes();
  const now = new Date();
  try {
    await FleetGoLiveRunModel.findOneAndUpdate(
      { key, status: 'running', leaseUntil: { $lt: now } },
      {
        $set: { status: 'running', leaseUntil: new Date(now.getTime() + leaseMs), startedAt: now },
        $setOnInsert: { finishedAt: null, outcome: null },
      },
      { upsert: true },
    ).exec();
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
};

/** Mark the job finished for good. No boot after this one will claim it again. */
export const finishGoLiveRun = async (
  key: string,
  outcome: Record<string, unknown>,
): Promise<void> => {
  await FleetGoLiveRunModel.updateOne(
    { key },
    { $set: { status: 'done', finishedAt: new Date(), outcome } },
  ).exec();
};
