// IT's go-live runs — «done, and never again», for the one-off changes the owner asks of the live
// data and has no shell to make (the Fleet `fleet_go_live_runs` precedent, kept inside the module
// because IT imports no other module).
//
// Simpler than Fleet's lease, because IT's steps are simpler: each is ONE transaction that writes
// its run row as its last act. The row and the work commit together or not at all, so a process
// killed half-way leaves nothing to take over — the next boot just runs the step again — and a
// committed row means the work is in. Operational bookkeeping, not business data: no soft delete,
// no versioning, never read to answer a business question.
import { Schema, model, type ClientSession } from 'mongoose';

export interface ItGoLiveRunDoc {
  key: string;
  finishedAt: Date;
  /** What the run did — readable from the database, because the owner cannot read the log. */
  outcome: Record<string, unknown>;
}

const goLiveRunSchema = new Schema<ItGoLiveRunDoc>(
  {
    key: { type: String, required: true },
    finishedAt: { type: Date, required: true },
    outcome: { type: Schema.Types.Mixed, required: true },
  },
  { versionKey: false },
);

goLiveRunSchema.index({ key: 1 }, { unique: true, name: 'ux_key' });

export const ItGoLiveRunModel = model<ItGoLiveRunDoc>(
  'ItGoLiveRun',
  goLiveRunSchema,
  'it_go_live_runs',
);

/**
 * Build the unique index BEFORE any step runs. `autoIndex` is off in production, and the index is
 * what turns a second, concurrent run's insert into a refusal instead of a second row.
 */
export const ensureItGoLiveRunIndexes = async (): Promise<void> => {
  await ItGoLiveRunModel.createIndexes();
};

export const isItGoLiveRunDone = async (key: string, session?: ClientSession): Promise<boolean> => {
  const query = ItGoLiveRunModel.exists({ key });
  if (session !== undefined) query.session(session);
  return (await query.exec()) !== null;
};

/** The step's last write, inside its own transaction. */
export const recordItGoLiveRun = async (
  key: string,
  outcome: Record<string, unknown>,
  session: ClientSession,
): Promise<void> => {
  await ItGoLiveRunModel.create([{ key, finishedAt: new Date(), outcome }], { session });
};
