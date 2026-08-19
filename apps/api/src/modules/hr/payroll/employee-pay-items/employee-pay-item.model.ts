// Employee pay items (PY-2): what a catalog item is worth to one employee, over one dated
// interval.
//
// An interval, not a value, because a raise is not an edit — June must keep being priced with
// June's amount after July's is recorded. So the row is closed and a new one opens, and the pair
// (employeeId, payItemId) may never carry two overlapping intervals: on any day exactly one
// amount is in force, or none.
//
// `branchId` is the ADR-015 scope field, denormalized from the employee at write time like every
// other HR collection; visibility itself is inherited from the employee (the caller scopes the
// employee first, exactly as Personnel Actions do).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EmployeePayItemDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  payItemId: Types.ObjectId;
  /** Major units, at the storage precision the payroll money module defines. */
  amount: number;
  currency: string;
  /** Date-only (UTC midnight of the Cairo calendar date). */
  effectiveFrom: Date;
  /** Inclusive; null = open-ended. */
  effectiveTo: Date | null;
  note: string | null;
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

const employeePayItemSchema = new Schema<EmployeePayItemDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    payItemId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'EGP' },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    note: { type: String, default: null },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The overlap query's access path, and the natural read order of an employee's compensation
// history. Not a unique index: "no overlapping interval" is a range condition, which no single
// key can express — the service holds it, and this is what makes its check cheap.
employeePayItemSchema.index(
  { employeeId: 1, payItemId: 1, effectiveFrom: 1 },
  { name: 'ix_employee_item_from' },
);
employeePayItemSchema.index({ employeeId: 1, effectiveFrom: -1 }, { name: 'ix_employee_from' });

export const EmployeePayItemModel = model<EmployeePayItemDoc>(
  'HrEmployeePayItem',
  employeePayItemSchema,
  'hr_employee_pay_items',
);
