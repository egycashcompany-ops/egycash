// The payroll run (PY-6) — one period, and the moment its facts stopped moving.
//
// It stores no figure. What it records is which period, what state it is in, and — once frozen —
// exactly what the freeze pinned: how many attendance rows were stamped, how many were recomputed
// on the way, and how many leave slices were snapshotted. Those counts are the run's receipt.
//
// THERE IS NO UNFREEZE. Cancelling changes `status` and nothing else: frozen attendance rows stay
// frozen, the snapshot is left exactly as written, and a recalculation happens through a NEW run.
import { Schema, model, type Types } from 'mongoose';
import { PAYROLL_RUN_STATUSES, type PayrollRunStatus } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface PayrollRunDoc extends BaseDocFields {
  /** `YYYY-MM`, Cairo calendar month — the same period key attendance freezes by. */
  period: string;
  status: PayrollRunStatus;
  frozenAt: Date | null;
  frozenBy: Types.ObjectId | null;
  /** The freeze's own report — proof of which version of the truth this run pinned. */
  attendanceFrozenRows: number;
  attendanceComputedRows: number;
  leaveSnapshotRows: number;
  // The governance stamps (P-HR-10). Each is written by exactly one transition and never cleared.
  approvedAt: Date | null;
  approvedBy: Types.ObjectId | null;
  approvalNote: string | null;
  paidAt: Date | null;
  paidBy: Types.ObjectId | null;
  /** The DAY the money left, which is not the instant somebody recorded it. */
  paidOn: Date | null;
  paymentReference: string | null;
  closedAt: Date | null;
  closedBy: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  cancelReason: string | null;
  note: string | null;
}

const payrollRunSchema = new Schema<PayrollRunDoc>(
  {
    period: { type: String, required: true },
    status: { type: String, enum: [...PAYROLL_RUN_STATUSES], required: true, default: 'draft' },
    frozenAt: { type: Date, default: null },
    frozenBy: { type: Schema.Types.ObjectId, default: null },
    attendanceFrozenRows: { type: Number, required: true, default: 0 },
    attendanceComputedRows: { type: Number, required: true, default: 0 },
    leaveSnapshotRows: { type: Number, required: true, default: 0 },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, default: null },
    approvalNote: { type: String, default: null },
    paidAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, default: null },
    paidOn: { type: Date, default: null },
    paymentReference: { type: String, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    cancelReason: { type: String, default: null },
    note: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// ONE live run per period. Two runs freezing the same month would each claim to have pinned it,
// and the second would find everything already frozen and report a receipt of zero. A cancelled
// run does not occupy the period — which is precisely what "recalculate with a new run" needs.
payrollRunSchema.index(
  { period: 1 },
  {
    unique: true,
    name: 'ux_live_period',
    // Widened with the lifecycle (P-HR-10): a period has ONE run that is not cancelled, whatever
    // stage it has reached. Leaving this at draft/frozen would have let a second run be created for
    // a month whose first run was merely approved — a hole that opens the moment a state is added
    // past `frozen`, which is exactly what this phase did.
    partialFilterExpression: {
      status: { $in: ['draft', 'frozen', 'approved', 'paid', 'closed'] },
      isDeleted: false,
    },
  },
);
payrollRunSchema.index({ status: 1, period: -1 }, { name: 'ix_status_period' });

export const PayrollRunModel = model<PayrollRunDoc>(
  'HrPayrollRun',
  payrollRunSchema,
  'hr_payroll_runs',
);
