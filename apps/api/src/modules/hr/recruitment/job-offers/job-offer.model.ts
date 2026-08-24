// The Job Offer aggregate (Stage 4) — the compensation offer extended to an applicant who
// cleared all interview rounds. Terms are versioned: every revision snapshots the prior
// package into `revisions`. "At most one live offer per applicant" is enforced by the
// attempt-unique index over non-superseded rows (I12) — the `active` boolean that used to back
// it is deleted, because a flag can disagree with the status it mirrors (I10). `applicantCode`
// and `branchId` are denormalized (branch is the primary data scope, ADR-015).
import { Schema, model, type Types } from 'mongoose';
import {
  EMPLOYMENT_TYPES,
  OFFER_STATUSES,
  type EmploymentType,
  type OfferStatus,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';
import { stageFields, type StageDocFields } from '../workflow/stage-fields';

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
  /** The seat + section this hire fills; carried into the Employee record (RW3). */
  sectionId: Types.ObjectId | null;
  /** Reporting manager — OPTIONAL (may be null). */
  managerId: Types.ObjectId | null;
  employmentType: EmploymentType;
  /** Compensation — OPTIONAL (may be null). */
  salary: OfferMoney | null;
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

export interface JobOfferDoc extends BaseDocFields, StageDocFields {
  /**
   * Immutable offer number `JO-{YYYY}-{seq:6}`, allocated when the record leaves `waiting` for
   * `draft` — a queued offer has no number yet (I11).
   */
  code: string | null;
  applicantId: Types.ObjectId;
  applicantCode: string;
  applicantName: string;
  branchId: Types.ObjectId | null;
  status: OfferStatus;
  /** null while `waiting`; the package is filled in when the offer is drafted (I11). */
  terms: OfferTerms | null;
  /** The Employee created from this accepted offer — the Employees Ready queue reads it (I11). */
  hiredEmployeeId: Types.ObjectId | null;
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
    sectionId: { type: Schema.Types.ObjectId, default: null },
    managerId: { type: Schema.Types.ObjectId, default: null },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, required: true },
    salary: { type: moneySchema, default: null },
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
    code: { type: String, default: null },
    applicantId: { type: Schema.Types.ObjectId, required: true },
    applicantCode: { type: String, required: true },
    applicantName: { type: String, default: '' },
    branchId: { type: Schema.Types.ObjectId, default: null },
    status: { type: String, enum: OFFER_STATUSES, required: true, default: 'waiting' },
    terms: { type: termsSchema, default: null },
    hiredEmployeeId: { type: Schema.Types.ObjectId, default: null },
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
    ...stageFields,
    ...baseFields,
  },
  baseSchemaOptions,
);

// The offer number is organization-wide unique and immutable — partial, since a `waiting`
// record has none yet (I11).
jobOfferSchema.index(
  { code: 1 },
  { unique: true, name: 'ux_code', partialFilterExpression: { code: { $type: 'string' } } },
);
// I12 — one ACTIVE record per attempt (replaces the `active` boolean, I10).
jobOfferSchema.index(
  { applicantId: 1, attempt: 1 },
  {
    unique: true,
    name: 'ux_offer_applicant_attempt',
    partialFilterExpression: { supersededAt: null, isDeleted: false },
  },
);
// The Employees Ready queue: accepted offers not yet converted into an Employee (I11).
jobOfferSchema.index({ status: 1, hiredEmployeeId: 1 }, { name: 'ix_status_hiredEmployee' });
jobOfferSchema.index({ applicantId: 1, createdAt: -1 }, { name: 'ix_applicant_createdAt' });
jobOfferSchema.index({ status: 1, createdAt: -1 }, { name: 'ix_status_createdAt' });
jobOfferSchema.index({ branchId: 1, status: 1 }, { name: 'ix_branchId_status' });
// Drives the automatic-expiration sweep (sent offers past validUntil).
jobOfferSchema.index({ status: 1, 'terms.validUntil': 1 }, { name: 'ix_status_validUntil' });

// I3 — the aggregated stage counters (RW15) group the LIVE set by status, with no predicate to
// narrow it: exactly the shape that would otherwise scan the collection and fetch every document
// to read one field. This index gives the counters' `$match` an equality bound on both of its
// fields and carries `status` in the key, so the group is an index-only scan — retired rows sit in
// a different key range and are never examined.
//
// It is deliberately NOT a partial index over `{ supersededAt: null, isDeleted: false }`, which is
// the obvious-looking shape and does not work: MongoDB will not use a partial index for a query
// whose predicate is a `null` EQUALITY, because `$eq: null` also matches documents where the field
// is missing and those may not be in the index. Such a plan is not merely rejected — it is never
// generated (`rejectedPlans: []`), and the query silently collection-scans.
jobOfferSchema.index(
  { supersededAt: 1, isDeleted: 1, branchId: 1, status: 1 },
  { name: 'ix_live_counters' },
);

export const JobOfferModel = model<JobOfferDoc>('JobOffer', jobOfferSchema, 'hr_job_offers');
