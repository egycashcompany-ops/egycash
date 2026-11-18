// The history backfill (Task 2) — the record of a recompute far too big for a request.
//
// WHY A RUN PLUS CHUNKS, and not a single job that loops. The branch machines hold scans back to
// December 2024 for 655 people; recomputing that is on the order of 450,000 employee-days, which
// no HTTP request, and no single queue job, can hold. Split into chunks it becomes ordinary work:
// a worker CLAIMS one chunk at a time, so several workers can run side by side without agreeing
// on anything, and a worker that dies loses exactly one chunk's progress — which the next claim
// re-offers, because recomputing a day is idempotent by construction.
//
// NOTHING HERE IS A SOURCE OF TRUTH ABOUT ATTENDANCE. It is bookkeeping about work: the day rows
// are written by `dayRecordService.computeDay`, under the same freeze guard and the same manager
// decisions as every other derivation, and deleting every document in these two collections would
// cost nothing but the ability to say what had already been done.
import { Schema, model, type Types } from 'mongoose';
import { type AttendanceBackfillScope, type AttendanceBackfillStatus } from '@ecms/contracts';
import {
  baseFields,
  baseSchemaOptions,
  type BaseDocFields,
} from '../../../../shared/base/base.model';

export interface AttendanceBackfillDoc extends BaseDocFields {
  from: Date;
  to: Date;
  scope: AttendanceBackfillScope;
  status: AttendanceBackfillStatus;
  /** How many people the plan covers — fixed when the run is planned, so progress has a stable denominator. */
  employees: number;
  totalChunks: number;
  totalDays: number;
  startedBy: Types.ObjectId | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** The last chunk error seen, kept on the run so a caller polling progress sees it. */
  lastError: string | null;
}

const backfillSchema = new Schema<AttendanceBackfillDoc>(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    scope: { type: String, required: true },
    status: { type: String, required: true },
    employees: { type: Number, required: true },
    totalChunks: { type: Number, required: true },
    totalDays: { type: Number, required: true },
    startedBy: { type: Schema.Types.ObjectId, default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The only read: the newest runs, and "is one still going?".
backfillSchema.index({ status: 1, startedAt: -1 }, { name: 'ix_status_startedAt' });

export const AttendanceBackfillModel = model<AttendanceBackfillDoc>(
  'AttendanceBackfill',
  backfillSchema,
  'hr_attendance_backfills',
);

/** `pending` → `running` → `done` | `failed`. A `running` chunk whose claim went stale is re-offered. */
export type AttendanceBackfillChunkStatus = 'pending' | 'running' | 'done' | 'failed';

export interface AttendanceBackfillChunkDoc extends BaseDocFields {
  runId: Types.ObjectId;
  employeeId: Types.ObjectId;
  from: Date;
  to: Date;
  /**
   * The exact days this chunk owns, as `YYYY-MM-DD`, or null for "every day between from and to".
   *
   * `withPunches` fills this in, which is the whole point of that scope: an import touched a few
   * thousand employee-days scattered over two years, and walking all 450,000 to find them would
   * cost a hundred times more than the work itself.
   */
  dates: string[] | null;
  /** The day count this chunk contributes to the run's denominator. */
  days: number;
  status: AttendanceBackfillChunkStatus;
  attempts: number;
  computed: number;
  skippedFrozen: number;
  failedDays: number;
  claimedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

const chunkSchema = new Schema<AttendanceBackfillChunkDoc>(
  {
    runId: { type: Schema.Types.ObjectId, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    dates: { type: [String], default: null },
    days: { type: Number, required: true },
    status: { type: String, required: true, default: 'pending' },
    attempts: { type: Number, required: true, default: 0 },
    computed: { type: Number, required: true, default: 0 },
    skippedFrozen: { type: Number, required: true, default: 0 },
    failedDays: { type: Number, required: true, default: 0 },
    claimedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    error: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// THE CLAIM'S OWN INDEX, and the progress read's: both are `{runId, status}` and nothing else.
// A backfill of this size is tens of thousands of chunks, and the claim runs once per chunk.
chunkSchema.index({ runId: 1, status: 1 }, { name: 'ix_run_status' });

export const AttendanceBackfillChunkModel = model<AttendanceBackfillChunkDoc>(
  'AttendanceBackfillChunk',
  chunkSchema,
  'hr_attendance_backfill_chunks',
);
