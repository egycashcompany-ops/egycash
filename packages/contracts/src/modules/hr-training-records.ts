// التدريب — الحضور والإتمام والسجل (P-HR-TRN §1، القرارات D6 … D10).
//
// THE RECORD IS WHY THIS MODULE EXISTS. Everything before it — the catalogue, the session, the
// nomination, the seat — is scaffolding for one sentence somebody needs to be able to say years
// later: «Ahmed completed defensive driving on 5 March 2026, and here is the certificate.» That
// sentence has to survive the course being renamed, the trainer leaving and the session being
// deleted, which is why a record COPIES what it says instead of pointing at it (D8).
//
// PRESENCE IS NOT QUALIFICATION (D7). Marking somebody `attended` records that they were in the
// room. It does not complete them. A session is completed as an explicit act that NAMES the people
// it qualifies, because turning attendance into a qualification automatically would be inventing
// an assessment rule nobody has given — and a certificate issued by that rule would be a claim the
// company makes about a person on no evidence.
//
// AN EXPIRY IS RECORDED AND GATES NOTHING (D10). Some certificates carry one and it belongs on the
// record. Whether an expired certificate stops somebody driving, working or being scheduled is a
// labour and safety rule nobody has given, so nothing here consumes it: no sweep, no block, no
// notification. Recording a fact is not enforcing a policy.
import { z } from 'zod';
import { objectId, PaginationQuerySchema } from '../common/index.js';

// ── Marking the room (D6) ───────────────────────────────────────────────────

/**
 * What happened to one seat on the day.
 *
 * `excused` is not a softer `absent`: it says somebody knew and agreed in advance, which is a
 * different fact about the same empty chair and the difference a manager reading the history
 * actually cares about. Neither of them frees the seat — see `occupiesSeat`.
 */
export const TRAINING_ATTENDANCE_OUTCOMES = ['attended', 'absent', 'excused'] as const;
export const TrainingAttendanceOutcomeSchema = z.enum(TRAINING_ATTENDANCE_OUTCOMES);
export type TrainingAttendanceOutcome = z.infer<typeof TrainingAttendanceOutcomeSchema>;

export const MarkTrainingAttendanceSchema = z
  .object({
    outcome: TrainingAttendanceOutcomeSchema,
    note: z.string().trim().max(500).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type MarkTrainingAttendance = z.infer<typeof MarkTrainingAttendanceSchema>;

/** The whole room at once — the way somebody running a session actually works. */
export const MarkTrainingAttendanceBulkSchema = z
  .object({
    marks: z
      .array(
        z
          .object({
            enrollmentId: objectId(),
            outcome: TrainingAttendanceOutcomeSchema,
            version: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type MarkTrainingAttendanceBulk = z.infer<typeof MarkTrainingAttendanceBulkSchema>;

// ── Completing a session (D7) ───────────────────────────────────────────────

/**
 * D7 — the explicit act, and the list is the whole of it.
 *
 * `completing` NAMES the enrollments that earned a record. It is required and may not be empty by
 * accident: a session completed with nobody named is a real thing (everybody failed, or nobody
 * came), and saying so takes an explicit empty array rather than an omitted field. The difference
 * matters because «I forgot the list» and «nobody qualified» must not look the same to the server.
 */
export const CompleteTrainingSessionSchema = z
  .object({
    completing: z.array(objectId()).max(500),
    note: z.string().trim().max(1000).optional(),
    version: z.number().int().min(0),
  })
  .strict();
export type CompleteTrainingSession = z.infer<typeof CompleteTrainingSessionSchema>;

// ── The record (D8) ─────────────────────────────────────────────────────────

/**
 * What this person was taught, and when. Written once and never edited.
 *
 * EVERY NAME HERE IS A COPY taken at the moment of writing. `courseName` is not read through
 * `courseId` and `sessionCode` is not read through `sessionId` — those ids are kept so somebody can
 * still trace the row, but nothing this DTO shows depends on them still resolving. A course
 * renamed in 2028 must not change what a 2026 certificate says.
 */
export interface TrainingRecordDto {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  courseId: string;
  courseKey: string;
  courseNameAr: string;
  courseNameEn: string;
  sessionId: string;
  sessionCode: string;
  trainerName: string | null;
  startedAt: string;
  completedAt: string;
  /** Recorded when the certificate carries one, and consumed by nothing (D10). */
  expiresAt: string | null;
  /** The certificate, once it arrives. A record stands without one (D9). */
  certificateFileId: string | null;
  certificateFileName: string | null;
  note: string | null;
  createdAt: string;
}

export const ListTrainingRecordsQuerySchema = PaginationQuerySchema.extend({
  employeeId: objectId().optional(),
  courseId: objectId().optional(),
  sessionId: objectId().optional(),
  search: z.string().max(100).optional(),
}).strict();
export type ListTrainingRecordsQuery = z.infer<typeof ListTrainingRecordsQuerySchema>;

// ── The certificate (D9) ────────────────────────────────────────────────────

/**
 * Attaching the paperwork, and stating an expiry if the paper carries one.
 *
 * SEPARATE FROM THE RECORD'S CREATION on purpose. A record is written the moment a session is
 * completed; the certificate is printed, signed and scanned days later. Requiring it at completion
 * would mean either delaying the record or inventing a placeholder, and a record with no
 * certificate is a completed training whose paperwork has not arrived — a normal state, not an
 * error.
 *
 * The expiry rides with the file because it is a fact ON the certificate, and nothing reads it.
 */
export const AttachTrainingCertificateSchema = z
  .object({
    expiresAt: z.coerce.date().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type AttachTrainingCertificate = z.infer<typeof AttachTrainingCertificateSchema>;

/**
 * Where a training certificate lives (D9).
 *
 * Its own category, not the applicant-portal one and not hiring documents: those hold what a
 * candidate hands in before they are hired, and this holds what the company issues to somebody
 * already employed. Two populations, two lifecycles, two authorizers.
 */
export const TRAINING_CERTIFICATE_FILE_CATEGORY = 'hr-training-certificates';

// ── Events (ADR-008 `<module>.<entity>.<event>`) ────────────────────────────

export const HrTrainingRecordEvents = {
  Created: 'hr.trainingRecord.created',
  CertificateAttached: 'hr.trainingRecord.certificateAttached',
} as const;
export type HrTrainingRecordEventName =
  (typeof HrTrainingRecordEvents)[keyof typeof HrTrainingRecordEvents];

export const HrTrainingAttendanceEvents = {
  Marked: 'hr.trainingEnrollment.attendanceMarked',
} as const;
export type HrTrainingAttendanceEventName =
  (typeof HrTrainingAttendanceEvents)[keyof typeof HrTrainingAttendanceEvents];

export const TrainingRecordEventPayloadV1 = z.object({
  recordId: objectId(),
  employeeId: objectId(),
  courseKey: z.string(),
  sessionCode: z.string(),
});

export const TrainingAttendanceEventPayloadV1 = z.object({
  enrollmentId: objectId(),
  employeeId: objectId(),
  sessionId: objectId(),
  outcome: TrainingAttendanceOutcomeSchema,
});
