// Scheduling and running one delivery (P-HR-TRN §4, D2, D5).
//
// THE STATE MACHINE IS NOT HERE. `session-rules.ts` owns it, pure and testable without a database,
// and this service does what a service does: read, check, write, audit, emit. A transition that
// the rules refuse is a `BusinessRuleError` naming both states, because "cannot cancel" tells the
// caller nothing they can act on.
//
// COMPLETION WRITES NO RECORDS YET, and that is a phase boundary rather than an oversight. D7 says
// completing a session is the act that writes the immutable training records — and the record
// collection is T4's. The transition, its event and its audit entry all ship here so the shape is
// right; T4 subscribes the writing to `hr.trainingSession.completed` rather than reaching in.
import { Types } from 'mongoose';
import {
  HrTrainingEvents,
  type CreateTrainingSession,
  type ListTrainingSessionsQuery,
  type Paginated,
  type TransitionTrainingSession,
  type UpdateTrainingSession,
} from '@ecms/contracts';
import { BusinessRuleError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { diffChanges } from '../../../../shared/utils/diff';
import { trainingCourseService } from '../courses/training-course.service';
import { nextSessionNumber } from './session-sequence';
import { canTransition, COMPLETED, TARGET_OF } from './session-rules';
import { trainingSessionRepository } from './training-session.repository';
import { type TrainingSessionDoc } from './training-session.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'trainingSession', entityId: id });

const snapshot = (doc: TrainingSessionDoc) => ({
  status: doc.status,
  startsAt: doc.startsAt.toISOString(),
  endsAt: doc.endsAt.toISOString(),
  deliveryMode: doc.deliveryMode,
  location: doc.location,
  trainerName: doc.trainerName,
  capacity: doc.capacity,
  note: doc.note,
});

const EVENT_OF = {
  running: HrTrainingEvents.SessionStarted,
  cancelled: HrTrainingEvents.SessionCancelled,
} as const;

class TrainingSessionService {
  async list(
    query: ListTrainingSessionsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingSessionDoc>> {
    const status = query.status === undefined
      ? undefined
      : Array.isArray(query.status)
        ? query.status
        : [query.status];
    return trainingSessionRepository.listFiltered(
      {
        status,
        courseId: query.courseId,
        branchId: query.branchId,
        from: query.from,
        to: query.to,
        search: query.search,
      },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<TrainingSessionDoc> {
    return trainingSessionRepository.getById(id, scope);
  }

  async create(ctx: AuthContext, input: CreateTrainingSession): Promise<TrainingSessionDoc> {
    // The course is read rather than trusted: a session of a retired course would put people in a
    // room to learn something the catalogue says we no longer teach.
    const course = await trainingCourseService.getById(input.courseId);
    if (!course.active) {
      throw new ValidationError([
        { field: 'courseId', code: 'INVALID', message: 'this course is no longer active' },
      ]);
    }
    const code = await nextSessionNumber(input.startsAt.getUTCFullYear());
    const doc = await trainingSessionRepository.create(
      {
        code,
        courseId: new Types.ObjectId(input.courseId),
        // Copied for the list read (see the model): a cache, not the record's permanent snapshot.
        courseKey: course.key,
        courseName: course.name,
        status: 'scheduled',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        deliveryMode: input.deliveryMode ?? course.defaultDeliveryMode,
        location: input.location ?? null,
        trainerName: input.trainerName ?? null,
        capacity: input.capacity ?? null,
        note: input.note ?? null,
        branchId: input.branchId === undefined ? null : new Types.ObjectId(input.branchId),
        cancelledReason: null,
        completedAt: null,
        completedBy: null,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(HrTrainingEvents.SessionScheduled, {
      sessionId: String(doc._id),
      sessionCode: doc.code,
      courseKey: doc.courseKey,
    });
    return doc;
  }

  /** Editing the arrangements. Only a session that has not started yet — see the guard. */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateTrainingSession,
    scope: ScopeSelector,
  ): Promise<TrainingSessionDoc> {
    const before = await trainingSessionRepository.getById(id, scope);
    if (before.status !== 'scheduled') {
      throw new BusinessRuleError(
        `only a scheduled session can be edited — this one is ${before.status}`,
      );
    }
    const set: Partial<TrainingSessionDoc> = {};
    if (input.startsAt !== undefined) set.startsAt = input.startsAt;
    if (input.endsAt !== undefined) set.endsAt = input.endsAt;
    if (input.deliveryMode !== undefined) set.deliveryMode = input.deliveryMode;
    if (input.location !== undefined) set.location = input.location;
    if (input.trainerName !== undefined) set.trainerName = input.trainerName;
    if (input.capacity !== undefined) set.capacity = input.capacity;
    if (input.note !== undefined) set.note = input.note;

    // The window is checked against the MERGED state, not against what arrived: moving only the
    // start date past the stored end is exactly how an incoherent window gets written.
    const startsAt = set.startsAt ?? before.startsAt;
    const endsAt = set.endsAt ?? before.endsAt;
    if (endsAt.getTime() < startsAt.getTime()) {
      throw new BusinessRuleError('a session cannot end before it starts');
    }

    const updated = await trainingSessionRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }

  /**
   * Start or cancel — the machine in `session-rules.ts`, applied and recorded.
   *
   * COMPLETION IS NOT HERE. It writes one immutable record per named enrollment (D7), which is a
   * different act with a different argument, and it lives in the nominations feature beside the
   * enrollments it reads. This method is what is left when that is taken out: two status changes
   * that mean nothing beyond themselves.
   */
  async transition(
    ctx: AuthContext,
    id: string,
    input: TransitionTrainingSession,
    scope: ScopeSelector,
  ): Promise<TrainingSessionDoc> {
    const before = await trainingSessionRepository.getById(id, scope);
    const to = TARGET_OF[input.action];
    if (!canTransition(before.status, to)) {
      // Both states named: "cannot cancel" tells the caller nothing they can act on.
      throw new BusinessRuleError(`a ${before.status} session cannot become ${to}`);
    }
    const set: Partial<TrainingSessionDoc> = { status: to };
    if (to === 'cancelled') set.cancelledReason = input.reason ?? null;
    const updated = await trainingSessionRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: 'status', old: before.status, new: to },
        ...(input.reason === undefined ? [] : [{ field: 'reason', old: null, new: input.reason }]),
      ],
    });
    await emit(EVENT_OF[to], {
      sessionId: id,
      sessionCode: updated.code,
      courseKey: updated.courseKey,
    });
    return updated;
  }
  /**
   * Stamp a session completed — the WRITE half of the completion act (D7).
   *
   * Narrow on purpose, and it checks the machine rather than trusting the caller: the records are
   * written by the nominations feature (which owns the enrollments), and this is the only thing it
   * is allowed to do to a session. A method that took a status would let any caller set any one.
   */
  async markCompleted(
    ctx: AuthContext,
    id: string,
    version: number,
    scope: ScopeSelector,
  ): Promise<TrainingSessionDoc> {
    const before = await trainingSessionRepository.getById(id, scope);
    if (!canTransition(before.status, COMPLETED)) {
      throw new BusinessRuleError(`a ${before.status} session cannot become ${COMPLETED}`);
    }
    const updated = await trainingSessionRepository.updateById(
      id,
      {
        status: COMPLETED,
        completedAt: new Date(),
        completedBy: new Types.ObjectId(ctx.userId),
      },
      { by: ctx.userId, version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'status', old: before.status, new: COMPLETED }],
    });
    await emit(HrTrainingEvents.SessionCompleted, {
      sessionId: id,
      sessionCode: updated.code,
      courseKey: updated.courseKey,
    });
    return updated;
  }
}

export const trainingSessionService = new TrainingSessionService();
