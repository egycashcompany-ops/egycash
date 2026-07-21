// HR / Recruitment — Initial Screening (Sprint 4.2, Stage 2). Shared contracts for the
// second stage of the approved seven-stage recruitment workflow: an applicant, once
// registered (Stage 1), is screened to a single terminal outcome — Accepted or Rejected
// (OQ-32). "Needs more information" is NOT a state: it is a note added to a screening that
// stays `pending`. Screening notes and rejection reasons are first-class and stored.
// Scope is Stage 2 only: nothing here describes Interviews (Stage 3) or later.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

// ── Closed vocabularies ─────────────────────────────────────────────────────

/**
 * Screening lifecycle. `pending` = under review (notes may accumulate); `accepted` and
 * `rejected` are terminal decisions (OQ-32 — only two outcomes). A rejected screening
 * transitions its applicant to the terminal `rejected` status; an accepted screening
 * leaves the applicant `new` (live), ready for the later interview stage.
 */
export const SCREENING_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export const ScreeningStatusSchema = z.enum(SCREENING_STATUSES);
export type ScreeningStatus = z.infer<typeof ScreeningStatusSchema>;

/** The two allowed screening decisions (OQ-32). */
export const SCREENING_OUTCOMES = ['accepted', 'rejected'] as const;
export const ScreeningOutcomeSchema = z.enum(SCREENING_OUTCOMES);
export type ScreeningOutcome = z.infer<typeof ScreeningOutcomeSchema>;

// ── Create / note / decide ──────────────────────────────────────────────────

/** Open a screening for an applicant (one per applicant). An optional first note is stored. */
export const CreateScreeningSchema = z
  .object({
    applicantId: objectId(),
    note: z.string().min(1).max(2000).optional(),
  })
  .strict();
export type CreateScreening = z.infer<typeof CreateScreeningSchema>;

/**
 * Append a note to a `pending` screening — the "needs more information" flow (OQ-32): the
 * screening stays pending; the note is recorded with author + timestamp.
 */
export const AddScreeningNoteSchema = z
  .object({
    note: z.string().min(1).max(2000),
    version: z.number().int().min(0),
  })
  .strict();
export type AddScreeningNote = z.infer<typeof AddScreeningNoteSchema>;

/**
 * Decide a screening (terminal). `reason` is REQUIRED when rejecting (OQ-32 — rejection
 * reasons must be stored) and optional (recorded as a decision note) when accepting.
 */
export const DecideScreeningSchema = z
  .object({
    outcome: ScreeningOutcomeSchema,
    reason: z.string().min(1).max(2000).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.outcome !== 'rejected' || (v.reason !== undefined && v.reason.trim() !== ''), {
    message: 'a reason is required when rejecting an applicant',
    path: ['reason'],
  });
export type DecideScreening = z.infer<typeof DecideScreeningSchema>;

// ── List ─────────────────────────────────────────────────────────────────────

export const ListScreeningsQuerySchema = PaginationQuerySchema.extend({
  status: ScreeningStatusSchema.optional(),
  applicantId: objectId().optional(),
  branchId: objectId().optional(),
  decidedFrom: z.coerce.date().optional(),
  decidedTo: z.coerce.date().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
}).strict();
export type ListScreeningsQuery = z.infer<typeof ListScreeningsQuerySchema>;

// ── Awaiting screening (pipeline entry) ─────────────────────────────────────
// Live applicants (status `new`) with no screening yet — the "automatically appears in the
// Screening module once registered" queue. A derived read model (no screening record is
// fabricated; the existing open-screening flow is untouched). The recruiter opens the screening
// from here, keeping the manual workflow + permissions intact.

export const ListAwaitingScreeningsQuerySchema = z
  .object({ branchId: objectId().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) })
  .strict();
export type ListAwaitingScreeningsQuery = z.infer<typeof ListAwaitingScreeningsQuerySchema>;

export interface AwaitingScreeningDto {
  applicantId: string;
  applicantCode: string;
  fullNameAr: string;
  branchId: string | null;
  /** When the applicant was registered (drives the queue order). */
  registeredAt: string;
}

// ── Screening DTO ─────────────────────────────────────────────────────────────

export interface ScreeningNoteDto {
  text: string;
  by: string | null;
  at: string;
}

export interface ScreeningDecisionDto {
  outcome: ScreeningOutcome;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string;
}

export interface ScreeningDto {
  id: string;
  applicantId: string;
  applicantCode: string;
  branchId: string | null;
  status: ScreeningStatus;
  notes: ScreeningNoteDto[];
  /** Present once the screening has been decided; null while `pending`. */
  decision: ScreeningDecisionDto | null;
  /** Optimistic-concurrency token (__v) — echo back in note/decide. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 naming `<module>.<entity>.<event>`) ─────────────────────

export const HrScreeningEvents = {
  ScreeningCreated: 'hr.screening.created',
  ScreeningDecided: 'hr.screening.decided',
} as const;
export type HrScreeningEventName =
  (typeof HrScreeningEvents)[keyof typeof HrScreeningEvents];

export const ScreeningCreatedPayloadV1 = z.object({
  screeningId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
});

export const ScreeningDecidedPayloadV1 = z.object({
  screeningId: objectId(),
  applicantId: objectId(),
  applicantCode: z.string(),
  outcome: ScreeningOutcomeSchema,
});
