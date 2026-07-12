// The Electronic Employee File aggregate (Stage 7) — one per employee, assembled once the
// employee's hiring documents are completed. It is the handoff artifact of the seven-stage
// recruitment workflow (BD-008): it LINKS all applicant history (screening, interviews, offer,
// hiring documents) and holds the initial EMPLOYEE TIMELINE built from the recruitment
// milestones. After this the person is officially an Employee and further concerns belong to
// the Employee module. `employeeCode`/`applicantId`/`branchId` are denormalized for
// list/scoping and stable display (branch is the primary data scope, ADR-015).
import { Schema, model, type Types } from 'mongoose';
import {
  EMPLOYEE_FILE_STATUSES,
  EMPLOYEE_TIMELINE_EVENT_TYPES,
  type EmployeeFileStatus,
  type EmployeeTimelineEventType,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

/** One entry on the Employee Timeline — a recruitment milestone or a free-form note. */
export interface EmployeeTimelineEntry {
  at: Date;
  type: EmployeeTimelineEventType;
  refType: string | null;
  refId: Types.ObjectId | null;
  detail: string | null;
  by: Types.ObjectId | null;
}

/** The linked recruitment history (BD-008 — "link all applicant history"). */
export interface EmployeeFileLinks {
  applicantId: Types.ObjectId;
  jobRequisitionId: Types.ObjectId;
  screeningId: Types.ObjectId | null;
  interviewIds: Types.ObjectId[];
  jobOfferId: Types.ObjectId | null;
  hiringDocumentsId: Types.ObjectId;
}

export interface EmployeeFileDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeCode: string;
  applicantId: Types.ObjectId;
  branchId: Types.ObjectId;
  status: EmployeeFileStatus;
  links: EmployeeFileLinks;
  timeline: EmployeeTimelineEntry[];
}

const timelineEntrySchema = new Schema<EmployeeTimelineEntry>(
  {
    at: { type: Date, required: true },
    type: { type: String, enum: EMPLOYEE_TIMELINE_EVENT_TYPES, required: true },
    refType: { type: String, default: null },
    refId: { type: Schema.Types.ObjectId, default: null },
    detail: { type: String, default: null },
    by: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const linksSchema = new Schema<EmployeeFileLinks>(
  {
    applicantId: { type: Schema.Types.ObjectId, required: true },
    jobRequisitionId: { type: Schema.Types.ObjectId, required: true },
    screeningId: { type: Schema.Types.ObjectId, default: null },
    interviewIds: { type: [Schema.Types.ObjectId], default: [] },
    jobOfferId: { type: Schema.Types.ObjectId, default: null },
    hiringDocumentsId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const employeeFileSchema = new Schema<EmployeeFileDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: EMPLOYEE_FILE_STATUSES, required: true, default: 'active' },
    links: { type: linksSchema, required: true },
    timeline: { type: [timelineEntrySchema], default: [] },
    ...baseFields,
  },
  baseSchemaOptions,
);

// One electronic file per employee.
employeeFileSchema.index(
  { employeeId: 1 },
  { unique: true, name: 'ux_employee', partialFilterExpression: { isDeleted: false } },
);
employeeFileSchema.index({ applicantId: 1 }, { name: 'ix_applicantId' });
employeeFileSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
employeeFileSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
employeeFileSchema.index({ employeeCode: 1 }, { name: 'ix_employeeCode' });

export const EmployeeFileModel = model<EmployeeFileDoc>('EmployeeFile', employeeFileSchema, 'hr_employee_files');
