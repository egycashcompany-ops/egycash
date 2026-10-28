// One «نقل البيانات» run — a linked source branch's ATM data re-filed under its target
// (GET/POST /atm/branch-links/:sourceBranchId/move, contracts atm-settings.ts).
//
// The register import's run-record shape (register/import/register-import-run.model.ts): ONE
// `running` run at a time — the unique partial index is the lock — and a run left `running` for 30
// minutes is taken over by the next one (`STALE_RUN_MS`), marked `failed` (the contract has no
// `abandoned` state). The run is also the record of what it did: who, which pair, the rows moved
// per collection, the merges, and what was still under the source when it ended. The audit trail
// gets ONE `atmBranchMove` row per run that wrote (the `atmRegisterImport` shape), never one per row
// — a run taken over as stale gets it then, since its own request died before its end — beside the
// `delete` row each retired machine twin gets, as the legacy delete audits each master.
//
// Operational bookkeeping (the go-live-run precedent): no soft delete, no versioning. Nothing here is
// row content — counts, ids, and an error's name and code only.
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_BRANCH_MOVE_RUN_STATES,
  emptyAtmBranchMoveCounts,
  emptyAtmBranchMoveMerges,
  type AtmBranchMoveCountsDto,
  type AtmBranchMoveMergesDto,
  type AtmBranchMoveRunState,
} from '@ecms/contracts';

export interface AtmBranchMoveRunDoc {
  _id: Types.ObjectId;
  /** The STORED link's pair — never taken from a request. */
  sourceBranchId: Types.ObjectId;
  targetBranchId: Types.ObjectId;
  state: AtmBranchMoveRunState;
  actorUserId: Types.ObjectId | null;
  actorName: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** Rows re-filed under the target so far, per collection. */
  moved: AtmBranchMoveCountsDto;
  merges: AtmBranchMoveMergesDto;
  /** Rows still under the source when the run ended; null while it runs. */
  remaining: AtmBranchMoveCountsDto | null;
  /** An error's name and code only — never a message that could quote a row. */
  error: string | null;
}

/**
 * The run's audit ref — the LITERAL `atm`/`branchMove` pair lives here, beside the model, so the
 * realtime registry's classification of `atm.branchMove` is backed by a source its spec can see
 * (the `importAuditRef` precedent). Callers never retype the pair.
 */
export const branchMoveAuditRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'branchMove',
  entityId: id,
});

const runSchema = new Schema<AtmBranchMoveRunDoc>(
  {
    sourceBranchId: { type: Schema.Types.ObjectId, required: true },
    targetBranchId: { type: Schema.Types.ObjectId, required: true },
    state: { type: String, required: true, enum: ATM_BRANCH_MOVE_RUN_STATES },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    actorName: { type: String, default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    moved: { type: Schema.Types.Mixed, default: emptyAtmBranchMoveCounts },
    merges: { type: Schema.Types.Mixed, default: emptyAtmBranchMoveMerges },
    remaining: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  { versionKey: false, minimize: false },
);

// One running move at a time: a second run's insert is refused, never interleaved — two runs over
// one source would merge its labels and retire its twins twice.
runSchema.index(
  { state: 1 },
  { unique: true, name: 'ux_one_running', partialFilterExpression: { state: 'running' } },
);
runSchema.index({ startedAt: -1 }, { name: 'ix_startedAt' });

export const AtmBranchMoveRunModel = model<AtmBranchMoveRunDoc>(
  'AtmBranchMoveRun',
  runSchema,
  'atm_branch_move_runs',
);
