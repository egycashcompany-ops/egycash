// Asking for somebody to be taught, and deciding it (P-HR-TRN D3, D4, D5).
//
// TWO RULES LIVE HERE THAT NOTHING ELSE CAN HOLD.
//
//   • THE NOMINATOR MAY NOT DECIDE THEIR OWN NOMINATION (D3). `trainingNomination.decide` says a
//     person may decide nominations; it cannot say «but not their own», because a key describes an
//     ability and this describes a relationship. `mayDecide` in the rules answers it, and this
//     calls it — the same shape `employeeLoan.decide` already uses.
//   • APPROVING PAST A FULL SESSION IS REFUSED (D5). Checked at APPROVAL rather than at
//     nomination, because that is the moment a seat is actually taken: two people may be nominated
//     for a last seat and only one may hold it, and refusing the second at nomination time would
//     be deciding the question before anybody had asked it.
//
// THE INDEX IS THE RACE BACKSTOP, not this code. Two approvals reaching the last seat in the same
// millisecond both pass the count and both try to insert; the enrollment's partial unique index
// refuses the second, and that is reported as the conflict it is.
import { Types } from 'mongoose';
import {
  HrTrainingEnrollmentEvents,
  HrTrainingNominationEvents,
  type CancelTrainingEnrollment,
  type CreateTrainingNomination,
  type DecideTrainingNomination,
  type EnrollInTrainingSession,
  type ListTrainingEnrollmentsQuery,
  type ListTrainingNominationsQuery,
  type Paginated,
  type WithdrawTrainingNomination,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { employeeService } from '../../employee-management/employees/employee.service';
import { acceptsEnrollments, hasSeat } from '../sessions/session-rules';
import { trainingSessionService } from '../sessions/training-session.service';
import { canTransition, mayCancelEnrollment, mayDecide } from './nomination-rules';
import {
  trainingEnrollmentRepository,
  trainingNominationRepository,
} from './training-nomination.repository';
import { type TrainingNominationDoc } from './training-nomination.model';
import { type TrainingEnrollmentDoc } from './training-enrollment.model';

const nominationRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'trainingNomination',
  entityId: id,
});
const enrollmentRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'trainingEnrollment',
  entityId: id,
});

/**
 * The employee's identity and BOTH scope axes, read from the employee record (D14).
 *
 * Read through the caller's scope on purpose: nominating somebody you may not see would be a way
 * to learn they exist, and the 404 the scoped read produces is the right answer to that.
 */
const subjectOf = async (
  employeeId: string,
  scope: ScopeSelector,
): Promise<{
  code: string;
  name: string;
  branchId: Types.ObjectId | null;
  departmentId: Types.ObjectId | null;
}> => {
  const employee = await employeeService.getById(employeeId, scope);
  return {
    code: employee.code,
    name: employee.personal.fullNameAr,
    branchId: employee.branchId,
    departmentId: employee.departmentId,
  };
};

class TrainingNominationService {
  // ── Nominations ───────────────────────────────────────────────────────────

  async list(
    query: ListTrainingNominationsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingNominationDoc>> {
    const explicit =
      query.status === undefined
        ? undefined
        : Array.isArray(query.status)
          ? query.status
          : [query.status];
    // `pendingOnly` is the queue, and it wins over an explicit status: asking for both is asking
    // two questions, and the narrower one is the one the screen means.
    const status = query.pendingOnly === true ? (['pendingApproval'] as const) : explicit;
    return trainingNominationRepository.listFiltered(
      { status, sessionId: query.sessionId, employeeId: query.employeeId, search: query.search },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  async getById(id: string, scope: ScopeSelector): Promise<TrainingNominationDoc> {
    return trainingNominationRepository.getById(id, scope);
  }

  async create(
    ctx: AuthContext,
    input: CreateTrainingNomination,
    scope: ScopeSelector,
  ): Promise<TrainingNominationDoc> {
    const session = await trainingSessionService.getById(input.sessionId, scope);
    if (!acceptsEnrollments(session.status)) {
      throw new BusinessRuleError(
        `this session is ${session.status} — nobody can be nominated for it any more`,
      );
    }
    const subject = await subjectOf(input.employeeId, scope);

    // Two separate «already» cases, and they are different things a caller can act on.
    const seated = await trainingEnrollmentRepository.findLive(input.employeeId, input.sessionId);
    if (seated !== null) throw new ConflictError('this employee already holds a seat in this session');
    const pending = await trainingNominationRepository.findLive(input.employeeId, input.sessionId);
    if (pending !== null) {
      throw new ConflictError('this employee already has a nomination waiting for this session');
    }

    const now = new Date();
    const doc = await trainingNominationRepository.create(
      {
        employeeId: new Types.ObjectId(input.employeeId),
        employeeCode: subject.code,
        employeeName: subject.name,
        sessionId: new Types.ObjectId(input.sessionId),
        sessionCode: session.code,
        courseKey: session.courseKey,
        courseNameAr: session.courseName.ar,
        courseNameEn: session.courseName.en,
        sessionStartsAt: session.startsAt,
        status: input.submit ? 'pendingApproval' : 'draft',
        reason: input.reason,
        note: input.note ?? null,
        nominatedBy: new Types.ObjectId(ctx.userId),
        submittedAt: input.submit ? now : null,
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        enrollmentId: null,
        branchId: subject.branchId,
        departmentId: subject.departmentId,
      },
      { by: ctx.userId },
    );
    await auditService.record({
      entityRef: nominationRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'employee', old: null, new: subject.code },
        { field: 'session', old: null, new: session.code },
        { field: 'status', old: null, new: doc.status },
      ],
    });
    if (input.submit) await this.publish(HrTrainingNominationEvents.Submitted, doc);
    return doc;
  }

  /** Approve or refuse. The two-person rule and the seat check both live in this method. */
  async decide(
    ctx: AuthContext,
    id: string,
    input: DecideTrainingNomination,
    scope: ScopeSelector,
  ): Promise<TrainingNominationDoc> {
    const before = await trainingNominationRepository.getById(id, scope);
    if (!canTransition(before.status, input.decision)) {
      throw new BusinessRuleError(
        `a ${before.status} nomination cannot become ${input.decision}`,
      );
    }
    // D3 — the rule a permission cannot express.
    if (!mayDecide(before.nominatedBy === null ? null : String(before.nominatedBy), ctx.userId)) {
      throw new BusinessRuleError('the person who nominated somebody may not decide it themselves');
    }

    let enrollment: TrainingEnrollmentDoc | null = null;
    if (input.decision === 'approved') {
      enrollment = await this.seat(ctx, before, scope);
    }

    const now = new Date();
    const updated = await trainingNominationRepository.updateById(
      id,
      {
        status: input.decision,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: now,
        decisionNote: input.note ?? null,
        enrollmentId: enrollment === null ? null : (enrollment._id as Types.ObjectId),
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: nominationRef(id),
      action: 'update',
      changes: [
        { field: 'status', old: before.status, new: input.decision },
        ...(input.note === undefined ? [] : [{ field: 'note', old: null, new: input.note }]),
      ],
    });
    await this.publish(
      input.decision === 'approved'
        ? HrTrainingNominationEvents.Approved
        : HrTrainingNominationEvents.Rejected,
      updated,
    );
    return updated;
  }

  async withdraw(
    ctx: AuthContext,
    id: string,
    input: WithdrawTrainingNomination,
    scope: ScopeSelector,
  ): Promise<TrainingNominationDoc> {
    const before = await trainingNominationRepository.getById(id, scope);
    if (!canTransition(before.status, 'withdrawn')) {
      throw new BusinessRuleError(`a ${before.status} nomination cannot be withdrawn`);
    }
    const updated = await trainingNominationRepository.updateById(
      id,
      { status: 'withdrawn', decisionNote: input.reason ?? null },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: nominationRef(id),
      action: 'update',
      changes: [{ field: 'status', old: before.status, new: 'withdrawn' }],
    });
    await this.publish(HrTrainingNominationEvents.Withdrawn, updated);
    return updated;
  }

  // ── Seats ─────────────────────────────────────────────────────────────────

  async listEnrollments(
    query: ListTrainingEnrollmentsQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<TrainingEnrollmentDoc>> {
    const explicit =
      query.status === undefined
        ? undefined
        : Array.isArray(query.status)
          ? query.status
          : [query.status];
    // The ROSTER: who is expected in the room. A cancelled seat is not.
    const status =
      query.liveOnly === true
        ? (['enrolled', 'attended', 'absent', 'excused', 'completed'] as const)
        : explicit;
    return trainingEnrollmentRepository.listFiltered(
      { sessionId: query.sessionId, employeeId: query.employeeId, status },
      { page: query.page, pageSize: query.pageSize, sortBy: query.sortBy, sortDir: query.sortDir },
      scope,
    );
  }

  /** HR putting somebody in directly — see the contract for why this is not a shortcut. */
  async enroll(
    ctx: AuthContext,
    input: EnrollInTrainingSession,
    scope: ScopeSelector,
  ): Promise<TrainingEnrollmentDoc> {
    const session = await trainingSessionService.getById(input.sessionId, scope);
    const subject = await subjectOf(input.employeeId, scope);
    return this.createSeat(ctx, {
      employeeId: input.employeeId,
      subject,
      session,
      nominationId: null,
      note: input.note ?? null,
    });
  }

  async cancelEnrollment(
    ctx: AuthContext,
    id: string,
    input: CancelTrainingEnrollment,
    scope: ScopeSelector,
  ): Promise<TrainingEnrollmentDoc> {
    const before = await trainingEnrollmentRepository.getById(id, scope);
    if (!mayCancelEnrollment(before.status)) {
      throw new BusinessRuleError(
        `this seat is ${before.status} — only a seat still waiting to be used can be taken back`,
      );
    }
    const updated = await trainingEnrollmentRepository.updateById(
      id,
      { status: 'cancelled', cancelledReason: input.reason },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: enrollmentRef(id),
      action: 'update',
      changes: [
        { field: 'status', old: before.status, new: 'cancelled' },
        { field: 'reason', old: null, new: input.reason },
      ],
    });
    await emit(HrTrainingEnrollmentEvents.Cancelled, {
      enrollmentId: id,
      employeeId: String(updated.employeeId),
      sessionId: String(updated.sessionId),
      sessionCode: updated.sessionCode,
      courseKey: updated.courseKey,
    });
    return updated;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** The seat an approval creates. Reads the nomination's own denormalized session facts. */
  private async seat(
    ctx: AuthContext,
    nomination: TrainingNominationDoc,
    scope: ScopeSelector,
  ): Promise<TrainingEnrollmentDoc> {
    const session = await trainingSessionService.getById(String(nomination.sessionId), scope);
    return this.createSeat(ctx, {
      employeeId: String(nomination.employeeId),
      subject: {
        code: nomination.employeeCode,
        name: nomination.employeeName,
        branchId: nomination.branchId,
        departmentId: nomination.departmentId,
      },
      session,
      nominationId: nomination._id as Types.ObjectId,
      note: null,
    });
  }

  private async createSeat(
    ctx: AuthContext,
    input: {
      employeeId: string;
      subject: {
        code: string;
        name: string;
        branchId: Types.ObjectId | null;
        departmentId: Types.ObjectId | null;
      };
      session: { _id: unknown; code: string; courseKey: string; status: string; capacity: number | null };
      nominationId: Types.ObjectId | null;
      note: string | null;
    },
  ): Promise<TrainingEnrollmentDoc> {
    const sessionId = String(input.session._id);
    if (!acceptsEnrollments(input.session.status as never)) {
      throw new BusinessRuleError(
        `this session is ${input.session.status} — nobody can be seated in it any more`,
      );
    }
    const existing = await trainingEnrollmentRepository.findLive(input.employeeId, sessionId);
    if (existing !== null) {
      throw new ConflictError('this employee already holds a seat in this session');
    }
    // D5 — counted unscoped, because capacity is a property of the room (see the repository).
    const taken = await trainingEnrollmentRepository.countOccupied(sessionId);
    if (!hasSeat(input.session.capacity, taken)) {
      throw new ConflictError('this session is full');
    }

    try {
      const doc = await trainingEnrollmentRepository.create(
        {
          employeeId: new Types.ObjectId(input.employeeId),
          employeeCode: input.subject.code,
          employeeName: input.subject.name,
          sessionId: new Types.ObjectId(sessionId),
          sessionCode: input.session.code,
          courseKey: input.session.courseKey,
          status: 'enrolled',
          nominationId: input.nominationId,
          note: input.note,
          cancelledReason: null,
          enrolledAt: new Date(),
          branchId: input.subject.branchId,
          departmentId: input.subject.departmentId,
        },
        { by: ctx.userId },
      );
      await auditService.record({
        entityRef: enrollmentRef(String(doc._id)),
        action: 'create',
        changes: [
          { field: 'employee', old: null, new: input.subject.code },
          { field: 'session', old: null, new: input.session.code },
        ],
      });
      await emit(HrTrainingEnrollmentEvents.Created, {
        enrollmentId: String(doc._id),
        employeeId: input.employeeId,
        sessionId,
        sessionCode: input.session.code,
        courseKey: input.session.courseKey,
      });
      return doc;
    } catch (error) {
      // The partial unique index is the race backstop the count above cannot be: two approvals
      // reaching the last seat together both pass the count, and one of them must lose here.
      if (error instanceof Error && error.message.includes('E11000')) {
        throw new ConflictError('this employee already holds a seat in this session');
      }
      throw error;
    }
  }

  private async publish(name: string, doc: TrainingNominationDoc): Promise<void> {
    await emit(name as never, {
      nominationId: String(doc._id),
      employeeId: String(doc.employeeId),
      sessionId: String(doc.sessionId),
      sessionCode: doc.sessionCode,
      courseKey: doc.courseKey,
    });
  }
}

export const trainingNominationService = new TrainingNominationService();
