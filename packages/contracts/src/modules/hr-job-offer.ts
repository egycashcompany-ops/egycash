// HR / Recruitment — Job Offer (Stage 4). Shared contracts for the fourth stage of the
// approved seven-stage recruitment workflow: an applicant who cleared all interview stages
// receives a Job Offer, which is drafted, sent, and then accepted / rejected / expired /
// withdrawn. Offers carry a full compensation package and are versioned (revised offers
// keep their history). Scope is Stage 4 only: nothing here describes Employee Creation
// (Stage 5) or later — the only forward hook is "the latest offer must be Accepted before
// Employee Creation", enforced by that later stage against this aggregate.
import { z } from 'zod';
import { booleanQuery, objectId, PaginationQuerySchema,
  listQuery,
} from '../common/index.js';
import {
  type AttemptMarkerDto,
  type PlacementDto,
  type PlacementLabelDto,
} from './hr-recruitment-workflow.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * Offer lifecycle. `draft` (being prepared) → `sent` (issued to the applicant) → one of the
 * terminal states: `accepted` / `rejected` (the applicant's decision), `expired` (validity
 * lapsed — automatic), `withdrawn` (retracted by HR), or `superseded` (retired by a return to an
 * earlier stage, RW13). An applicant has at most one live offer (`waiting`/`draft`/`sent`) at a
 * time, enforced by a partial unique index on those statuses rather than by a boolean (I10).
 */
export const OFFER_STATUSES = [
  /**
   * The record exists and the candidate is queued for an offer, but nothing has been drafted yet
   * (I11). Materialized when HR moves the candidate to the Job Offer stage.
   */
  'waiting',
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
  'withdrawn',
  /** Set when a return to an earlier stage retires a live offer (RW13) — truthful than a withdrawal. */
  'superseded',
] as const;
export const OfferStatusSchema = z.enum(OFFER_STATUSES);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const EMPLOYMENT_TYPES = [
  'fullTime',
  'partTime',
  'temporary',
  'contract',
  'internship',
] as const;
export const EmploymentTypeSchema = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

// ── Money / package sub-objects ─────────────────────────────────────────────

export const MoneySchema = z
  .object({ amount: z.number().nonnegative(), currency: z.string().length(3).default('EGP') })
  .strict();

export const AllowanceSchema = z
  .object({
    name: z.string().min(1).max(100),
    amount: z.number().nonnegative(),
    currency: z.string().length(3).default('EGP'),
  })
  .strict();

// ── Offer terms (the versioned package) ─────────────────────────────────────

/**
 * The full offer package. This is what gets versioned: every revision snapshots the prior
 * terms into the offer's history. Organizational references (job title, department, branch,
 * manager) are stored as ids — structurally validated here; existence is the org module's
 * concern (they are not dereferenced by this stage).
 */
export const OfferTermsSchema = z
  .object({
    jobTitleId: objectId(),
    departmentId: objectId(),
    branchId: objectId(),
    /**
     * The seat this hire fills (platform `job_positions`) and the section within the department.
     * OPTIONAL (ADR-016). Pre-filled from the applicant's current placement (RW3) and carried
     * into the accepted snapshot, so the Employee record finally receives its position/section
     * instead of the hard-coded nulls the hire path used before the workflow refactor.
     */
    jobPositionId: objectId().nullish(),
    sectionId: objectId().nullish(),
    /** The reporting manager (a platform user). OPTIONAL — may be null/omitted. */
    managerId: objectId().nullish(),
    employmentType: EmploymentTypeSchema,
    /** Compensation package. OPTIONAL — may be null/omitted. */
    salary: MoneySchema.nullish(),
    allowances: z.array(AllowanceSchema).max(30).default([]),
    benefits: z.array(z.string().min(1).max(200)).max(50).default([]),
    probationMonths: z.number().int().min(0).max(24),
    startDate: z.coerce.date(),
    /** Offer validity — the offer auto-expires after this instant while still `sent`. */
    validUntil: z.coerce.date(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export type OfferTerms = z.infer<typeof OfferTermsSchema>;

// ── Create / revise / send / respond / withdraw ─────────────────────────────

/**
 * Draft the candidate's offer: fills the `waiting` record materialized when HR moved them to this
 * stage (I11) and allocates the offer number. Idempotent per candidate — there is exactly one live
 * offer record, so this transitions it rather than creating a second one.
 */
export const CreateJobOfferSchema = z
  .object({ applicantId: objectId(), terms: OfferTermsSchema })
  .strict();
export type CreateJobOffer = z.infer<typeof CreateJobOfferSchema>;

/** Revise the package (keeps the prior version in history). Allowed while draft or sent. */
export const ReviseJobOfferSchema = z
  .object({ terms: OfferTermsSchema, version: z.number().int().min(0) })
  .strict();
export type ReviseJobOffer = z.infer<typeof ReviseJobOfferSchema>;

export const SendJobOfferSchema = z.object({ version: z.number().int().min(0) }).strict();
export type SendJobOffer = z.infer<typeof SendJobOfferSchema>;

/** The applicant's acceptance (recorded by HR on their behalf — applicants are not users). */
export const AcceptJobOfferSchema = z
  .object({ note: z.string().max(2000).optional(), version: z.number().int().min(0) })
  .strict();
export type AcceptJobOffer = z.infer<typeof AcceptJobOfferSchema>;

export const RejectJobOfferSchema = z
  .object({
    reason: z.string().min(1).max(2000),
    note: z.string().max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type RejectJobOffer = z.infer<typeof RejectJobOfferSchema>;

export const WithdrawJobOfferSchema = z
  .object({ reason: z.string().min(1).max(2000), version: z.number().int().min(0) })
  .strict();
export type WithdrawJobOffer = z.infer<typeof WithdrawJobOfferSchema>;

// ── List ─────────────────────────────────────────────────────────────────────

export const ListJobOffersQuerySchema = PaginationQuerySchema.extend({
  status: listQuery(OfferStatusSchema),
  applicantId: objectId().optional(),
  branchId: objectId().optional(),
  /** Free-text over the offer number (`code`) and applicant code (partial, case-insensitive). */
  search: z.string().max(100).optional(),
  /**
   * Whether the offer has already produced an Employee. `false` is what the Employees Ready
   * queue asks for (A6/RW15) — an accepted offer nobody has hired yet — so the page and the
   * stage counter run the SAME server-side predicate and their totals cannot drift.
   */
  hired: booleanQuery().optional(),
  /**
   * When the candidate answered the offer. This is the date the Employees Ready queue sorts by,
   * so it is the one a user filtering that queue means by "accepted between".
   */
  respondedFrom: z.coerce.date().optional(),
  respondedTo: z.coerce.date().optional(),
}).strict();
export type ListJobOffersQuery = z.infer<typeof ListJobOffersQuerySchema>;

// ── Bulk (RW17/I4 — per-item transaction, partial success) ──────────────────

export const BULK_JOB_OFFER_ACTIONS = ['send', 'withdraw'] as const;
export const BulkJobOfferActionSchema = z.enum(BULK_JOB_OFFER_ACTIONS);
export type BulkJobOfferAction = z.infer<typeof BulkJobOfferActionSchema>;

export const BulkJobOffersSchema = z
  .object({
    action: BulkJobOfferActionSchema,
    ids: z.array(objectId()).min(1).max(200),
    reason: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine((v) => v.action !== 'withdraw' || (v.reason !== undefined && v.reason.length > 0), {
    path: ['reason'],
    message: 'a reason is required to withdraw offers',
  });
export type BulkJobOffers = z.infer<typeof BulkJobOffersSchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface OfferAllowanceDto {
  name: string;
  amount: number;
  currency: string;
}

export interface OfferTermsDto {
  jobTitleId: string;
  departmentId: string;
  branchId: string;
  /** The seat + section this hire fills; null when not set (ADR-016). Flows to the Employee (RW3). */
  jobPositionId: string | null;
  sectionId: string | null;
  /** null when no reporting manager was set on the offer. */
  managerId: string | null;
  employmentType: EmploymentType;
  /** null when no salary was set on the offer. */
  salary: { amount: number; currency: string } | null;
  allowances: OfferAllowanceDto[];
  benefits: string[];
  probationMonths: number;
  startDate: string;
  validUntil: string;
  notes: string | null;
}

export interface OfferRevisionDto {
  revisionNumber: number;
  terms: OfferTermsDto;
  revisedBy: string | null;
  revisedAt: string;
}

/**
 * The frozen terms as they stood the moment the applicant accepted. Immutable once set — the
 * exact revision Employee Creation (Stage 5) must consume, independent of the live `terms`.
 */
export interface OfferAcceptedSnapshotDto {
  revisionNumber: number;
  terms: OfferTermsDto;
  acceptedAt: string;
}

export interface JobOfferDto extends AttemptMarkerDto {
  id: string;
  /**
   * Immutable, unique offer number `JO-2026-000001`, allocated when the record leaves `waiting`
   * for `draft` — a queued offer has no number yet (I11), so this is null while `waiting`.
   */
  code: string | null;
  applicantId: string;
  applicantCode: string;
  /** Denormalized applicant display name (Arabic full name) — tables never show bare codes. */
  applicantName: string;
  branchId: string | null;
  status: OfferStatus;
  /** The placement in force when the offer record was materialized; immutable (RW4). */
  placement: PlacementDto;
  placementLabel: PlacementLabelDto;
  /**
   * The compensation package. null while `waiting` — the record is materialized when HR moves the
   * candidate to this stage, before anything has been drafted (I11). Completeness is enforced at
   * the transitions that need it (draft requires terms; send requires a complete package), never
   * at creation — the same draft-permissive treatment the Contracts module uses.
   */
  terms: OfferTermsDto | null;
  revisionNumber: number;
  /** Superseded prior versions, oldest first. */
  revisions: OfferRevisionDto[];
  /** Set once, on acceptance; null otherwise. The employment terms actually accepted. */
  acceptedSnapshot: OfferAcceptedSnapshotDto | null;
  /**
   * The Employee created from this accepted offer, once hired. Makes the "Employees Ready" queue
   * a fact ON THE OFFER rather than the absence of an Employee row (I11).
   */
  hiredEmployeeId: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  rejectionReason: string | null;
  withdrawnReason: string | null;
  expiredAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrOfferEvents = {
  OfferCreated: 'hr.jobOffer.created',
  OfferRevised: 'hr.jobOffer.revised',
  OfferSent: 'hr.jobOffer.sent',
  OfferAccepted: 'hr.jobOffer.accepted',
  OfferRejected: 'hr.jobOffer.rejected',
  OfferExpired: 'hr.jobOffer.expired',
  OfferWithdrawn: 'hr.jobOffer.withdrawn',
} as const;
export type HrOfferEventName = (typeof HrOfferEvents)[keyof typeof HrOfferEvents];

export const JobOfferEventPayloadV1 = z.object({
  offerId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  status: OfferStatusSchema,
});

// ── Notification template keys (seeded at boot by the HR module) ────────────

export const HrOfferTemplates = {
  Sent: 'hr.jobOfferSent',
  Accepted: 'hr.jobOfferAccepted',
  Rejected: 'hr.jobOfferRejected',
  Expired: 'hr.jobOfferExpired',
} as const;
