// The Employee aggregate (Stage 5) — created when an applicant's Job Offer is Accepted. The
// employment terms are a server-side copy of the offer's immutable Accepted Snapshot (never
// the live offer). The record preserves references back to the Applicant, the Job Requisition,
// and the Accepted Job Offer. A unique index on `jobOfferId` guarantees at most one employee
// per accepted offer. `applicantCode`/`offerCode`/`branchId` are denormalized (branch is the
// primary data scope, ADR-015).
import { Schema, model, type Types } from 'mongoose';
import { EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, type EmployeeStatus, type EmploymentType } from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface EmployeeMoney {
  amount: number;
  currency: string;
}

export interface EmployeeAllowance {
  name: string;
  amount: number;
  currency: string;
}

/** One entry in the employee's status trail (the hire is recorded as `from: null → to: 'active'`). */
export interface EmployeeStatusEvent {
  from: EmployeeStatus | null;
  to: EmployeeStatus;
  reason: string | null;
  effectiveDate: Date;
  at: Date;
  by: Types.ObjectId | null;
}

export interface EmploymentDetails {
  jobTitleId: Types.ObjectId;
  departmentId: Types.ObjectId;
  /** Section within the department (ADR-015 hierarchy); null when the offer did not specify one. */
  sectionId: Types.ObjectId | null;
  branchId: Types.ObjectId;
  /** Approved Job Position, when one exists — OPTIONAL forever (ADR-016 Talent Pool). */
  jobPositionId: Types.ObjectId | null;
  /** Reporting manager — null when the accepted offer set none. */
  managerId: Types.ObjectId | null;
  employmentType: EmploymentType;
  /** Compensation — null when the accepted offer set none. */
  salary: EmployeeMoney | null;
  allowances: EmployeeAllowance[];
  benefits: string[];
  probationMonths: number;
  startDate: Date;
}

export interface EmployeeDoc extends BaseDocFields {
  /** PERMANENT identity: the Global Employee Number `000125` — never changes, globally unique (ADR-017). */
  employeeNumber: string;
  /**
   * Displayed Employee Code, DERIVED as `<CurrentBranchCode><employeeNumber>` (e.g. `001000125`).
   * Denormalized for search/display; recomputed when the employee transfers branches — only the
   * prefix changes, the Global Employee Number never does.
   */
  code: string;
  status: EmployeeStatus;
  /** Full lifecycle trail, oldest first (starts with the hire). */
  statusHistory: EmployeeStatusEvent[];
  /** The linked login account (Employee ← one User), null until a login is created (ADR-017). */
  userId: Types.ObjectId | null;
  // Preserved references.
  applicantId: Types.ObjectId;
  applicantCode: string;
  /** null when the source applicant had no linked Job Request (direct intake). */
  jobRequisitionId: Types.ObjectId | null;
  jobOfferId: Types.ObjectId;
  offerCode: string;
  acceptedOfferRevision: number;
  // Copied employment terms + scope + hiring date.
  employment: EmploymentDetails;
  // Denormalized organizational placement (backs the branch/department/section data scopes).
  branchId: Types.ObjectId;
  departmentId: Types.ObjectId;
  sectionId: Types.ObjectId | null;
  hiredAt: Date;
}

const employmentSchema = new Schema<EmploymentDetails>(
  {
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    branchId: { type: Schema.Types.ObjectId, required: true },
    jobPositionId: { type: Schema.Types.ObjectId, default: null },
    managerId: { type: Schema.Types.ObjectId, default: null },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    salary: {
      type: new Schema<EmployeeMoney>(
        { amount: { type: Number, required: true }, currency: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    allowances: {
      type: [
        new Schema<EmployeeAllowance>(
          {
            name: { type: String, required: true },
            amount: { type: Number, required: true },
            currency: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    benefits: { type: [String], default: [] },
    probationMonths: { type: Number, required: true },
    startDate: { type: Date, required: true },
  },
  { _id: false },
);

const statusEventSchema = new Schema<EmployeeStatusEvent>(
  {
    from: { type: String, enum: [...EMPLOYEE_STATUSES, null], default: null },
    to: { type: String, enum: EMPLOYEE_STATUSES, required: true },
    reason: { type: String, default: null },
    effectiveDate: { type: Date, required: true },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const employeeSchema = new Schema<EmployeeDoc>(
  {
    employeeNumber: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, enum: EMPLOYEE_STATUSES, required: true, default: 'active' },
    statusHistory: { type: [statusEventSchema], default: [] },
    userId: { type: Schema.Types.ObjectId, default: null },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    jobRequisitionId: { type: Schema.Types.ObjectId, default: null },
    jobOfferId: { type: Schema.Types.ObjectId, required: true },
    offerCode: { type: String, required: true },
    acceptedOfferRevision: { type: Number, required: true },
    employment: { type: employmentSchema, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    sectionId: { type: Schema.Types.ObjectId, default: null },
    hiredAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The Global Employee Number is the permanent, organization-wide-unique identity (never changes).
employeeSchema.index({ employeeNumber: 1 }, { unique: true, name: 'ux_employeeNumber' });
// The derived Employee Code is also unique at any point in time (branch code + unique number).
employeeSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// At most one employee per accepted offer — prevents duplicate hiring, DB-enforced.
employeeSchema.index(
  { jobOfferId: 1 },
  { unique: true, name: 'ux_offer', partialFilterExpression: { isDeleted: false } },
);
// One login account per employee (Employee ← one User); nulls are exempt.
employeeSchema.index(
  { userId: 1 },
  { unique: true, name: 'ux_userId', partialFilterExpression: { userId: { $type: 'objectId' } } },
);
employeeSchema.index({ applicantId: 1 }, { name: 'ix_applicantId' });
employeeSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
employeeSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
employeeSchema.index({ departmentId: 1, status: 1 }, { name: 'ix_departmentId_status' });
employeeSchema.index({ sectionId: 1, status: 1 }, { name: 'ix_sectionId_status' });

export const EmployeeModel = model<EmployeeDoc>('Employee', employeeSchema, 'hr_employees');
