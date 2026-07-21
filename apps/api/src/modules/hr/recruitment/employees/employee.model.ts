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

export interface EmploymentDetails {
  jobTitleId: Types.ObjectId;
  departmentId: Types.ObjectId;
  branchId: Types.ObjectId;
  managerId: Types.ObjectId;
  employmentType: EmploymentType;
  salary: EmployeeMoney;
  allowances: EmployeeAllowance[];
  benefits: string[];
  probationMonths: number;
  startDate: Date;
}

export interface EmployeeDoc extends BaseDocFields {
  /** Immutable, unique, human-readable employee number `EMP-{YYYY}-{seq:6}` (set once). */
  code: string;
  status: EmployeeStatus;
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
  branchId: Types.ObjectId;
  hiredAt: Date;
}

const employmentSchema = new Schema<EmploymentDetails>(
  {
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    managerId: { type: Schema.Types.ObjectId, required: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    salary: {
      type: new Schema<EmployeeMoney>(
        { amount: { type: Number, required: true }, currency: { type: String, required: true } },
        { _id: false },
      ),
      required: true,
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

const employeeSchema = new Schema<EmployeeDoc>(
  {
    code: { type: String, required: true },
    status: { type: String, enum: EMPLOYEE_STATUSES, required: true, default: 'active' },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    jobRequisitionId: { type: Schema.Types.ObjectId, default: null },
    jobOfferId: { type: Schema.Types.ObjectId, required: true },
    offerCode: { type: String, required: true },
    acceptedOfferRevision: { type: Number, required: true },
    employment: { type: employmentSchema, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    hiredAt: { type: Date, required: true },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The employee number is organization-wide unique and immutable.
employeeSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// At most one employee per accepted offer — prevents duplicate hiring, DB-enforced.
employeeSchema.index(
  { jobOfferId: 1 },
  { unique: true, name: 'ux_offer', partialFilterExpression: { isDeleted: false } },
);
employeeSchema.index({ applicantId: 1 }, { name: 'ix_applicantId' });
employeeSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
employeeSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });

export const EmployeeModel = model<EmployeeDoc>('Employee', employeeSchema, 'hr_employees');
