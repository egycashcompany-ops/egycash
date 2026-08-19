// A payroll adjustment (P-HR-04) — one bonus or penalty, for one employee, for one month.
//
// PERIOD-KEYED, NOT INTERVAL-KEYED, and that is the difference from `employee_pay_items`. A pay
// item is a rate that runs between two dates and gets prorated by the days it covered; this is a
// decision about a single month, so the month IS the key. It also makes the freeze check a
// membership test — `period ∈ frozenPeriods()` — rather than a range query.
//
// `branchId` is the ADR-015 scope field, denormalized from the employee at write time like every
// other HR collection; visibility itself is inherited from the employee, exactly as Personnel
// Actions and pay-item assignments do it.
import { Schema, model, type Types } from 'mongoose';
import {
  PAYROLL_ADJUSTMENT_KINDS,
  PAYROLL_ADJUSTMENT_STATUSES,
  type PayrollAdjustmentKind,
  type PayrollAdjustmentStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface PayrollAdjustmentDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  /** `YYYY-MM`, Cairo month. */
  period: string;
  kind: PayrollAdjustmentKind;
  /** Major units, at the storage precision the payroll money module defines. Always positive. */
  amount: number;
  currency: string;
  reason: string;
  /** Optional (D4): lends the compensation line its identity, never its arithmetic. */
  payItemId: Types.ObjectId | null;
  note: string | null;
  attachmentFileId: Types.ObjectId | null;
  status: PayrollAdjustmentStatus;
  submittedBy: Types.ObjectId | null;
  submittedAt: Date | null;
  decidedBy: Types.ObjectId | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  cancelledBy: Types.ObjectId | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  branchId: Types.ObjectId | null;
  /**
   * The employee's department when this row was written (P-SCOPE-1, D-DEPT-2).
   *
   * The second scope axis, a snapshot beside `branchId` and written the same way. Null only on
   * rows created before this phase; the migration fills those, and until it runs a
   * department-scoped reader does not see them (D-DEPT-4).
   */
  departmentId: Types.ObjectId | null;
}

const payrollAdjustmentSchema = new Schema<PayrollAdjustmentDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    period: { type: String, required: true },
    kind: { type: String, enum: PAYROLL_ADJUSTMENT_KINDS, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'EGP' },
    reason: { type: String, required: true },
    payItemId: { type: Schema.Types.ObjectId, default: null },
    note: { type: String, default: null },
    attachmentFileId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: PAYROLL_ADJUSTMENT_STATUSES, required: true, default: 'draft' },
    submittedBy: { type: Schema.Types.ObjectId, default: null },
    submittedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The access path the payroll port takes — one employee, one month — and the one the duplicate
// check takes. NOT a unique index: "an identical LIVE entry" is a predicate over `status` and
// `reason`, which no single key expresses (a cancelled entry must not block a corrected re-entry).
// The service holds that rule; this is what makes its check cheap — the same division of labour
// `employee_pay_items` uses for its overlap rule.
payrollAdjustmentSchema.index({ employeeId: 1, period: 1 }, { name: 'ix_employee_period' });
// The approval queue, and the period-wide read a run needs.
payrollAdjustmentSchema.index({ period: 1, status: 1 }, { name: 'ix_period_status' });

export const PayrollAdjustmentModel = model<PayrollAdjustmentDoc>(
  'HrPayrollAdjustment',
  payrollAdjustmentSchema,
  'hr_payroll_adjustments',
);
