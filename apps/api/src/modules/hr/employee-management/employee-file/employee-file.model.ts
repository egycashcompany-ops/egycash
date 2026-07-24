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
  /** null for a DIRECT-registration employee (no recruitment history). */
  applicantId: Types.ObjectId | null;
  /** null when the applicant was a direct intake with no linked Job Request. */
  jobRequisitionId: Types.ObjectId | null;
  screeningId: Types.ObjectId | null;
  interviewIds: Types.ObjectId[];
  jobOfferId: Types.ObjectId | null;
  hiringDocumentsId: Types.ObjectId;
}

/**
 * A document held in the Employee File. `hiringDocumentCopy` items are INDEPENDENT copies made at
 * assembly from the hiring documents (`copiedFromFileId` is the original; editing/removing the copy
 * never touches it). `custom` items are additional HR uploads with a user-defined name.
 */
export interface EmployeeFileDocument {
  _id: Types.ObjectId;
  source: 'hiringDocumentCopy' | 'custom';
  name: string;
  fileId: Types.ObjectId;
  fileName: string;
  copiedFromFileId: Types.ObjectId | null;
  uploadedBy: Types.ObjectId | null;
  uploadedAt: Date;
}

export interface EmployeeFileDoc extends BaseDocFields {
  employeeId: Types.ObjectId;
  employeeCode: string;
  /** null for a DIRECT-registration employee. */
  applicantId: Types.ObjectId | null;
  branchId: Types.ObjectId;
  status: EmployeeFileStatus;
  links: EmployeeFileLinks;
  /** Independent copies of the hiring documents + any custom uploads (HR-spec). */
  documents: EmployeeFileDocument[];
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
    applicantId: { type: Schema.Types.ObjectId, default: null },
    jobRequisitionId: { type: Schema.Types.ObjectId, default: null },
    screeningId: { type: Schema.Types.ObjectId, default: null },
    interviewIds: { type: [Schema.Types.ObjectId], default: [] },
    jobOfferId: { type: Schema.Types.ObjectId, default: null },
    hiringDocumentsId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const documentSchema = new Schema<EmployeeFileDocument>(
  {
    source: { type: String, enum: ['hiringDocumentCopy', 'custom'], required: true },
    name: { type: String, required: true },
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    copiedFromFileId: { type: Schema.Types.ObjectId, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, default: null },
    uploadedAt: { type: Date, required: true },
  },
  { _id: true },
);

const employeeFileSchema = new Schema<EmployeeFileDoc>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeCode: { type: String, required: true },
    applicantId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: EMPLOYEE_FILE_STATUSES, required: true, default: 'active' },
    links: { type: linksSchema, required: true },
    documents: { type: [documentSchema], default: [] },
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
