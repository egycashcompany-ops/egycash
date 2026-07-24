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
