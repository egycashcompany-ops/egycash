// Interview lifecycle (Stage 3). An applicant who passed Initial Screening advances through
// the administrator-configured interview rounds (OQ-31). Each round is scheduled with a
// panel; every panel member carries an individual evaluation state (pending/submitted/
// skipped); a recruiter/manager decides the round pass/fail only once no member is still
// pending. Passing the last configured stage clears the interview phase (the applicant is
// then ready for a Job Offer — Stage 4, not built here); failing any round rejects the
// applicant. Scheduling, rescheduling, and cancelling notify the panel through the platform
// Notifications service (never blocking the business operation).
//
// Cross-feature access to the Applicant and Screening aggregates goes through their barrels
// only (ADR-003); this feature never reaches into their internals.
import { Types } from 'mongoose';
import {
  HrInterviewEvents,
  HrInterviewTemplates,
  type AwaitingInterviewDto,
  type CancelInterview,
  type DecideInterview,
  type ListAwaitingInterviewsQuery,
  type ListInterviewsQuery,
  type Paginated,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type SubmitInterviewEvaluation,
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
import { type InterviewDoc, type InterviewPanelist } from './interview.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'interview', entityId: id });

const newPanelist = (interviewerId: string): InterviewPanelist => ({
  interviewerId: new Types.ObjectId(interviewerId),
  state: 'pending',
  recommendation: null,
  rating: null,
  notes: null,
  submittedAt: null,
});

class InterviewService {
  /** Fire-and-forget panel notification — never blocks or fails the recruitment operation. */
  private async notifyPanel(
    doc: InterviewDoc,
    template: string,
    includeWhen: boolean,
    recipientIds?: string[],
  ): Promise<void> {
    const userIds = recipientIds ?? doc.panel.map((p) => String(p.interviewerId));
    if (userIds.length === 0) return;
    const data: Record<string, string> = {
      applicantCode: doc.applicantCode,
      round: String(doc.stageOrder),
    };
    if (includeWhen) data.when = doc.scheduledAt.toISOString();
    await notificationsService
      .notify({ template, to: { userIds }, data, entityRef: entityRef(String(doc._id)) })
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
        panel: [...new Set(input.interviewerIds)].map(newPanelist),
        location: input.location ?? null,
        notes: input.notes ?? null,
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

  /**
   * "Awaiting scheduling" — applicants who passed Initial Screening and are still live but have
   * no interview yet (the automatic pipeline entry: they appear here the moment Screening is
   * approved). A derived read model (no interview record is fabricated); the recruiter schedules
   * the first round from here. Excludes withdrawn/rejected applicants and any already in a round.
   */
  async listAwaiting(
    query: ListAwaitingInterviewsQuery,
    scope: ScopeSelector,
  ): Promise<AwaitingInterviewDto[]> {
    const accepted = await screeningService.listAcceptedForInterview(query.branchId, query.limit, scope);
    const applicantIds = accepted.map((s) => String(s.applicantId));
    const [liveIds, interviewedIds] = await Promise.all([
      applicantService.liveIdsAmong(applicantIds, scope),
      interviewRepository.applicantIdsWithInterview(applicantIds),
    ]);
    return accepted
      .filter((s) => liveIds.has(String(s.applicantId)) && !interviewedIds.has(String(s.applicantId)))
      .map((s) => ({
        applicantId: String(s.applicantId),
        applicantCode: s.applicantCode,
        branchId: s.branchId === null ? null : String(s.branchId),
        screeningId: String(s._id),
        screeningDecidedAt: s.decidedAt === null ? null : s.decidedAt.toISOString(),
      }));
  }

  async getById(id: string, scope: ScopeSelector): Promise<InterviewDoc> {
    return interviewRepository.getById(id, scope);
  }

  /**
   * All of an applicant's interviews, oldest stage first — read by the Electronic Employee File
   * (Stage 7) to link the interview history and build the Employee Timeline.
   */
  async listByApplicant(applicantId: string): Promise<InterviewDoc[]> {
    return interviewRepository.findByApplicant(applicantId);
  }

  /**
   * Whether the applicant has cleared every configured interview round — i.e. passed the
   * final active stage (progression gating guarantees all prior stages were passed too).
   * Used by the Job Offer stage (Stage 4) to gate offer creation.
   */
  async hasClearedAllInterviews(applicantId: string): Promise<boolean> {
    const last = await interviewStageRepository.findLastActive();
    if (last === null) return false;
    return interviewRepository.hasPassedStage(applicantId, last.order);
  }

  /** Reschedule a scheduled interview (date/time only); notifies the panel. */
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
    const updated = await interviewRepository.updateById(
      id,
      { scheduledAt: input.scheduledAt, rescheduleCount: before.rescheduleCount + 1 },
      { by: ctx.userId, version: input.version, scope },
    );
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

  /**
   * Replace the panel WITHOUT changing the schedule. Retained members keep their evaluation
   * state; newly added members start `pending`; removed members drop off. Newly added
   * members are notified (as for a fresh scheduling).
   */
  async reassignPanel(
    ctx: AuthContext,
    id: string,
    input: ReassignInterviewPanel,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    if (before.status !== 'scheduled') {
      throw new BusinessRuleError('only the panel of a scheduled interview can be changed');
    }
    const byId = new Map(before.panel.map((p) => [String(p.interviewerId), p]));
    const requested = [...new Set(input.interviewerIds)];
    const panel = requested.map((uid) => byId.get(uid) ?? newPanelist(uid));
    const added = requested.filter((uid) => !byId.has(uid));

    const updated = await interviewRepository.updateById(id, { panel }, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'panel', old: before.panel.length, new: panel.length }],
    });
    if (added.length > 0) await this.notifyPanel(updated, HrInterviewTemplates.Scheduled, true, added);
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
    if (!before.panel.some((p) => String(p.interviewerId) === ctx.userId)) {
      throw new ForbiddenError('only an assigned interviewer may evaluate this round');
    }
    const now = new Date();
    const panel = before.panel.map((p) =>
      String(p.interviewerId) === ctx.userId
        ? {
            ...p,
            state: 'submitted' as const,
            recommendation: input.recommendation,
            rating: input.rating ?? null,
            notes: input.notes ?? null,
            submittedAt: now,
          }
        : p,
    );
    const updated = await interviewRepository.updateById(id, { panel }, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'evaluation', old: null, new: `${ctx.userId}:submitted` }],
    });
    await emit(HrInterviewEvents.InterviewEvaluated, {
      interviewId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      stageOrder: before.stageOrder,
    });
    return updated;
  }

  /** Mark an assigned interviewer skipped/absent so their evaluation no longer blocks a decision. */
  async skipInterviewer(
    ctx: AuthContext,
    id: string,
    input: SkipInterviewer,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    if (before.status !== 'scheduled') {
      throw new BusinessRuleError('can only change evaluators on a scheduled interview');
    }
    const target = before.panel.find((p) => String(p.interviewerId) === input.interviewerId);
    if (target === undefined) {
      throw new ValidationError([
        { field: 'interviewerId', code: 'INVALID', message: 'not an assigned interviewer for this round' },
      ]);
    }
    if (target.state === 'submitted') {
      throw new BusinessRuleError('this interviewer has already submitted an evaluation');
    }
    const panel = before.panel.map((p) =>
      String(p.interviewerId) === input.interviewerId ? { ...p, state: 'skipped' as const } : p,
    );
    const updated = await interviewRepository.updateById(id, { panel }, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'evaluation', old: `${input.interviewerId}:${target.state}`, new: `${input.interviewerId}:skipped` }],
    });
    return updated;
  }

  /**
   * Close a scheduled interview with a pass/fail decision and progress the applicant. Blocked
   * until every panel member is `submitted` or `skipped` (no one still `pending`). `failed`
   * → applicant rejected (terminal); `passed` on the final configured stage clears the
   * interview phase; `passed` on an earlier stage opens the next one (gated on create).
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
    if (before.panel.some((p) => p.state === 'pending')) {
      throw new BusinessRuleError('every interviewer must submit or be skipped before deciding');
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

  /**
   * Edit the outcome of an already-COMPLETED interview round (D7: "a decision is not final"); fully
   * audited. Flipping to `failed` rejects the applicant (removes them from the pipeline); flipping a
   * `failed` round back to `passed` reactivates the applicant (rejected → new) so they re-enter the
   * pipeline at this stage and can advance.
   */
  async redecide(
    ctx: AuthContext,
    id: string,
    input: DecideInterview,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    if (before.status !== 'completed') {
      throw new BusinessRuleError('only a completed interview decision can be edited');
    }
    if (before.outcome === input.outcome) {
      throw new BusinessRuleError('the interview already has this outcome');
    }
    const updated = await interviewRepository.updateById(
      id,
      {
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
      changes: [
        { field: 'outcome', old: before.outcome, new: input.outcome },
        { field: 'decisionEdited', old: null, new: input.notes ?? 'decision edited' },
      ],
    });

    const applicantId = String(before.applicantId);
    if (input.outcome === 'failed') {
      await applicantService.markRejectedByInterview(
        ctx,
        applicantId,
        { interviewId: id, reason: input.notes ?? 'interview decision edited to failed' },
        scope,
      );
    } else {
      await applicantService.reactivateFromRejection(
        ctx,
        applicantId,
        { reason: input.notes ?? 'interview decision edited to passed' },
        scope,
      );
    }

    const nextStage = await interviewStageRepository.findNextActiveAfter(before.stageOrder);
    await emit(HrInterviewEvents.InterviewDecided, {
      interviewId: id,
      applicantId,
      applicantCode: before.applicantCode,
      stageOrder: before.stageOrder,
      outcome: input.outcome,
      finalStage: nextStage === null,
    });
    return updated;
  }
}

export const interviewService = new InterviewService();
