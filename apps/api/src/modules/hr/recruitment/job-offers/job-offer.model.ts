// The Job Offer aggregate (Stage 4) — the compensation offer extended to an applicant who
// cleared all interview rounds. Terms are versioned: every revision snapshots the prior
// package into `revisions`. `active` is a denormalized flag (true while draft/sent) that
// backs the "at most one active offer per applicant" partial unique index. `applicantCode`
// and `branchId` are denormalized (branch is the primary data scope, ADR-015).
import { Schema, model, type Types } from 'mongoose';
import {
  EMPLOYMENT_TYPES,
  OFFER_STATUSES,
  type EmploymentType,
  type OfferStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface OfferMoney {
  amount: number;
  currency: string;
}

export interface OfferAllowance {
  name: string;
  amount: number;
  currency: string;
}

export interface OfferTerms {
  jobTitleId: Types.ObjectId;
  departmentId: Types.ObjectId;
  branchId: Types.ObjectId;
  managerId: Types.ObjectId;
  employmentType: EmploymentType;
  salary: OfferMoney;
  allowances: OfferAllowance[];
  benefits: string[];
  probationMonths: number;
  startDate: Date;
  validUntil: Date;
  notes: string | null;
}

export interface OfferRevision {
  revisionNumber: number;
  terms: OfferTerms;
  revisedBy: Types.ObjectId | null;
  revisedAt: Date;
}

export interface OfferAcceptedSnapshot {
  revisionNumber: number;
  terms: OfferTerms;
  acceptedAt: Date;
}

export interface JobOfferDoc extends BaseDocFields {
  /** Immutable, unique, human-readable offer number `JO-{YYYY}-{seq:6}` (set once, at create). */
  code: string;
  applicantId: Types.ObjectId;
  applicantCode: string;
  branchId: Types.ObjectId;
  status: OfferStatus;
  active: boolean;
  terms: OfferTerms;
  revisionNumber: number;
  revisions: OfferRevision[];
  /** Frozen accepted terms — set once on acceptance, never mutated (Stage 5 consumes this). */
  acceptedSnapshot: OfferAcceptedSnapshot | null;
  sentAt: Date | null;
  sentBy: Types.ObjectId | null;
  respondedAt: Date | null;
  responseNote: string | null;
  rejectionReason: string | null;
  withdrawnReason: string | null;
  withdrawnBy: Types.ObjectId | null;
  withdrawnAt: Date | null;
  expiredAt: Date | null;
}

const moneySchema = new Schema<OfferMoney>(
  { amount: { type: Number, required: true }, currency: { type: String, required: true } },
  { _id: false },
);

const termsSchema = new Schema<OfferTerms>(
  {
    jobTitleId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    managerId: { type: Schema.Types.ObjectId, required: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    salary: { type: moneySchema, required: true },
    allowances: {
      type: [
        new Schema<OfferAllowance>(
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
    validUntil: { type: Date, required: true },
    notes: { type: String, default: null },
  },
  { _id: false },
);

const jobOfferSchema = new Schema<JobOfferDoc>(
  {
    code: { type: String, required: true },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: OFFER_STATUSES, required: true, default: 'draft' },
    active: { type: Boolean, required: true, default: true },
    terms: { type: termsSchema, required: true },
    revisionNumber: { type: Number, required: true, default: 1 },
    revisions: {
      type: [
        new Schema<OfferRevision>(
          {
            revisionNumber: { type: Number, required: true },
            terms: { type: termsSchema, required: true },
            revisedBy: { type: Schema.Types.ObjectId, default: null },
            revisedAt: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    acceptedSnapshot: {
      type: new Schema<OfferAcceptedSnapshot>(
        {
          revisionNumber: { type: Number, required: true },
          terms: { type: termsSchema, required: true },
          acceptedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    sentAt: { type: Date, default: null },
    sentBy: { type: Schema.Types.ObjectId, default: null },
    respondedAt: { type: Date, default: null },
    responseNote: { type: String, default: null },
    rejectionReason: { type: String, default: null },
    withdrawnReason: { type: String, default: null },
    withdrawnBy: { type: Schema.Types.ObjectId, default: null },
    withdrawnAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

// The offer number is organization-wide unique and immutable.
jobOfferSchema.index({ code: 1 }, { unique: true, name: 'ux_code' });
// At most one ACTIVE (draft/sent) offer per applicant — the invariant, DB-enforced.
jobOfferSchema.index(
  { applicantId: 1 },
  { unique: true, name: 'ux_active_offer', partialFilterExpression: { active: true, isDeleted: false } },
);
jobOfferSchema.index({ applicantId: 1, createdAt: -1 }, { name: 'ix_applicant_createdAt' });
jobOfferSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
jobOfferSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
// Drives the automatic-expiration sweep (sent offers past validUntil).
jobOfferSchema.index({ status: 1, 'terms.validUntil': 1 }, { name: 'ix_status_validUntil' });

export const JobOfferModel = model<JobOfferDoc>('JobOffer', jobOfferSchema, 'hr_job_offers');
