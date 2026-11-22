// HR's go-live runs — «done, and never again», for the one-off changes to the live data that the
// owner asks for and has no shell to make (the Fleet `fleet_go_live_runs` and IT `it_go_live_runs`
// precedents, each kept inside its own module because a module imports no other).
//
// One transaction per step, writing its run row as its last act. The row and the work commit
// together or not at all, so a process killed half-way leaves nothing to take over — the next boot
// runs the step again — and a committed row means the work is in. Operational bookkeeping, not
// business data: no soft delete, no versioning, never read to answer a business question.
import { Schema, model, type ClientSession } from 'mongoose';

export interface HrGoLiveRunDoc {
  key: string;
  finishedAt: Date;
  /** What the run did — readable from the database, because the owner cannot read the log. */
  outcome: Record<string, unknown>;
}

const goLiveRunSchema = new Schema<HrGoLiveRunDoc>(
  {
    key: { type: String, required: true },
    finishedAt: { type: Date, required: true },
    outcome: { type: Schema.Types.Mixed, required: true },
  },
  { versionKey: false },
);

goLiveRunSchema.index({ key: 1 }, { unique: true, name: 'ux_key' });

export const HrGoLiveRunModel = model<HrGoLiveRunDoc>(
  'HrGoLiveRun',
  goLiveRunSchema,
  'hr_go_live_runs',
);

/**
 * Build the unique index BEFORE any step runs. `autoIndex` is off in production, and the index is
 * what turns a second, concurrent run's insert into a refusal instead of a second row.
 */
export const ensureHrGoLiveRunIndexes = async (): Promise<void> => {
  await HrGoLiveRunModel.createIndexes();
};

export const isHrGoLiveRunDone = async (key: string, session?: ClientSession): Promise<boolean> => {
  const query = HrGoLiveRunModel.exists({ key });
  if (session !== undefined) query.session(session);
  return (await query.exec()) !== null;
};

/** The step's last write, inside its own transaction. */
export const recordHrGoLiveRun = async (
  key: string,
  outcome: Record<string, unknown>,
  session: ClientSession,
): Promise<void> => {
  await HrGoLiveRunModel.create([{ key, finishedAt: new Date(), outcome }], { session });
};
