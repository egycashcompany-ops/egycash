// Job Requisitions (P-HR-REQ) — a request to hire, which carries the placement it wants filled.
//
// THERE IS NO VACANCY ENTITY, AND THIS FILE IS WHERE THAT IS ENFORCED (ADR-029, D-REQ-1). The
// requisition names a job title, a department, a branch and optionally a section — the same tuple
// `PlacementSchema` and `OfferTerms` already carry — rather than pointing at a seat record. The
// difference between a request and a seat is temporal, not structural: a seat is permanent and
// needs an owner to maintain it, a request has a life (raised → approved → filled → closed).
//
// ONE STATE MACHINE, NOT TWO (D-REQ-10). Approval and fulfilment share a chain because `open`
// means "approved and hiring"; two axes would permit a requisition that is `filled` and never
// approved.
//
//   draft → pendingManager → pendingHr → open → partiallyFilled → filled
//                    │            │        └──────────┬─────────┘
//                    └── reject ──┴─► rejected        └─► closed (administrative) / cancelled
//
// NOT MODELLED, DELIBERATELY (D-REQ-8): headcount, authorized establishment, budget. Nobody has
// decided who authorizes a headcount, for what period, against what budget — and a number invented
// here would be enforced on real hiring. The decisions are in
// docs/12-planning/job-requisition-design.md.
import { z } from 'zod';
import { PaginationQuerySchema, objectId } from '../common/index.js';

/**
 * The single chain (D-REQ-10).
 *
 * `open` is the first state in which the requisition may be linked to an applicant, and
 * `partiallyFilled` is a state the system enters BY ITSELF as hires land (D-REQ-13). The three
 * terminal states are terminal: nothing reopens a requisition (there is no `reopen` verb anywhere
 * in this file), and a new need is a new requisition.
 */
export const JOB_REQUISITION_STATUSES = [
  'draft',
  'pendingManager',
  'pendingHr',
  'open',
  'partiallyFilled',
  'filled',
  'rejected',
  'cancelled',
  'closed',
] as const;
export const JobRequisitionStatusSchema = z.enum(JOB_REQUISITION_STATUSES);
export type JobRequisitionStatus = z.infer<typeof JobRequisitionStatusSchema>;

/** The states an applicant may be linked to: approved, and still hiring (D-REQ-13, §6). */
export const LINKABLE_JOB_REQUISITION_STATUSES = ['open', 'partiallyFilled'] as const;

/** The states from which nothing moves. */
export const TERMINAL_JOB_REQUISITION_STATUSES = ['filled', 'rejected', 'cancelled', 'closed'] as const;

export const JOB_REQUISITION_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const JobRequisitionPrioritySchema = z.enum(JOB_REQUISITION_PRIORITIES);
export type JobRequisitionPriority = z.infer<typeof JobRequisitionPrioritySchema>;

/**
 * The placement a requisition wants filled (D-REQ-2).
 *
 * `departmentId` is required and that is not incidental: it is what makes the manager approval step
 * addressable at all, and what a department-scoped reader is narrowed by. `sectionId` is optional
 * and must belong to the named department — the service checks that, because a schema cannot.
 */
export const JobRequisitionPlacementSchema = z
  .object({
    jobTitleId: objectId(),
    departmentId: objectId(),
    branchId: objectId(),
    sectionId: objectId().nullish(),
  })
  .strict();
export type JobRequisitionPlacement = z.infer<typeof JobRequisitionPlacementSchema>;

export const CreateJobRequisitionSchema = JobRequisitionPlacementSchema.extend({
  quantity: z.number().int().min(1).max(999),
  reason: z.string().trim().min(1).max(2000),
  priority: JobRequisitionPrioritySchema.default('normal'),
  neededBy: z.coerce.date().nullish(),
}).strict();
export type CreateJobRequisition = z.infer<typeof CreateJobRequisitionSchema>;

/**
 * Editing (D-REQ-15).
 *
 * Every field here is optional and `version` is not: an edit carries the version it read, the
 * house pattern `BaseRepository.updateById` enforces. Which edits force a fresh approval is a rule,
 * not a schema — `job-requisition-rules.ts` owns it, so the answer is provable without a database.
 */
export const UpdateJobRequisitionSchema = z
  .object({
    jobTitleId: objectId().optional(),
    departmentId: objectId().optional(),
    branchId: objectId().optional(),
    sectionId: objectId().nullish(),
    quantity: z.number().int().min(1).max(999).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    priority: JobRequisitionPrioritySchema.optional(),
    neededBy: z.coerce.date().nullish(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateJobRequisition = z.infer<typeof UpdateJobRequisitionSchema>;

export const SubmitJobRequisitionSchema = z.object({ version: z.number().int().min(0) }).strict();
export type SubmitJobRequisition = z.infer<typeof SubmitJobRequisitionSchema>;

/**
 * One decision, either step (D-REQ-6, D-REQ-11).
 *
 * The step is NOT in the payload: it is wherever the requisition currently stands, so a caller
 * cannot aim at the HR step while the manager step is still open.
 */
export const DecideJobRequisitionSchema = z
  .object({
    verdict: z.enum(['approve', 'reject']),
    comment: z.string().trim().min(1).max(2000).nullish(),
    version: z.number().int().min(0),
  })
  .strict();
export type DecideJobRequisition = z.infer<typeof DecideJobRequisitionSchema>;

/**
 * Closing and cancelling (D-REQ-4, D-REQ-5, D-REQ-12).
 *
 * `reason` is required, not optional: an administrative end to a live request is exactly the act a
 * reader will ask about later. No separate permission gates it — `jobRequisition.approve`, the
 * authority that opened the requisition, is the authority that ends it.
 */
export const CloseJobRequisitionSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
    version: z.number().int().min(0),
  })
  .strict();
export type CloseJobRequisition = z.infer<typeof CloseJobRequisitionSchema>;

export const ListJobRequisitionsQuerySchema = PaginationQuerySchema.extend({
  status: JobRequisitionStatusSchema.optional(),
  /** The three axes a queue is read along, plus a free-text search over code and reason. */
  departmentId: objectId().optional(),
  branchId: objectId().optional(),
  jobTitleId: objectId().optional(),
  priority: JobRequisitionPrioritySchema.optional(),
  search: z.string().trim().max(200).optional(),
}).strict();
export type ListJobRequisitionsQuery = z.infer<typeof ListJobRequisitionsQuerySchema>;

export interface JobRequisitionDto {
  id: string;
  /** `REQ-2026-000123` — allocated at creation, unique, never reused. */
  code: string;
  jobTitleId: string;
  departmentId: string;
  branchId: string;
  sectionId: string | null;
  quantity: number;
  /**
   * How many hires this requisition has taken, DERIVED from the link records (D-REQ-13).
   *
   * Never an incremented counter: replaying `hr.applicant.hired` must not inflate it, and the
   * unique index on (requisition, applicant) is what makes that structural rather than careful.
   */
  filledCount: number;
  reason: string;
  priority: JobRequisitionPriority;
  neededBy: string | null;
  status: JobRequisitionStatus;
  requestedBy: string;
  managerDecidedBy: string | null;
  managerDecidedAt: string | null;
  managerComment: string | null;
  hrDecidedBy: string | null;
  hrDecidedAt: string | null;
  hrComment: string | null;
  closedBy: string | null;
  closedAt: string | null;
  closeReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One hire against one requisition — the fulfilment record, readable on its own (D-REQ-13). */
export interface JobRequisitionFillDto {
  id: string;
  requisitionId: string;
  applicantId: string;
  employeeId: string | null;
  filledAt: string;
}

/**
 * The facts this module publishes (ADR-008 `<module>.<entity>.<event>`, D-REQ-17).
 *
 * Facts, not commands: `filled` says a requisition reached its quantity, it does not ask anyone to
 * do anything about it. Nothing here is consumed by the recruitment workflow — the requisition
 * listens to `hr.applicant.hired`, never the other way round (I15).
 */
export const HrJobRequisitionEvents = {
  Submitted: 'hr.jobRequisition.submitted',
  Approved: 'hr.jobRequisition.approved',
  Rejected: 'hr.jobRequisition.rejected',
  Filled: 'hr.jobRequisition.filled',
  Closed: 'hr.jobRequisition.closed',
  Cancelled: 'hr.jobRequisition.cancelled',
} as const;
export type HrJobRequisitionEventName =
  (typeof HrJobRequisitionEvents)[keyof typeof HrJobRequisitionEvents];

export const JobRequisitionSubmittedPayloadV1 = z
  .object({
    requisitionId: objectId(),
    code: z.string(),
    departmentId: objectId(),
    quantity: z.number().int().min(1),
  })
  .strict();

export const JobRequisitionDecidedPayloadV1 = z
  .object({
    requisitionId: objectId(),
    code: z.string(),
    departmentId: objectId(),
    step: z.enum(['manager', 'hr']),
    status: JobRequisitionStatusSchema,
  })
  .strict();

export const JobRequisitionFilledPayloadV1 = z
  .object({
    requisitionId: objectId(),
    code: z.string(),
    quantity: z.number().int().min(1),
  })
  .strict();

export const JobRequisitionEndedPayloadV1 = z
  .object({
    requisitionId: objectId(),
    code: z.string(),
    reason: z.string(),
  })
  .strict();
