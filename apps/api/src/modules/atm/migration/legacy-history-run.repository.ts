// The legacy history run lock and record (legacy-history-run.model.ts) — the branch-move run's
// writes (branch-links/branch-move-run.repository.ts) plus what a stepped run needs: the step lease,
// the step's save, and the undo's marking.
import {
  ATM_LEGACY_SOURCE_NAMES,
  emptyAtmLegacySkipCounts,
  type AtmLegacyKind,
  type AtmLegacySource,
} from '@ecms/contracts';
import { Types, type UpdateQuery } from 'mongoose';
import { STALE_RUN_MS } from '../register/import/plan-import';
import {
  AtmLegacyImportRunModel,
  type AtmLegacyImportRunDoc,
  type AtmLegacyKindCounts,
} from './legacy-history-run.model';

/** How long one step may hold the run before another may claim it (a step takes seconds). */
export const LEGACY_STEP_LEASE_MS = 2 * 60_000;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000;

/** The oldest last step a `running` run may have and still hold the lock. */
const freshSince = (now: Date): Date => new Date(now.getTime() - STALE_RUN_MS);

export const emptyLegacyKindCounts = (): AtmLegacyKindCounts => ({
  read: 0,
  written: 0,
  existing: 0,
  skipped: emptyAtmLegacySkipCounts(),
});

export const atmLegacyImportRunRepository = {
  async findById(id: string | Types.ObjectId): Promise<AtmLegacyImportRunDoc | null> {
    if (!Types.ObjectId.isValid(String(id))) return null;
    return AtmLegacyImportRunModel.findById(id).lean<AtmLegacyImportRunDoc>().exec();
  },

  /** Each source's latest run, any state. */
  async latestPerSource(): Promise<Map<AtmLegacySource, AtmLegacyImportRunDoc>> {
    const runs = await Promise.all(
      ATM_LEGACY_SOURCE_NAMES.map((source) =>
        AtmLegacyImportRunModel.findOne({ source })
          .sort({ startedAt: -1 })
          .lean<AtmLegacyImportRunDoc>()
          .exec(),
      ),
    );
    return new Map(
      runs
        .filter((run): run is AtmLegacyImportRunDoc => run !== null)
        .map((run) => [run.source, run]),
    );
  },

  /** Every run of a source — the ids its copies carry. */
  async idsOfSource(source: AtmLegacySource): Promise<Types.ObjectId[]> {
    const runs = await AtmLegacyImportRunModel.find({ source })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>()
      .exec();
    return runs.map((run) => run._id);
  },

  /** Whether a run holds the lock now — one that has stepped within 30 minutes. */
  async running(now: Date): Promise<AtmLegacyImportRunDoc | null> {
    return AtmLegacyImportRunModel.findOne({
      state: 'running',
      lastStepAt: { $gte: freshSince(now) },
    })
      .lean<AtmLegacyImportRunDoc>()
      .exec();
  },

  /**
   * A run with no step for 30 minutes is ended `failed` so a new start can take the lock. Returns
   * the runs ended, as they ended: each is claimed by one write, so of two racing only one gets it.
   */
  async failStale(now: Date): Promise<AtmLegacyImportRunDoc[]> {
    const ended: AtmLegacyImportRunDoc[] = [];
    for (;;) {
      const run = await AtmLegacyImportRunModel.findOneAndUpdate(
        { state: 'running', lastStepAt: { $lt: freshSince(now) } },
        { $set: { state: 'failed', finishedAt: now, error: 'stale', leaseUntil: null } },
        { new: true },
      )
        .lean<AtmLegacyImportRunDoc>()
        .exec();
      if (run === null) return ended;
      ended.push(run);
    }
  },

  /** The lock: the run's row, inserted `running`. Null when another run holds it. */
  async start(
    input: Omit<
      AtmLegacyImportRunDoc,
      '_id' | 'state' | 'cursor' | 'step' | 'leaseUntil' | 'counts' | 'finishedAt' | 'error'
    >,
  ): Promise<AtmLegacyImportRunDoc | null> {
    try {
      const run = await AtmLegacyImportRunModel.create({
        ...input,
        state: 'running',
        cursor: { kind: 'replenishment', after: null },
        step: 0,
        leaseUntil: null,
        counts: { replenishment: emptyLegacyKindCounts(), maintenance: emptyLegacyKindCounts() },
        finishedAt: null,
        error: null,
      });
      return run.toObject() as AtmLegacyImportRunDoc;
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  },

  /**
   * Claims the next step of a running run: its lease is taken for `LEGACY_STEP_LEASE_MS` and its
   * step number moves on. Null when the run is not running, or another step holds the lease.
   */
  async claimStep(id: Types.ObjectId, now: Date): Promise<AtmLegacyImportRunDoc | null> {
    return AtmLegacyImportRunModel.findOneAndUpdate(
      {
        _id: id,
        state: 'running',
        $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
      },
      {
        $inc: { step: 1 },
        $set: { lastStepAt: now, leaseUntil: new Date(now.getTime() + LEGACY_STEP_LEASE_MS) },
      },
      { new: true },
    )
      .lean<AtmLegacyImportRunDoc>()
      .exec();
  },

  /**
   * A step's outcome, added to the run, and its lease released — only while the run is still at
   * the step it claimed (`false` otherwise: its lease lapsed and another step took the run over).
   */
  async saveStep(
    id: Types.ObjectId,
    step: number,
    kind: AtmLegacyKind,
    delta: AtmLegacyKindCounts,
    next: AtmLegacyImportRunDoc['cursor'],
    finishedAt: Date | null,
  ): Promise<boolean> {
    const inc: Record<string, number> = {
      [`counts.${kind}.read`]: delta.read,
      [`counts.${kind}.written`]: delta.written,
      [`counts.${kind}.existing`]: delta.existing,
    };
    for (const [reason, count] of Object.entries(delta.skipped)) {
      inc[`counts.${kind}.skipped.${reason}`] = count;
    }
    const update: UpdateQuery<AtmLegacyImportRunDoc> = {
      $inc: inc,
      $set: {
        cursor: next,
        leaseUntil: null,
        ...(finishedAt === null ? {} : { state: 'done', finishedAt }),
      },
    };
    const result = await AtmLegacyImportRunModel.updateOne(
      { _id: id, state: 'running', step },
      update,
    ).exec();
    return result.modifiedCount === 1;
  },

  /** A step that failed gives its lease back, so the next one need not wait for it to lapse. */
  async releaseStep(id: Types.ObjectId, step: number): Promise<void> {
    await AtmLegacyImportRunModel.updateOne(
      { _id: id, state: 'running', step },
      { $set: { leaseUntil: null } },
    ).exec();
  },

  /** The source's runs that are over, marked `undone` once its copies are all gone. */
  async markSourceUndone(source: AtmLegacySource, now: Date): Promise<AtmLegacyImportRunDoc[]> {
    const runs = await AtmLegacyImportRunModel.find({ source, state: { $in: ['done', 'failed'] } })
      .lean<AtmLegacyImportRunDoc[]>()
      .exec();
    await AtmLegacyImportRunModel.updateMany(
      { _id: { $in: runs.map((run) => run._id) }, state: { $in: ['done', 'failed'] } },
      { $set: { state: 'undone', finishedAt: now } },
    ).exec();
    return runs.map((run) => ({ ...run, state: 'undone' as const, finishedAt: now }));
  },
};
