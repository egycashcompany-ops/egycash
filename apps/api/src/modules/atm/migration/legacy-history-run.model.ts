// One legacy history run — a legacy deployment's replenishments and maintenances copied into one
// ECMS branch (docs/12-planning/atm-legacy-history-import.md §4.7). The branch-move run's shape
// (branch-links/branch-move-run.model.ts): ONE `running` run at a time — the unique partial index
// is the lock — and the run is also the record of what it did: who, which source into which branch,
// the cutover day, the time modes and the counts. A run steps: each step reads the next rows in
// legacy `_id` order and stores where it stopped (`cursor`), so the screen's loop can pause and
// resume it. A run with no step for 30 minutes is stale: until a new start ends it `failed` (and
// takes the lock) it can still be resumed. A step holds a two-minute lease on the run, so a second
// step sent meanwhile is refused instead of reading the same rows.
//
// Operational bookkeeping (the go-live-run precedent): no soft delete, no versioning beyond the
// step claim. Nothing here is row content — counts, ids and an error's code only.
import { Schema, model, type Types } from 'mongoose';
import {
  ATM_LEGACY_KINDS,
  ATM_LEGACY_RUN_STATES,
  ATM_LEGACY_SOURCE_NAMES,
  type AtmLegacyKind,
  type AtmLegacyRunState,
  type AtmLegacySkipCountsDto,
  type AtmLegacySource,
  type AtmLegacyTimeEvidenceDto,
  type AtmLegacyTimeMode,
} from '@ecms/contracts';

/** One kind's counts so far. */
export interface AtmLegacyKindCounts {
  read: number;
  written: number;
  existing: number;
  skipped: AtmLegacySkipCountsDto;
}

export interface AtmLegacyImportRunDoc {
  _id: Types.ObjectId;
  source: AtmLegacySource;
  branchId: Types.ObjectId;
  /** The moment the branch began working in ECMS (design §4.4); null: no cut. */
  cutoverAt: Date | null;
  state: AtmLegacyRunState;
  /** Where the next step reads: the kind, and the last legacy `_id` read of it. Kind null: done. */
  cursor: { kind: AtmLegacyKind | null; after: Types.ObjectId | null };
  /** Bumped by each step's claim; a save names the step it claimed. */
  step: number;
  /** Held by the step in progress; null between steps. A crashed step's lease lapses. */
  leaseUntil: Date | null;
  counts: Record<AtmLegacyKind, AtmLegacyKindCounts>;
  /** Chosen when the run started, from the counts beside them (design §4.3). */
  modes: Record<AtmLegacyKind, AtmLegacyTimeMode>;
  evidence: Record<AtmLegacyKind, AtmLegacyTimeEvidenceDto>;
  /** Legacy rows of each kind when the run started — the progress bar's denominator. */
  totals: Record<AtmLegacyKind, number>;
  actorUserId: Types.ObjectId | null;
  actorName: string | null;
  startedAt: Date;
  lastStepAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

/**
 * The run's audit ref — the LITERAL `atm`/`legacyImport` pair lives here, beside the model, so the
 * realtime registry's classification of `atm.legacyImport` is backed by a source its spec can see
 * (the `branchMoveAuditRef` precedent). Callers never retype the pair.
 */
export const legacyImportAuditRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'legacyImport',
  entityId: id,
});

const runSchema = new Schema<AtmLegacyImportRunDoc>(
  {
    source: { type: String, required: true, enum: ATM_LEGACY_SOURCE_NAMES },
    branchId: { type: Schema.Types.ObjectId, required: true },
    cutoverAt: { type: Date, default: null },
    state: { type: String, required: true, enum: ATM_LEGACY_RUN_STATES },
    cursor: {
      kind: { type: String, enum: [...ATM_LEGACY_KINDS, null], default: null },
      after: { type: Schema.Types.ObjectId, default: null },
    },
    step: { type: Number, required: true, default: 0 },
    leaseUntil: { type: Date, default: null },
    counts: { type: Schema.Types.Mixed, required: true },
    modes: { type: Schema.Types.Mixed, required: true },
    evidence: { type: Schema.Types.Mixed, required: true },
    totals: { type: Schema.Types.Mixed, required: true },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    actorName: { type: String, default: null },
    startedAt: { type: Date, required: true },
    lastStepAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { versionKey: false, minimize: false },
);

// One running run at a time, company-wide: a second start's insert is refused, never interleaved.
runSchema.index(
  { state: 1 },
  { unique: true, name: 'ux_one_running', partialFilterExpression: { state: 'running' } },
);
// The card's last run per source.
runSchema.index({ source: 1, startedAt: -1 }, { name: 'ix_source_startedAt' });

export const AtmLegacyImportRunModel = model<AtmLegacyImportRunDoc>(
  'AtmLegacyImportRun',
  runSchema,
  'atm_legacy_import_runs',
);
