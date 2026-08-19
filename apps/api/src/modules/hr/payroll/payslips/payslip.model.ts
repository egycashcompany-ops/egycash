// The payslip (PY-7) — one employee's pay for one run, written down.
//
// A DELIBERATE COPY. Every figure here exists elsewhere at the moment it is written, and would be
// re-derivable if the inputs held still. They do not: the basic salary is a single value that a
// salary change overwrites, a pay-item assignment can be created with a date inside an already
// frozen month, and a catalog item's display name is editable. So the document that somebody is
// paid against keeps its own copy, and `runId` records which frozen version of the truth it was.
//
// WHAT IT DOES NOT KEEP. No `deferred` array: a payslip is never issued with a line that has no
// figure, so there is nothing to carry. No tax, no contribution, no `gross`, no payment status —
// none of those exists in this system, and a column for one would be a claim that it does.
import { Schema, model, type Types } from 'mongoose';
import {
  type CompensationLineDto,
  type CompensationWarning,
  type LeavePayFactsDto,
  type PayslipEmployeeDto,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface PayslipDoc extends BaseDocFields {
  runId: Types.ObjectId;
  period: string;
  employeeId: Types.ObjectId;
  /** Identity as it stood at issue — a transfer next month must not retitle a delivered slip. */
  employee: PayslipEmployeeDto;
  currency: string;
  basicSalary: number;
  employmentDaysInPeriod: number;
  daysInPeriod: number;
  earnings: CompensationLineDto[];
  deductions: CompensationLineDto[];
  leave: LeavePayFactsDto | null;
  totalEarningsMinor: number;
  totalDeductionsMinor: number;
  netMinor: number;
  warnings: CompensationWarning[];
  issuedAt: Date;
  issuedBy: Types.ObjectId;
  /** ADR-015 scope field, denormalized from the employee at write time like every HR collection. */
  branchId: Types.ObjectId | null;
  /**
   * The employee's department at ISSUE (P-SCOPE-1, D-DEPT-2).
   *
   * The second scope axis, and a SNAPSHOT for the same reason `branchId` is: a transfer recorded
   * tomorrow must not move a payslip that was already paid. Without this field a `department`-scoped
   * grant narrowed nothing at all and read as `organization` — F-B1-1, which this closes.
   *
   * Null only on payslips issued before this phase; the migration fills them from the action log
   * at the issue date, and until it runs a department reader does not see them (D-DEPT-4).
   */
  departmentId: Types.ObjectId | null;
  /**
   * The cost centre in force on the LAST DAY OF THE PERIOD (P-HR-23, D-CC-7).
   *
   * A snapshot beside `branchId` and written the same way — once, under `$setOnInsert`. Editing
   * the employee's membership afterwards cannot reach a payslip that was already issued, which is
   * why membership needs no frozen-period guard of its own.
   */
  costCenterId: Types.ObjectId | null;
}

/**
 * A line, stored exactly as it was priced.
 *
 * `strict: false` over an empty definition, and that is the point rather than laziness: a line's
 * shape is a CONTRACT that later phases may extend, and a schema that pruned an unknown key would
 * silently drop a figure from a document nobody may edit. What is written is what was priced.
 */
const storedLineSchema = new Schema({}, { _id: false, strict: false });

const payslipSchema = new Schema<PayslipDoc>(
  {
    runId: { type: Schema.Types.ObjectId, required: true },
    period: { type: String, required: true },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employee: { type: Schema.Types.Mixed, required: true },
    currency: { type: String, required: true },
    basicSalary: { type: Number, required: true },
    employmentDaysInPeriod: { type: Number, required: true },
    daysInPeriod: { type: Number, required: true },
    earnings: { type: [storedLineSchema], default: [] },
    deductions: { type: [storedLineSchema], default: [] },
    leave: { type: Schema.Types.Mixed, default: null },
    totalEarningsMinor: { type: Number, required: true },
    totalDeductionsMinor: { type: Number, required: true },
    netMinor: { type: Number, required: true },
    warnings: { type: [String], default: [] },
    issuedAt: { type: Date, required: true },
    issuedBy: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    costCenterId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// ONE payslip per employee per run — the constraint that makes issuing idempotent. A second pass
// over the same run finds every row already there and writes nothing, which is what stops a
// re-issue from restating a delivered document with today's salary.
//
// And because `ux_live_period` already allows at most one live run per period, this gives "one
// live payslip per employee per month" without a second index having to say so.
payslipSchema.index(
  { runId: 1, employeeId: 1 },
  { unique: true, name: 'ux_run_employee', partialFilterExpression: { isDeleted: false } },
);
// The employee's own history, newest month first.
payslipSchema.index({ employeeId: 1, period: -1 }, { name: 'ix_employee_period' });
// P-SCOPE-1 / D-DEPT-6 — every read by a department-scoped caller now filters on this, and the
// run leads because every one of those reads names a run first.
payslipSchema.index({ departmentId: 1, runId: 1 }, { name: 'ix_department_run' });

export const PayslipModel = model<PayslipDoc>('HrPayslip', payslipSchema, 'hr_payslips');
