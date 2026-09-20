// Leave Request aggregate (frozen design §3/§6). Placement fields are denormalized for the
// platform's declarative scoping; `employeeUserId` is the own-scope owner field (C1-R),
// backfilled by the loginLinked subscriber for requests filed before a login existed.
// `days` is FROZEN at submission (R7). `approvals` stores decided steps only — the pending
// step is derived from the status; the manager binding is dynamic (R9b).
import { Schema, type Types, model } from 'mongoose';
import {
  type LeaveRequestStatus,
  type LeaveStatusDriveOutcome,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface LeaveApprovalStep {
  step: 'manager' | 'hr';
  deciderUserId: Types.ObjectId;
  decision: 'approved' | 'rejected';
  comment: string | null;
  at: Date;
}

/**
 * One rung of a CONFIGURED chain, exactly as the platform engine hands it back.
 *
 * A second list beside `approvals` rather than a widening of it, and deliberately so. The old list
 * is the two-desk machine's record and every row in it means «manager or HR decided»; this one
 * means «rung N of the chain this request's department configured». Folding them together would
 * make every existing row need a rung index it never had, and would make the reader of a
 * four-year-old request guess which shape he was looking at.
 *
 * A request carries one or the other, never both, and which one is settled at submission.
 */
export interface LeaveApprovalEntry {
  stepIndex: number;
  outcome: 'approved' | 'rejected' | 'skipped' | 'covered' | 'unreached';
  deciderUserId: Types.ObjectId | null;
  decidedAt: Date;
  comment: string | null;
  overriddenWith: string | null;
}

export interface LeaveRequestDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeUserId: Types.ObjectId | null;
  employeeCode: string;
  employeeName: string;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
  sectionId: Types.ObjectId | null;
  typeId: Types.ObjectId;
  typeCode: string;
  status: LeaveRequestStatus;
  startDate: Date;
  endDate: Date;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  days: number;
  reason: string | null;
  attachments: Types.ObjectId[];
  approvals: LeaveApprovalStep[];
  /** The engine's trail. Empty on a request the two-desk machine is running. */
  approvalSteps: LeaveApprovalEntry[];
  actualReturnDate: Date | null;
  statusDriveOutcome: LeaveStatusDriveOutcome | null;
  cancelReason: string | null;
}

const approvalStepSchema = new Schema<LeaveApprovalStep>(
  {
    step: { type: String, required: true },
    deciderUserId: { type: Schema.Types.ObjectId, required: true },
    decision: { type: String, required: true },
    comment: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const approvalEntrySchema = new Schema<LeaveApprovalEntry>(
  {
    stepIndex: { type: Number, required: true },
    outcome: { type: String, required: true },
    deciderUserId: { type: Schema.Types.ObjectId, default: null },
    decidedAt: { type: Date, required: true },
    comment: { type: String, default: null },
    overriddenWith: { type: String, default: null },
  },
  { _id: false },
);

const leaveRequestSchema = new Schema<LeaveRequestDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeUserId: { type: Schema.Types.ObjectId, default: null },
    employeeCode: { type: String, required: true },
    employeeName: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    departmentId: { type: Schema.Types.ObjectId, default: null },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    typeId: { type: Schema.Types.ObjectId, required: true },
    typeCode: { type: String, required: true },
    status: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    halfDayStart: { type: Boolean, required: true, default: false },
    halfDayEnd: { type: Boolean, required: true, default: false },
    days: { type: Number, required: true },
    reason: { type: String, default: null },
    attachments: { type: [Schema.Types.ObjectId], default: [] },
    approvals: { type: [approvalStepSchema], default: [] },
    approvalSteps: { type: [approvalEntrySchema], default: [] },
    actualReturnDate: { type: Date, default: null },
    statusDriveOutcome: { type: String, default: null },
    cancelReason: { type: String, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

leaveRequestSchema.index({ employeeId: 1, status: 1, startDate: 1 }, { name: 'ix_employee_status_start' });
leaveRequestSchema.index({ status: 1, startDate: 1 }, { name: 'ix_status_start' });
leaveRequestSchema.index({ branchId: 1, status: 1, startDate: 1 }, { name: 'ix_branch_status_start' });
leaveRequestSchema.index({ employeeUserId: 1, startDate: 1 }, { name: 'ix_owner_start' });

export const LeaveRequestModel = model<LeaveRequestDoc>(
  'LeaveRequest',
  leaveRequestSchema,
  'hr_leave_requests',
);

/** Hydrated (save-able) request for the lifecycle paths. */
export type LeaveRequestEntity = ReturnType<(typeof LeaveRequestModel)['hydrate']>;
