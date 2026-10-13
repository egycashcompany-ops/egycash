// One register workbook import, as it ran (spec §6.1) — the idempotency anchor beside the unique
// `importRow` index, and the only place a run's per-row outcome is kept (DEC-15: the audit trail
// gets ONE `atmRegisterImport` row per apply, never one per Excel row).
//
// Operational bookkeeping, the go-live-run precedent (modules/it/go-live/go-live-run.model.ts): no
// soft delete, no versioning. Nothing here is a cell value — the run stores the file's name and
// hash, the categories applied, counts, row numbers with their outcome, and the header fills
// (EG-2; a colour is not a secret). `error` is written from codes and column letters only.
import { Schema, model, type Types } from 'mongoose';
import { ATM_REGISTER_IMPORT_RUN_STATES, type AtmRegisterImportRunState } from '@ecms/contracts';

export interface AtmRegisterImportRunDoc {
  _id: Types.ObjectId;
  fileName: string;
  fileSha256: string;
  state: AtmRegisterImportRunState;
  actorUserId: Types.ObjectId | null;
  actorName: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  categories: string[];
  reportOverride: boolean;
  /** `ATM_REGISTER_IMPORT_OUTCOMES` → count. */
  counts: Record<string, number>;
  /** No field values — the row number, the entry it wrote, what happened. */
  rows: { importRow: number; entryId: Types.ObjectId | null; outcome: string }[];
  /** Row-1 fills (M, O, Z, AP are red in the owner's sheet — EG-2). */
  headerFills: { column: string; fill: string }[];
  /** Never a cell value. */
  error: string | null;
}

/**
 * The run's audit ref — the LITERAL `atm`/`registerImport` pair lives here, in the file WP-A owns,
 * so the realtime registry's classification of `atm.registerImport` is backed by a source the
 * registry spec can see before the import itself is built. Callers never retype the pair.
 */
export const importAuditRef = (id: string) => ({
  moduleId: 'atm',
  entityType: 'registerImport',
  entityId: id,
});

const runSchema = new Schema<AtmRegisterImportRunDoc>(
  {
    // Not `required`: Mongoose refuses '' for a required String, and an upload's original name is
    // whatever the browser sent.
    fileName: { type: String, default: '' },
    fileSha256: { type: String, required: true },
    state: { type: String, required: true, enum: ATM_REGISTER_IMPORT_RUN_STATES },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    actorName: { type: String, default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    categories: { type: [String], default: [] },
    reportOverride: { type: Boolean, required: true, default: false },
    counts: { type: Schema.Types.Mixed, default: () => ({}) },
    rows: {
      type: [
        new Schema(
          {
            importRow: { type: Number, required: true },
            entryId: { type: Schema.Types.ObjectId, default: null },
            outcome: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    headerFills: {
      type: [new Schema({ column: String, fill: String }, { _id: false })],
      default: [],
    },
    error: { type: String, default: null },
  },
  { versionKey: false, minimize: false },
);

// One running import at a time (DEC-15): a second apply's insert is refused, not interleaved.
runSchema.index(
  { state: 1 },
  { unique: true, name: 'ux_one_running', partialFilterExpression: { state: 'running' } },
);
runSchema.index({ startedAt: -1 }, { name: 'ix_startedAt' });

export const AtmRegisterImportRunModel = model<AtmRegisterImportRunDoc>(
  'AtmRegisterImportRun',
  runSchema,
  'atm_register_import_runs',
);
