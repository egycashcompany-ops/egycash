// The «نقل البيانات» run lock and record (branch-move-run.model.ts) — the register import's lock
// (register/import/apply-import.ts) as a few named writes: take over a stale run, take the lock,
// record progress, end the run, or release a lock that never wrote.
import {
  emptyAtmBranchMoveCounts,
  emptyAtmBranchMoveMerges,
  type AtmBranchMoveCountsDto,
  type AtmBranchMoveMergesDto,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { STALE_RUN_MS } from '../register/import/plan-import';
import { AtmBranchMoveRunModel, type AtmBranchMoveRunDoc } from './branch-move-run.model';

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** The oldest start a `running` run may have and still hold the lock. */
const freshSince = (now: Date): Date => new Date(now.getTime() - STALE_RUN_MS);

export const atmBranchMoveRunRepository = {
  /**
   * A run that has said nothing for 30 minutes is taken over (the register import's rule): its
   * request died with the process. It ends `failed` — what it moved stays moved, and the next run
   * carries on from the rows still under the source. Returns the runs taken over, as they ended:
   * each is claimed by one write, so of two takeovers racing only one gets it (and audits it).
   */
  async failStale(now: Date): Promise<AtmBranchMoveRunDoc[]> {
    const taken: AtmBranchMoveRunDoc[] = [];
    for (;;) {
      const run = await AtmBranchMoveRunModel.findOneAndUpdate(
        { state: 'running', startedAt: { $lt: freshSince(now) } },
        { $set: { state: 'failed', finishedAt: now, error: 'stale' } },
        { new: true },
      )
        .lean<AtmBranchMoveRunDoc>()
        .exec();
      if (run === null) return taken;
      taken.push(run);
    }
  },

  /** Whether another run holds the lock now — a stale one does not, and `exceptId` is the caller's. */
  async lockHeld(now: Date, exceptId: Types.ObjectId | null): Promise<boolean> {
    const found = await AtmBranchMoveRunModel.exists({
      state: 'running',
      startedAt: { $gte: freshSince(now) },
      ...(exceptId === null ? {} : { _id: { $ne: exceptId } }),
    }).exec();
    return found !== null;
  },

  /** The lock: the run's row, inserted `running`. Null when another run holds it. */
  async start(input: {
    sourceBranchId: string;
    targetBranchId: string;
    actorUserId: string | null;
    actorName: string | null;
    startedAt: Date;
  }): Promise<Types.ObjectId | null> {
    try {
      const run = await AtmBranchMoveRunModel.create({
        sourceBranchId: new Types.ObjectId(input.sourceBranchId),
        targetBranchId: new Types.ObjectId(input.targetBranchId),
        state: 'running',
        actorUserId: input.actorUserId === null ? null : new Types.ObjectId(input.actorUserId),
        actorName: input.actorName,
        startedAt: input.startedAt,
        finishedAt: null,
        moved: emptyAtmBranchMoveCounts(),
        merges: emptyAtmBranchMoveMerges(),
        remaining: null,
        error: null,
      });
      return run._id;
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  },

  /** What the run has done so far — written after every step, so a crash leaves its record. */
  async progress(
    id: Types.ObjectId,
    moved: AtmBranchMoveCountsDto,
    merges: AtmBranchMoveMergesDto,
  ): Promise<void> {
    await AtmBranchMoveRunModel.updateOne(
      { _id: id, state: 'running' },
      { $set: { moved, merges } },
    ).exec();
  },

  /** The run's end, `done` or `failed`; the lock is free afterwards. */
  async finish(
    id: Types.ObjectId,
    end: Pick<AtmBranchMoveRunDoc, 'state' | 'moved' | 'merges' | 'remaining' | 'error'>,
  ): Promise<void> {
    await AtmBranchMoveRunModel.updateOne(
      { _id: id, state: 'running' },
      { $set: { ...end, finishedAt: new Date() } },
    ).exec();
  },

  /** A run refused before it wrote anything leaves no record: its row is removed, and the lock with it. */
  async release(id: Types.ObjectId): Promise<void> {
    await AtmBranchMoveRunModel.deleteOne({ _id: id, state: 'running' }).exec();
  },
};
