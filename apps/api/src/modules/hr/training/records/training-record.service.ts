// Marking the room, completing the session, and writing what people were taught (D6–D10).
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: presence is not qualification (D7). `markAttendance`
// records that somebody was in the room, and it writes no record and creates no certificate.
// `complete` writes the records, and it writes one per enrollment the CALLER NAMED — never one
// per attendee, because turning attendance into a qualification automatically would be inventing
// an assessment rule nobody has given, and a certificate issued by that rule would be a claim the
// company makes about a person on no evidence.
//
// WHAT MAY BE NAMED IS STILL CHECKED. The caller chooses who qualifies; they do not get to
// qualify somebody who was marked absent, or somebody who is not in this session at all. The
// decision is theirs, the facts are not.
import { type Types } from 'mongoose';
import {
  HrTrainingAttendanceEvents,
  HrTrainingRecordEvents,
  type AttachTrainingCertificate,
  type CompleteTrainingSession,
  type ListTrainingRecordsQuery,
  type MarkTrainingAttendance,
  type MarkTrainingAttendanceBulk,
  type Paginated,
} from '@ecms/contracts';
import { BusinessRuleError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { trainingSessionService } from '../sessions/training-session.service';
import { trainingEnrollmentRepository } from '../nominations/training-nomination.repository';
import { type TrainingEnrollmentDoc } from '../nominations/training-enrollment.model';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import {
  resolveTrainingCertificateCategoryId,
  TRAINING_RECORD_ENTITY_TYPE,
} from './training-record.files';
import { trainingRecordRepository } from './training-record.repository';
import { type TrainingRecordDoc } from './training-record.model';

const recordRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'trainingRecord',
  entityId: id,
});
const enrollmentRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'trainingEnrollment',
  entityId: id,
});

/** Which seats a session may still be marked against — a settled one is not re-marked. */
const MARKABLE: readonly string[] = ['enrolled', 'attended', 'absent', 'excused'];

class TrainingRecordService {
  // ── Marking the room (D6) ───────────────────────────────────────────────

  async markAttendance(
    ctx: AuthContext,
    enrollmentId: string,
    input: MarkTrainingAttendance,
    scope: ScopeSelector,
  ): Promise<TrainingEnrollmentDoc> {
    const before = await trainingEnrollmentRepository.getById(enrollmentId, scope);
    if (!MARKABLE.includes(before.status)) {
      throw new BusinessRuleError(
        `this seat is ${before.status} — attendance cannot be recorded against it`,
      );
    }
    const updated = await trainingEnrollmentRepository.updateById(
      enrollmentId,
      { status: input.outcome, note: input.note ?? before.note },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: enrollmentRef(enrollmentId),
      action: 'update',
      changes: [{ field: 'status', old: before.status, new: input.outcome }],
    });
    await emit(HrTrainingAttendanceEvents.Marked, {
      enrollmentId,
      employeeId: String(updated.employeeId),
      sessionId: String(updated.sessionId),
      outcome: input.outcome,
    });
    return updated;
  }

  /**
   * The whole room at once — how somebody running a session actually works.
   *
   * Each mark is applied on its own, version-checked on its own, and a failure on one does not
   * roll back the rest: the person marking has a room in front of them, and losing nineteen
   * correct marks because the twentieth was edited in another tab would be the wrong trade. The
   * failures are returned so the screen can say which.
   */
  async markAttendanceBulk(
    ctx: AuthContext,
    input: MarkTrainingAttendanceBulk,
    scope: ScopeSelector,
  ): Promise<{ marked: number; failed: { enrollmentId: string; reason: string }[] }> {
    const failed: { enrollmentId: string; reason: string }[] = [];
    let marked = 0;
    for (const mark of input.marks) {
      try {
        await this.markAttendance(
          ctx,
          mark.enrollmentId,
          { outcome: mark.outcome, version: mark.version },
          scope,
        );
        marked += 1;
      } catch (error) {
        failed.push({
          enrollmentId: mark.enrollmentId,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    return { marked, failed };
  }

  // ── Completing, and the records it writes (D7, D8) ──────────────────────

  async complete(
    ctx: AuthContext,
    sessionId: string,
    input: CompleteTrainingSession,
    scope: ScopeSelector,
  ): Promise<{ session: unknown; created: number }> {
    const session = await trainingSessionService.getById(sessionId, scope);

    // What the caller may name is checked even though WHO they name is their decision.
    const named = [...new Set(input.completing)];
    const seats = await Promise.all(
      named.map(async (id) => trainingEnrollmentRepository.getById(id, scope)),
    );
    for (const seat of seats) {
      if (String(seat.sessionId) !== sessionId) {
        throw new ValidationError([
          {
            field: 'completing',
            code: 'INVALID',
            message: `${String(seat._id)} is not a seat in this session`,
          },
        ]);
      }
      // Somebody who was not there did not complete it. The caller decides who qualifies among
      // the people who were present; they do not get to qualify an empty chair.
      if (seat.status === 'absent' || seat.status === 'cancelled') {
        throw new BusinessRuleError(
          `${seat.employeeName} was ${seat.status} — they cannot be completed`,
        );
      }
    }

    let created = 0;
    for (const seat of seats) {
      const record = await trainingRecordRepository.create(
        {
          employeeId: seat.employeeId,
          employeeCode: seat.employeeCode,
          employeeName: seat.employeeName,
          courseId: session.courseId,
          courseKey: session.courseKey,
          // COPIED, not referenced (D8): a course renamed in 2028 must not change what this says.
          courseNameAr: session.courseName.ar,
          courseNameEn: session.courseName.en,
          sessionId: session._id as Types.ObjectId,
          sessionCode: session.code,
          trainerName: session.trainerName,
          startedAt: session.startsAt,
          completedAt: new Date(),
          expiresAt: null,
          certificateFileId: null,
          certificateFileName: null,
          note: input.note ?? null,
          branchId: seat.branchId,
          departmentId: seat.departmentId,
        },
        { by: ctx.userId },
      );
      created += 1;
      await trainingEnrollmentRepository.updateById(
        String(seat._id),
        { status: 'completed' },
        { by: ctx.userId, version: seat.__v, scope },
      );
      await auditService.record({
        entityRef: recordRef(String(record._id)),
        action: 'create',
        changes: [
          { field: 'employee', old: null, new: seat.employeeCode },
          { field: 'course', old: null, new: session.courseKey },
          { field: 'session', old: null, new: session.code },
        ],
      });
      await emit(HrTrainingRecordEvents.Created, {
        recordId: String(record._id),
        employeeId: String(seat.employeeId),
        courseKey: session.courseKey,
        sessionCode: session.code,
      });
    }

    // LAST. The session's own guard refuses a second completion, so writing the records first
    // means a failure part-way leaves the session still completable rather than closed with half
    // its people unqualified.
    const completed = await trainingSessionService.markCompleted(
      ctx,
      sessionId,
      input.version,
      scope,
    );
    return { session: completed, created };
  }

  // ── The records, and their certificates (D9) ────────────────────────────

  async list(
    query: ListTrainingRecordsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingRecordDoc>> {
    return trainingRecordRepository.listFiltered(
      {
        employeeId: query.employeeId,
        courseId: query.courseId,
        sessionId: query.sessionId,
        search: query.search,
      },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<TrainingRecordDoc> {
    return trainingRecordRepository.getById(id, scope);
  }

  /**
   * The paperwork, arriving after the fact (D9).
   *
   * THE ONLY WRITE A RECORD EVER TAKES, and it touches three fields: the file, its name, and the
   * expiry the paper carries. Everything the record SAYS — who, what, when — was settled when it
   * was written and is not editable here or anywhere.
   */
  async attachCertificate(
    ctx: AuthContext,
    id: string,
    binary: UploadedBinary,
    input: AttachTrainingCertificate,
    scope: ScopeSelector,
  ): Promise<TrainingRecordDoc> {
    const before = await trainingRecordRepository.getById(id, scope);
    // Filed against the RECORD, not the employee or the session: the authorizer answers «may this
    // caller reach this record», and a certificate has no meaning apart from the one it certifies.
    const categoryId = await resolveTrainingCertificateCategoryId();
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: TRAINING_RECORD_ENTITY_TYPE,
        entityId: id,
        categoryId,
        displayName: `${before.courseNameAr} — ${before.employeeName}`,
        visibility: 'private',
        tags: [],
      },
      binary,
    );
    const updated = await trainingRecordRepository.updateById(
      id,
      {
        certificateFileId: file._id as Types.ObjectId,
        certificateFileName: binary.originalName,
        // Recorded, and read by nothing (D10).
        expiresAt: input.expiresAt ?? before.expiresAt,
      },
      { by: ctx.userId, version: before.__v, scope },
    );
    await auditService.record({
      entityRef: recordRef(id),
      action: 'update',
      changes: [
        { field: 'certificate', old: before.certificateFileName, new: binary.originalName },
      ],
    });
    await emit(HrTrainingRecordEvents.CertificateAttached, {
      recordId: id,
      employeeId: String(updated.employeeId),
      courseKey: updated.courseKey,
      sessionCode: updated.sessionCode,
    });
    return updated;
  }
}

export const trainingRecordService = new TrainingRecordService();
