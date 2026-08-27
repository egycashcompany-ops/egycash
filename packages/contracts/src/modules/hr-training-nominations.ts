// التدريب — الترشيح والمقعد (P-HR-TRN §1، القرارات D3، D4، D5، D14).
//
// A NOMINATION IS A REQUEST AND AN ENROLLMENT IS A HELD SEAT, and collapsing them is the usual way
// a training system loses track of who actually turned up. Somebody may be nominated and refused;
// somebody may hold a seat that was never nominated by anybody, because HR put them in it. The two
// have different lifecycles and different authors, so they are two collections.
//
// THE APPROVAL SHAPE IS P-HR-04'S, UNCHANGED (D3): `draft → pendingApproval → approved | rejected`,
// a separate `decide` key, and one rule a permission cannot express — the NOMINATOR MAY NOT DECIDE
// THEIR OWN NOMINATION. A key says what you may do, not who you are, so that rule lives in the
// service beside the same rule `employeeLoan.decide` already carries.
//
// SELF-NOMINATION IS ALLOWED (D4). The seam is the decision, not the request: an employee asking
// to be taught something is exactly what this feature is for, and D3 already stops them approving
// it. That is one rule doing two jobs rather than two rules that could disagree.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

// ── Closed vocabulary ───────────────────────────────────────────────────────

export const TRAINING_NOMINATION_STATUSES = [
  'draft',
  'pendingApproval',
  'approved',
  'rejected',
  'withdrawn',
] as const;
export const TrainingNominationStatusSchema = z.enum(TRAINING_NOMINATION_STATUSES);
export type TrainingNominationStatus = z.infer<typeof TrainingNominationStatusSchema>;

/**
 * Where one person's seat stands.
 *
 * THE WHOLE VOCABULARY IS DECLARED HERE, and phase T3 can produce only the first two. `attended`,
 * `absent` and `excused` are marked when a session runs, and `completed` is written by the
 * session's completion act (D6, D7) — both T4. Declaring the closed set now rather than widening
 * it later means the screens, the badge and the mapper are written once against the shape the
 * design froze, instead of changing shape when the second half lands.
 */
export const TRAINING_ENROLLMENT_STATUSES = [
  'enrolled',
  'cancelled',
  'attended',
  'absent',
  'excused',
  'completed',
] as const;
export const TrainingEnrollmentStatusSchema = z.enum(TRAINING_ENROLLMENT_STATUSES);
export type TrainingEnrollmentStatus = z.infer<typeof TrainingEnrollmentStatusSchema>;

// ── Nominating ──────────────────────────────────────────────────────────────

export const CreateTrainingNominationSchema = z
  .object({
    employeeId: objectId(),
    sessionId: objectId(),
    /**
     * Why this person, for this session.
     *
     * Required, because a nomination is a request somebody else has to decide, and «no reason
     * given» is not a request anybody can act on — the same argument that makes a rejection's note
     * mandatory in the applicant-documents review.
     */
    reason: z.string().trim().min(1).max(500),
    note: z.string().trim().max(1000).optional(),
    /** Submit straight away rather than leaving a draft. The common case, so it defaults on. */
    submit: z.boolean().default(true),
  })
  .strict();
export type CreateTrainingNomination = z.infer<typeof CreateTrainingNominationSchema>;

/** HR's answer. A refusal says why; an approval needs no words. */
export const DecideTrainingNominationSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(1000).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === 'rejected' && (value.note ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'a refusal must say why — somebody asked for this person to be taught',
      });
    }
  });
export type DecideTrainingNomination = z.infer<typeof DecideTrainingNominationSchema>;

/** Taking one's own request back, while it is still waiting. */
export const WithdrawTrainingNominationSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type WithdrawTrainingNomination = z.infer<typeof WithdrawTrainingNominationSchema>;

export const ListTrainingNominationsQuerySchema = PaginationQuerySchema.extend({
  status: z
    .union([TrainingNominationStatusSchema, z.array(TrainingNominationStatusSchema)])
    .optional(),
  sessionId: objectId().optional(),
  employeeId: objectId().optional(),
  /** The queue HR works: everything still waiting on a decision. */
  pendingOnly: z.coerce.boolean().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListTrainingNominationsQuery = z.infer<typeof ListTrainingNominationsQuerySchema>;

export interface TrainingNominationDto {
  id: string;
  employeeId: string;
  /** Denormalized so a queue crossing hundreds of people is one query, not hundreds. */
  employeeCode: string;
  employeeName: string;
  sessionId: string;
  sessionCode: string;
  courseKey: string;
  courseNameAr: string;
  courseNameEn: string;
  sessionStartsAt: string;
  status: TrainingNominationStatus;
  reason: string;
  note: string | null;
  nominatedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The enrollment an approval created, once there is one. */
  enrollmentId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Holding a seat ──────────────────────────────────────────────────────────

/**
 * Putting somebody in a session directly, with no nomination behind it.
 *
 * NOT A SHORTCUT AROUND THE APPROVAL. Somebody holding `trainingNomination.decide` may already
 * approve any nomination they like, so a direct enrollment grants them nothing they did not have —
 * it spares them writing a request to themselves in order to answer it, which is a ceremony that
 * teaches people to ignore ceremonies.
 */
export const EnrollInTrainingSessionSchema = z
  .object({
    employeeId: objectId(),
    sessionId: objectId(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type EnrollInTrainingSession = z.infer<typeof EnrollInTrainingSessionSchema>;

/** Taking a seat back. Says why — somebody was expecting to attend. */
export const CancelTrainingEnrollmentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    version: z.number().int().min(0),
  })
  .strict();
export type CancelTrainingEnrollment = z.infer<typeof CancelTrainingEnrollmentSchema>;

export const ListTrainingEnrollmentsQuerySchema = PaginationQuerySchema.extend({
  sessionId: objectId().optional(),
  employeeId: objectId().optional(),
  status: z
    .union([TrainingEnrollmentStatusSchema, z.array(TrainingEnrollmentStatusSchema)])
    .optional(),
  /** The roster: seats that still count against capacity and are expected in the room. */
  liveOnly: z.coerce.boolean().optional(),
}).strict();
export type ListTrainingEnrollmentsQuery = z.infer<typeof ListTrainingEnrollmentsQuerySchema>;

export interface TrainingEnrollmentDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  sessionId: string;
  sessionCode: string;
  courseKey: string;
  status: TrainingEnrollmentStatus;
  /** Null when HR put them in directly rather than through a request. */
  nominationId: string | null;
  note: string | null;
  cancelledReason: string | null;
  enrolledAt: string;
  version: number;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────

export const HrTrainingNominationEvents = {
  Submitted: 'hr.trainingNomination.submitted',
  Approved: 'hr.trainingNomination.approved',
  Rejected: 'hr.trainingNomination.rejected',
  Withdrawn: 'hr.trainingNomination.withdrawn',
} as const;
export type HrTrainingNominationEventName =
  (typeof HrTrainingNominationEvents)[keyof typeof HrTrainingNominationEvents];

export const HrTrainingEnrollmentEvents = {
  Created: 'hr.trainingEnrollment.created',
  Cancelled: 'hr.trainingEnrollment.cancelled',
} as const;
export type HrTrainingEnrollmentEventName =
  (typeof HrTrainingEnrollmentEvents)[keyof typeof HrTrainingEnrollmentEvents];

export const TrainingNominationEventPayloadV1 = z.object({
  nominationId: objectId(),
  employeeId: objectId(),
  sessionId: objectId(),
  sessionCode: z.string(),
  courseKey: z.string(),
});

export const TrainingEnrollmentEventPayloadV1 = z.object({
  enrollmentId: objectId(),
  employeeId: objectId(),
  sessionId: objectId(),
  sessionCode: z.string(),
  courseKey: z.string(),
});
