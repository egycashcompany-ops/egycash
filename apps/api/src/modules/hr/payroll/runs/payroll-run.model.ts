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
    partialFilterExpression: { status: { $in: ['draft', 'frozen'] }, isDeleted: false },
  },
);
payrollRunSchema.index({ status: 1, period: -1 }, { name: 'ix_status_period' });

export const PayrollRunModel = model<PayrollRunDoc>(
  'HrPayrollRun',
  payrollRunSchema,
  'hr_payroll_runs',
);
