// The leave snapshot (PY-6) — one leave consumption, as one run pinned it.
//
// WHY IT EXISTS. The leave ledger is live: a request completes, is cancelled, or returns early
// AFTER a period has been priced, and a `consume` entry is appended when it does. Reading it at
// pricing time would give the same month two different answers on two different days — the exact
// failure the attendance freeze exists to prevent, with no equivalent guard on the leave side.
//
// AND WHY IT IS DATED. A `consume` entry is split by YEAR, never by month, so a request running
// from 28 March to 6 April is ONE entry whose `paidBreakdown` carries no dates at all. Which of
// those days fall in March is a question the ledger cannot answer. This row answers it once, at
// freeze time, and records HOW it was answered in `allocation` — so the inference is visible and
// reviewable rather than repeated invisibly at every calculation.
//
// A deliberate duplication of the ledger, in other words, and `ledgerEntryId` keeps the original
// one hop away.
import { Schema, model, type Types } from 'mongoose';
import {
  PAYROLL_LEAVE_ALLOCATIONS,
  type LeavePaidBreakdown,
  type PayrollLeaveAllocation,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface PayrollLeaveSnapshotDoc extends BaseDocFields {
  runId: Types.ObjectId;
  period: string;
  employeeId: Types.ObjectId;
  /** Provenance — the ledger entry this row pinned. */
  ledgerEntryId: Types.ObjectId;
  requestId: Types.ObjectId | null;
  typeId: Types.ObjectId;
  typeCode: string;
  /** The slice INSIDE this period, inclusive. */
  from: Date;
  to: Date;
  /** Days of the slice, in half-day steps. */
  days: number;
  breakdown: LeavePaidBreakdown[];
  allocation: PayrollLeaveAllocation;
  snapshotAt: Date;
}

const snapshotSchema = new Schema<PayrollLeaveSnapshotDoc>(
  {
    runId: { type: Schema.Types.ObjectId, required: true },
    period: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    ledgerEntryId: { type: Schema.Types.ObjectId, required: true },
    requestId: { type: Schema.Types.ObjectId, default: null },
    typeId: { type: Schema.Types.ObjectId, required: true },
    typeCode: { type: String, required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    days: { type: Number, required: true },
    breakdown: {
      type: [new Schema({ days: Number, payRate: Number }, { _id: false })],
      default: [],
    },
    allocation: { type: String, enum: [...PAYROLL_LEAVE_ALLOCATIONS], required: true },
    snapshotAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The idempotency that makes a retried freeze safe: a freeze interrupted half way leaves the run
// in `draft`, and pressing freeze again re-walks the same entries without doubling a single row.
snapshotSchema.index(
  { runId: 1, ledgerEntryId: 1, from: 1 },
  { unique: true, name: 'ux_run_entry_from' },
);
snapshotSchema.index({ runId: 1, employeeId: 1 }, { name: 'ix_run_employee' });

export const PayrollLeaveSnapshotModel = model<PayrollLeaveSnapshotDoc>(
  'HrPayrollLeaveSnapshot',
  snapshotSchema,
  'hr_payroll_leave_snapshots',
);
