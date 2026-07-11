// Interview lifecycle (Stage 3). An applicant who passed Initial Screening advances through
// the administrator-configured interview rounds (OQ-31). Each round is scheduled with a
// panel; panel members record per-interviewer evaluations; a recruiter/manager decides the
// round pass/fail. Passing the last configured stage clears the interview phase (the
// applicant is then ready for a Job Offer — Stage 4, not built here); failing any round
// rejects the applicant. Scheduling, rescheduling, and cancelling notify the panel through
// the platform Notifications service (never blocking the business operation).
//
// Cross-feature access to the Applicant and Screening aggregates goes through their barrels
// only (ADR-003); this feature never reaches into their internals.
import { Types } from 'mongoose';
import {
  HrInterviewEvents,
  HrInterviewTemplates,
  type DecideInterview,
  type ListInterviewsQuery,
  type Paginated,
  type RescheduleInterview,
  type ScheduleInterview,
  type SubmitInterviewEvaluation,
  type CancelInterview,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ForbiddenError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { notificationsService } from '../../../../platform/notifications';
import { applicantService } from '../applicants';
import { screeningService } from '../screening';
import { interviewRepository, type InterviewListFilter } from './interview.repository';
import { interviewStageRepository } from './interview-stage.repository';
import { type InterviewDoc, type InterviewEvaluation } from './interview.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'interview', entityId: id });

const toObjectIds = (ids: string[]): Types.ObjectId[] => ids.map((id) => new Types.ObjectId(id));

class InterviewService {
  /** Fire-and-forget panel notification — never blocks or fails the recruitment operation. */
  private async notifyPanel(doc: InterviewDoc, template: string, includeWhen: boolean): Promise<void> {
    const data: Record<string, string> = {
      applicantCode: doc.applicantCode,
      round: String(doc.stageOrder),
    };
    if (includeWhen) data.when = doc.scheduledAt.toISOString();
    await notificationsService
      .notify({
        template,
        to: { userIds: doc.interviewerIds.map(String) },
        data,
        entityRef: entityRef(String(doc._id)),
      })
      .catch(() => undefined);
  }

  /** Schedule an interview round for an applicant, enforcing the workflow entry gate. */
  async schedule(ctx: AuthContext, input: ScheduleInterview, scope: ScopeSelector): Promise<InterviewDoc> {
    const applicant = await applicantService.getById(input.applicantId, scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('only an applicant in the active pipeline can be interviewed');
    }

    const stage = await interviewStageRepository.findActiveById(input.stageId);
    if (stage === null) {
      throw new ValidationError([
        { field: 'stageId', code: 'INVALID', message: 'unknown or inactive interview stage' },
      ]);
    }

    // Entry gate (approved workflow): the earliest stage requires a passed screening; every
    // later stage requires the applicant to have passed the immediately preceding stage.
    const prev = await interviewStageRepository.findPrevActiveBefore(stage.order);
    if (prev === null) {
      const screening = await screeningService.findByApplicantId(input.applicantId);
      if (screening === null || screening.status !== 'accepted') {
        throw new BusinessRuleError('applicant must pass Initial Screening before interviews');
      }
    } else if (!(await interviewRepository.hasPassedStage(input.applicantId, prev.order))) {
      throw new BusinessRuleError(`applicant must pass "${prev.name.en}" before this interview`);
    }

    // One live interview per stage (a cancelled round may be replaced).
    const active = await interviewRepository.findActiveAtStage(input.applicantId, stage.order);
    if (active !== null) {
      throw new ConflictError('this applicant already has an interview at this stage');
    }

    const doc = await interviewRepository.create(
      {
        applicantId: new Types.ObjectId(input.applicantId),
        applicantCode: applicant.code,
        branchId: applicant.branchId,
        stageId: new Types.ObjectId(input.stageId),
        stageOrder: stage.order,
        stageName: stage.name,
        status: 'scheduled',
        outcome: 'pending',
        scheduledAt: input.scheduledAt,
        interviewerIds: toObjectIds(input.interviewerIds),
        location: input.location ?? null,
        notes: input.notes ?? null,
        evaluations: [],
        rescheduleCount: 0,
        decisionNotes: null,
        decidedBy: null,
        decidedAt: null,
        cancelledReason: null,
        cancelledBy: null,
        cancelledAt: null,
      },
      { by: ctx.userId },
    );

    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [{ field: 'stageOrder', old: null, new: stage.order }],
    });
    await emit(HrInterviewEvents.InterviewScheduled, {
      interviewId: String(doc._id),
      applicantId: input.applicantId,
      applicantCode: applicant.code,
      stageOrder: stage.order,
    });
    await this.notifyPanel(doc, HrInterviewTemplates.Scheduled, true);
    return doc;
  }

  async list(query: ListInterviewsQuery, scope: ScopeSelector): Promise<Paginated<InterviewDoc>> {
    return interviewRepository.listInterviews({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListInterviewsQuery): InterviewListFilter {
    return {
      status: query.status,
      outcome: query.outcome,
      applicantId: query.applicantId,
      stageId: query.stageId,
      interviewerId: query.interviewerId,
      branchId: query.branchId,
      scheduledFrom: query.scheduledFrom,
      scheduledTo: query.scheduledTo,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<InterviewDoc> {
    return interviewRepository.getById(id, scope);
  }

  /** Reschedule a scheduled interview (optionally adjusting the panel); notifies the panel. */
  async reschedule(
    ctx: AuthContext,
    id: string,
    input: RescheduleInterview,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    if (before.status !== 'scheduled') {
      throw new BusinessRuleError('only a scheduled interview can be rescheduled');
    }
    const set: Partial<InterviewDoc> = {
      scheduledAt: input.scheduledAt,
      rescheduleCount: before.rescheduleCount + 1,
    };
    if (input.interviewerIds !== undefined) set.interviewerIds = toObjectIds(input.interviewerIds);
    const updated = await interviewRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'scheduledAt', old: before.scheduledAt.toISOString(), new: input.scheduledAt.toISOString() }],
    });
    await emit(HrInterviewEvents.InterviewRescheduled, {
      interviewId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      stageOrder: before.stageOrder,
    });
    await this.notifyPanel(updated, HrInterviewTemplates.Rescheduled, true);
    return updated;
  }

  /** Cancel a scheduled interview; notifies the panel. */
  async cancel(
    ctx: AuthContext,
    id: string,
    input: CancelInterview,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    if (before.status !== 'scheduled') {
      throw new BusinessRuleError('only a scheduled interview can be cancelled');
    }
    const updated = await interviewRepository.updateById(
      id,
      {
        status: 'cancelled',
        cancelledReason: input.reason,
        cancelledBy: new Types.ObjectId(ctx.userId),
        cancelledAt: new Date(),
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: 'cancelled' }],
    });
    await emit(HrInterviewEvents.InterviewCancelled, {
      interviewId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      stageOrder: before.stageOrder,
    });
    await this.notifyPanel(updated, HrInterviewTemplates.Cancelled, false);
    return updated;
  }

  /** Record the caller's own evaluation (an interviewer evaluates at most once per round). */
  async submitEvaluation(
    ctx: AuthContext,
    id: string,
    input: SubmitInterviewEvaluation,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    if (before.status !== 'scheduled') {
      throw new BusinessRuleError('can only evaluate a scheduled interview');
    }
    const onPanel = before.interviewerIds.some((uid) => String(uid) === ctx.userId);
    if (!onPanel) {
      throw new ForbiddenError('only an assigned interviewer may evaluate this round');
    }
    const evaluation: InterviewEvaluation = {
      interviewerId: new Types.ObjectId(ctx.userId),
      recommendation: input.recommendation,
      rating: input.rating ?? null,
      notes: input.notes ?? null,
      submittedAt: new Date(),
    };
    const evaluations = [
      ...before.evaluations.filter((e) => String(e.interviewerId) !== ctx.userId),
      evaluation,
    ];
    const updated = await interviewRepository.updateById(id, { evaluations }, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'evaluations', old: before.evaluations.length, new: evaluations.length }],
    });
    await emit(HrInterviewEvents.InterviewEvaluated, {
      interviewId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      stageOrder: before.stageOrder,
    });
    return updated;
  }

  /**
   * Close a scheduled interview with a pass/fail decision and progress the applicant:
   * `failed` → applicant rejected (terminal); `passed` on the final configured stage clears
   * the interview phase; `passed` on an earlier stage opens the next one (gated on create).
   */
  async decide(
    ctx: AuthContext,
    id: string,
    input: DecideInterview,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    if (before.status !== 'scheduled') {
      throw new BusinessRuleError('interview has already been closed');
    }
    const updated = await interviewRepository.updateById(
      id,
      {
        status: 'completed',
        outcome: input.outcome,
        decisionNotes: input.notes ?? null,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: new Date(),
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'outcome', old: before.outcome, new: input.outcome }],
    });

    if (input.outcome === 'failed') {
      await applicantService.markRejectedByInterview(
        ctx,
        String(before.applicantId),
        { interviewId: id, reason: input.notes ?? 'failed interview round' },
        scope,
      );
    }
    const nextStage = await interviewStageRepository.findNextActiveAfter(before.stageOrder);
    const finalStage = nextStage === null;

    await emit(HrInterviewEvents.InterviewDecided, {
      interviewId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      stageOrder: before.stageOrder,
      outcome: input.outcome,
      finalStage,
    });
    return updated;
  }
}

export const interviewService = new InterviewService();
