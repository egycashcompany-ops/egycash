// التدريب — الكتالوج والجلسات (P-HR-TRN §1، القرارات D1، D2، D5، D12، D14).
//
// A COURSE IS CONFIGURATION AND A SESSION IS AN EVENT, and keeping them apart is the whole of D1
// and D2. «Defensive driving» is one row that exists whether or not anybody is being taught this
// month; running it in March and again in July creates two sessions and does not duplicate the
// catalogue entry. Reporting later asks "how many people have done defensive driving" across every
// delivery, and that question only has an answer while the course is one row.
//
// THE CATALOGUE IS DATA (D1). The same stance D-APP-4 took for applicant documents and RW9 for
// evaluation phases: an employer's training programme changes far more often than this codebase
// deploys, so a new course next year is an administrator's afternoon rather than a release.
//
// WHAT IS ABSENT ON PURPOSE, and each absence is a decision rather than an omission:
//
//   • NO PRICE, no budget, no cost centre (D12). Adding money would pull in the accounting boundary
//     that PY-12, P-HR-12 and P-HR-14 are all deliberately stopped at.
//   • NO REQUIRED-BY-JOB-TITLE flag (D13). «every driver must hold defensive driving» is a real
//     rule about job titles that nobody has stated, and compliance computed from an invented rule
//     would be worse than no compliance screen at all.
//   • NO WAITING LIST behind `capacity` (D5). A nomination past a full session is refused, and
//     somebody decides again. A queue that promoted people automatically would be deciding who
//     attends, which is a person's job.
import { z } from 'zod';
import {
  objectId,
  LocalizedStringSchema,
  PaginationQuerySchema,
  type LocalizedString,
} from '../common/index.js';

// ── Closed vocabulary ───────────────────────────────────────────────────────

/**
 * How a session is delivered.
 *
 * Recorded because «where was it» is part of what a training record has to answer years later, and
 * because a reader scanning a list wants to know whether the row implies travel. It carries no
 * behaviour: an `online` session is scheduled, attended and completed exactly as a `classroom` one.
 */
export const TRAINING_DELIVERY_MODES = ['classroom', 'online', 'onTheJob', 'external'] as const;
export const TrainingDeliveryModeSchema = z.enum(TRAINING_DELIVERY_MODES);
export type TrainingDeliveryMode = z.infer<typeof TrainingDeliveryModeSchema>;

/**
 * Where a session stands (P-HR-TRN §4).
 *
 * `completed` is TERMINAL and is the act that writes the immutable records — it is not a label
 * somebody sets when the day is over. `cancelled` is equally terminal and writes nothing: a
 * session that did not happen taught nobody, and a record saying otherwise would be a lie the
 * system could not later distinguish from the truth.
 */
export const TRAINING_SESSION_STATUSES = ['scheduled', 'running', 'completed', 'cancelled'] as const;
export const TrainingSessionStatusSchema = z.enum(TRAINING_SESSION_STATUSES);
export type TrainingSessionStatus = z.infer<typeof TrainingSessionStatusSchema>;

// ── The catalogue (D1) ──────────────────────────────────────────────────────

export const CreateTrainingCourseSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9.]{1,49}$/),
    name: LocalizedStringSchema,
    description: LocalizedStringSchema.optional(),
    /**
     * How long one delivery normally takes, in hours.
     *
     * On the COURSE because it is a property of the material, and advisory because a session states
     * its own dates: a course that usually takes six hours may be delivered over two mornings, and
     * neither the session nor the record is computed from this.
     */
    defaultDurationHours: z.number().min(0).max(1000).optional(),
    defaultDeliveryMode: TrainingDeliveryModeSchema.default('classroom'),
    order: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type CreateTrainingCourse = z.infer<typeof CreateTrainingCourseSchema>;

export const UpdateTrainingCourseSchema = z
  .object({
    name: LocalizedStringSchema.optional(),
    description: LocalizedStringSchema.optional(),
    defaultDurationHours: z.number().min(0).max(1000).nullable().optional(),
    defaultDeliveryMode: TrainingDeliveryModeSchema.optional(),
    order: z.number().int().min(0).max(999).optional(),
    /** Deactivation, never deletion — historical records name this course (D8). */
    active: z.boolean().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateTrainingCourse = z.infer<typeof UpdateTrainingCourseSchema>;

export const ListTrainingCoursesQuerySchema = PaginationQuerySchema.extend({
  active: z.coerce.boolean().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListTrainingCoursesQuery = z.infer<typeof ListTrainingCoursesQuerySchema>;

export interface TrainingCourseDto {
  id: string;
  key: string;
  name: LocalizedString;
  description: LocalizedString | null;
  defaultDurationHours: number | null;
  defaultDeliveryMode: TrainingDeliveryMode;
  order: number;
  active: boolean;
  version: number;
}

// ── Sessions (D2, D5) ───────────────────────────────────────────────────────

/**
 * One delivery of one course.
 *
 * `startsAt`/`endsAt` are instants rather than a date and a duration, because a session that runs
 * over two mornings is normal and «three hours» does not say which three.
 */
export const CreateTrainingSessionSchema = z
  .object({
    courseId: objectId(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    deliveryMode: TrainingDeliveryModeSchema.optional(),
    /** Free text: a room, a city, a platform. Not an org unit — a session is not placed. */
    location: z.string().trim().max(200).optional(),
    /** Who taught it, as written. Not a user reference: most trainers are not ECMS accounts. */
    trainerName: z.string().trim().max(200).optional(),
    /**
     * Seats, when there are a limited number (D5). Absent means unlimited — not zero, which would
     * make every nomination fail and read as a system fault.
     */
    capacity: z.number().int().min(1).max(10_000).optional(),
    note: z.string().trim().max(1000).optional(),
    /** The branch this delivery belongs to; department follows the enrolled employees. */
    branchId: objectId().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endsAt.getTime() < value.startsAt.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'a session cannot end before it starts',
      });
    }
  });
export type CreateTrainingSession = z.infer<typeof CreateTrainingSessionSchema>;

/**
 * Editing a scheduled session. The course is absent on purpose: a session IS a delivery of one
 * course (D2), so changing it would make the enrollments already taken describe a different thing.
 * Cancel it and schedule another.
 */
export const UpdateTrainingSessionSchema = z
  .object({
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    deliveryMode: TrainingDeliveryModeSchema.optional(),
    location: z.string().trim().max(200).nullable().optional(),
    trainerName: z.string().trim().max(200).nullable().optional(),
    capacity: z.number().int().min(1).max(10_000).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type UpdateTrainingSession = z.infer<typeof UpdateTrainingSessionSchema>;

/** Moving a session along §4. Cancelling states why; starting and completing need no words. */
export const TransitionTrainingSessionSchema = z
  .object({
    action: z.enum(['start', 'complete', 'cancel']),
    reason: z.string().trim().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'cancel' && (value.reason ?? '').trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'a cancelled session must say why — people were expecting to attend it',
      });
    }
  });
export type TransitionTrainingSession = z.infer<typeof TransitionTrainingSessionSchema>;

export const ListTrainingSessionsQuerySchema = PaginationQuerySchema.extend({
  status: z.union([TrainingSessionStatusSchema, z.array(TrainingSessionStatusSchema)]).optional(),
  courseId: objectId().optional(),
  branchId: objectId().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListTrainingSessionsQuery = z.infer<typeof ListTrainingSessionsQuerySchema>;

export interface TrainingSessionDto {
  id: string;
  code: string;
  courseId: string;
  /** Denormalized so a list of sessions is one query — the same reason every HR queue does it. */
  courseKey: string;
  courseName: LocalizedString;
  status: TrainingSessionStatus;
  startsAt: string;
  endsAt: string;
  deliveryMode: TrainingDeliveryMode;
  location: string | null;
  trainerName: string | null;
  capacity: number | null;
  /** Seats taken — live enrollments, counted by the server (D5). */
  enrolledCount: number;
  /** `null` when there is no capacity; never a negative number. */
  seatsLeft: number | null;
  note: string | null;
  branchId: string | null;
  cancelledReason: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────

export const HrTrainingEvents = {
  SessionScheduled: 'hr.trainingSession.scheduled',
  SessionStarted: 'hr.trainingSession.started',
  SessionCompleted: 'hr.trainingSession.completed',
  SessionCancelled: 'hr.trainingSession.cancelled',
} as const;
export type HrTrainingEventName = (typeof HrTrainingEvents)[keyof typeof HrTrainingEvents];

export const TrainingSessionEventPayloadV1 = z.object({
  sessionId: objectId(),
  sessionCode: z.string(),
  courseKey: z.string(),
});
