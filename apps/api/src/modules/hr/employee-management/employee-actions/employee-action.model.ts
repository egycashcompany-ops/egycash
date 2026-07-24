// Personnel Actions — the append-only employment history (frozen design §3). One document per
// action; immutable once written except the append-only status flips scheduled → applied /
// cancelled / failed. `changes[].to` is captured at creation; the authoritative `from` values
// are captured at APPLICATION time (C1). `seq` is the per-employee total order (allocated by
// an atomic `$inc` on the employee document). Salary-bearing values are redacted at the DTO
// layer for callers without `employee.viewCompensation` — never here.
import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  EMPLOYEE_ACTION_STATUSES,
  EMPLOYEE_ACTION_TYPES,
  type EmployeeActionStatus,
  type EmployeeActionType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EmployeeActionChange {
  field: string;
  /** JSON snapshot; null until the action applies. */
  from: unknown;
  to: unknown;
}

export interface EmployeeActionDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  /** Denormalized for lists (the code AT CREATION time — transfers change the live code). */
  employeeCode: string;
  seq: number;
  type: EmployeeActionType;
  status: EmployeeActionStatus;
  effectiveDate: Date;
  appliedAt: Date | null;
  changes: EmployeeActionChange[];
  /**
   * The validated create payload (typed per action type) — what the action DOES when it
   * applies. Kept verbatim so scheduled actions re-derive everything at application time.
   */
  payload: Record<string, unknown>;
  reason: string | null;
  note: string | null;
  attachmentFileId: Types.ObjectId | null;
  failureReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: Types.ObjectId | null;
  by: Types.ObjectId | null;
}

const changeSchema = new Schema<EmployeeActionChange>(
  {
    field: { type: String, required: true },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const employeeActionSchema = new Schema<EmployeeActionDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    seq: { type: Number, required: true },
    type: { type: String, enum: EMPLOYEE_ACTION_TYPES, required: true },
    status: { type: String, enum: EMPLOYEE_ACTION_STATUSES, required: true },
    effectiveDate: { type: Date, required: true },
    appliedAt: { type: Date, default: null },
    changes: { type: [changeSchema], default: [] },
    payload: { type: Schema.Types.Mixed, required: true },
    reason: { type: String, default: null },
    note: { type: String, default: null },
    attachmentFileId: { type: Schema.Types.ObjectId, default: null },
    failureReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    by: { type: Schema.Types.ObjectId, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The per-employee total order of the employment history.
employeeActionSchema.index({ employeeId: 1, seq: 1 }, { unique: true, name: 'ux_employee_seq' });
// Timeline paging by date within one employee.
employeeActionSchema.index({ employeeId: 1, effectiveDate: 1 }, { name: 'ix_employee_effectiveDate' });
// The scheduler's due-work scan: scheduled actions whose effective date has arrived.
employeeActionSchema.index({ status: 1, effectiveDate: 1 }, { name: 'ix_status_effectiveDate' });
employeeActionSchema.index({ type: 1 }, { name: 'ix_type' });

/** Hydrated (save-able) document — what the engine mutates on status flips. */
export type EmployeeActionEntity = HydratedDocument<EmployeeActionDoc>;

export const EmployeeActionModel = model<EmployeeActionDoc>(
  'EmployeeAction',
  employeeActionSchema,
  'hr_employee_actions',
);
