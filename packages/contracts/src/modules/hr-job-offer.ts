// HR / Recruitment — Job Offer (Stage 4). Shared contracts for the fourth stage of the
// approved seven-stage recruitment workflow: an applicant who cleared all interview stages
// receives a Job Offer, which is drafted, sent, and then accepted / rejected / expired /
// withdrawn. Offers carry a full compensation package and are versioned (revised offers
// keep their history). Scope is Stage 4 only: nothing here describes Employee Creation
// (Stage 5) or later — the only forward hook is "the latest offer must be Accepted before
// Employee Creation", enforced by that later stage against this aggregate.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * Offer lifecycle. `draft` (being prepared) → `sent` (issued to the applicant) → one of the
 * terminal states: `accepted` / `rejected` (the applicant's decision), `expired` (validity
 * lapsed — automatic), or `withdrawn` (retracted by HR). Only `draft`/`sent` are "active";
 * an applicant may have at most one active offer at a time.
 */
export const OFFER_STATUSES = [
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

export const EMPLOYMENT_TYPES = ['fullTime', 'partTime', 'temporary', 'contract', 'internship'] as const;
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
  status: OfferStatusSchema.optional(),
  applicantId: objectId().optional(),
  branchId: objectId().optional(),
  /** Free-text over the offer number (`code`) and applicant code (partial, case-insensitive). */
  search: z.string().max(100).optional(),
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

// ── Awaiting offer (workflow queue) ──────────────────────────────────────────
// Applicants HR moved to the Job Offer stage who have no blocking offer yet (no active
// draft/sent one and no accepted one) surface automatically on /job-offers. Derived read
// model — no offer record is fabricated; "New Offer" drafts the first one from here.

export const ListAwaitingOffersQuerySchema = z
  .object({ branchId: objectId().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) })
  .strict();
export type ListAwaitingOffersQuery = z.infer<typeof ListAwaitingOffersQuerySchema>;

export interface AwaitingOfferDto {
  applicantId: string;
  applicantCode: string;
  /** Denormalized applicant display name (Arabic full name). */
  applicantName: string;
  branchId: string | null;
  /** When HR moved the applicant to the Job Offer stage (drives the queue order). */
  movedToOfferAt: string;
}

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

export interface JobOfferDto {
  id: string;
  /** Immutable, unique, human-readable offer number, e.g. `JO-2026-000001`. */
  code: string;
  applicantId: string;
  applicantCode: string;
  /** Denormalized applicant display name (Arabic full name) — tables never show bare codes. */
  applicantName: string;
  branchId: string;
  status: OfferStatus;
  terms: OfferTermsDto;
  revisionNumber: number;
  /** Superseded prior versions, oldest first. */
  revisions: OfferRevisionDto[];
  /** Set once, on acceptance; null otherwise. The employment terms actually accepted. */
  acceptedSnapshot: OfferAcceptedSnapshotDto | null;
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
