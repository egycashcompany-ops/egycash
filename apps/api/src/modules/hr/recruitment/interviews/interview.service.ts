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
  type BulkActionResultDto,
  type BulkInterviews,
  type BulkScheduleInterviews,
  type BulkStartInterviews,
  type ScheduleInterview,
  type SkipInterviewer,
  type StartInterview,
  type StartScheduledInterview,
  type SubmitInterviewEvaluation,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ForbiddenError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { notificationsService } from '../../../../platform/notifications';
import { applicantService } from '../applicants';
import { screeningService } from '../screening';
import { recruitmentWorkflowEngine, runBulk, type StageBinding } from '../workflow';
import { InterviewModel } from './interview.model';
import { interviewRepository, type InterviewListFilter } from './interview.repository';
import { interviewStageRepository } from './interview-stage.repository';
import { type InterviewDoc, type InterviewPanelist } from './interview.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'interview', entityId: id });

/** How the engine addresses this stage (I13) — one round per applicant × stage × attempt. */
const BINDING = {
  object: 'interview',
  model: InterviewModel,
  entityType: 'interview',
  stageField: 'stageId',
} as unknown as StageBinding<never>;

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
    if (includeWhen && doc.scheduledAt !== null) data.when = doc.scheduledAt.toISOString();
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

    await this.assertStageEntry(input.applicantId, stage);

    // One live interview per stage (a cancelled round may be replaced).
    const active = await interviewRepository.findActiveAtStage(input.applicantId, stage.order);
    if (active !== null) {
      throw new ConflictError('this applicant already has an interview at this stage');
    }

    // The record is materialized in `waiting` and then transitioned — both through the engine
    // (I11/I13), so the queue is real rows and the status change publishes its event.
    const { record: waiting } = await recruitmentWorkflowEngine.ensureStageRecord({
      binding: BINDING,
      applicantId: input.applicantId,
      applicantCode: applicant.code,
      applicantName: applicant.fullNameAr,
      branchId: applicant.branchId,
      stageRefId: new Types.ObjectId(input.stageId),
      actorUserId: ctx.userId,
      placement: applicant.placement,
      placementLabel: applicant.placementLabel,
      defaults: {
        stageId: new Types.ObjectId(input.stageId),
        stageKey: stage.key,
        stageOrder: stage.order,
        stageName: stage.name,
        outcome: 'pending',
      },
    } as never) as unknown as { record: InterviewDoc };

    const { record: doc } = await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id: String(waiting._id),
      to: 'scheduled',
      actorUserId: ctx.userId,
      set: {
        scheduledAt: input.scheduledAt,
        panel: [...new Set(input.interviewerIds)].map(newPanelist),
        location: input.location ?? null,
        notes: input.notes ?? null,
      },
      payload: { stageOrder: stage.order },
    } as never) as unknown as { record: InterviewDoc };
    await emit(HrInterviewEvents.InterviewScheduled, {
      interviewId: String(doc._id),
      applicantId: input.applicantId,
      applicantCode: applicant.code,
      stageOrder: stage.order,
    });
    await this.notifyPanel(doc, HrInterviewTemplates.Scheduled, true);
    return doc;
  }

  /**
   * START NOW (RW12/A3). The round is created already `inProgress`: the server assigns the
   * CURRENTLY AUTHENTICATED user as the interviewer and stamps `startedAt` from its own clock —
   * neither is supplied or editable by the client. Works from Screening → first stage and from
   * Interview N → N+1, using the same entry gate as scheduling.
   */
  async start(ctx: AuthContext, input: StartInterview, scope: ScopeSelector): Promise<InterviewDoc> {
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
    await this.assertStageEntry(input.applicantId, stage);

    const { record: waiting } = (await recruitmentWorkflowEngine.ensureStageRecord({
      binding: BINDING,
      applicantId: input.applicantId,
      applicantCode: applicant.code,
      applicantName: applicant.fullNameAr,
      branchId: applicant.branchId,
      stageRefId: new Types.ObjectId(input.stageId),
      actorUserId: ctx.userId,
      placement: applicant.placement,
      placementLabel: applicant.placementLabel,
      defaults: {
        stageId: new Types.ObjectId(input.stageId),
        stageKey: stage.key,
        stageOrder: stage.order,
        stageName: stage.name,
        outcome: 'pending',
      },
    } as never)) as unknown as { record: InterviewDoc };

    const now = new Date();
    const panel = [...new Set([ctx.userId, ...input.interviewerIds])].map(newPanelist);
    const { record: doc } = (await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id: String(waiting._id),
      to: 'inProgress',
      actorUserId: ctx.userId,
      set: {
        scheduledAt: now,
        startedAt: now,
        startedBy: new Types.ObjectId(ctx.userId),
        panel,
        location: input.location ?? null,
        notes: input.notes ?? null,
      },
      payload: { stageOrder: stage.order },
    } as never)) as unknown as { record: InterviewDoc };

    await emit(HrInterviewEvents.InterviewStarted, {
      interviewId: String(doc._id),
      applicantId: input.applicantId,
      applicantCode: applicant.code,
      stageOrder: stage.order,
      startedBy: ctx.userId,
      startedAt: now,
    });
    return doc;
  }

  /** Start a round that was already scheduled: `scheduled → inProgress`, server-stamped. */
  async startScheduled(
    ctx: AuthContext,
    id: string,
    input: StartScheduledInterview,
    scope: ScopeSelector,
  ): Promise<InterviewDoc> {
    const before = await interviewRepository.getById(id, scope);
    const now = new Date();
    const onPanel = before.panel.some((p) => String(p.interviewerId) === ctx.userId);
    const { record: updated } = (await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'inProgress',
      actorUserId: ctx.userId,
      version: input.version,
      set: {
        startedAt: now,
        startedBy: new Types.ObjectId(ctx.userId),
        ...(onPanel ? {} : { panel: [...before.panel, newPanelist(ctx.userId)] }),
      },
      payload: { stageOrder: before.stageOrder },
    } as never)) as unknown as { record: InterviewDoc };

    await emit(HrInterviewEvents.InterviewStarted, {
      interviewId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      stageOrder: before.stageOrder,
      startedBy: ctx.userId,
      startedAt: now,
    });
    return updated;
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
        applicantName: s.applicantName ?? '',
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
      changes: [
        {
          field: 'scheduledAt',
          old: before.scheduledAt === null ? null : before.scheduledAt.toISOString(),
          new: input.scheduledAt.toISOString(),
        },
      ],
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
    if (before.status !== 'scheduled' && before.status !== 'inProgress') {
      throw new BusinessRuleError('only a scheduled or in-progress interview can be cancelled');
    }
    const { record: updated } = await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'cancelled',
      actorUserId: ctx.userId,
      reason: input.reason,
      version: input.version,
      set: {
        cancelledReason: input.reason,
        cancelledBy: new Types.ObjectId(ctx.userId),
        cancelledAt: new Date(),
      },
    } as never) as unknown as { record: InterviewDoc };
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
    if (before.status !== 'scheduled' && before.status !== 'inProgress') {
      throw new BusinessRuleError('can only evaluate an open interview');
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
    if (before.status !== 'scheduled' && before.status !== 'inProgress') {
      throw new BusinessRuleError('can only change evaluators on an open interview');
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
    if (before.status !== 'scheduled' && before.status !== 'inProgress') {
      throw new BusinessRuleError('interview has already been closed');
    }
    if (before.panel.some((p) => p.state === 'pending')) {
      throw new BusinessRuleError('every interviewer must submit or be skipped before deciding');
    }
    const { record: updated } = await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'completed',
      actorUserId: ctx.userId,
      outcome: input.outcome,
      version: input.version,
      set: {
        outcome: input.outcome,
        decisionNotes: input.notes ?? null,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: new Date(),
      },
      payload: { outcome: input.outcome, stageOrder: before.stageOrder },
    } as never) as unknown as { record: InterviewDoc };

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
    const { record: updated } = await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: 'completed',
      actorUserId: ctx.userId,
      outcome: input.outcome,
      reason: input.notes ?? 'decision edited',
      version: input.version,
      set: {
        outcome: input.outcome,
        decisionNotes: input.notes ?? null,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: new Date(),
      },
      payload: { outcome: input.outcome, stageOrder: before.stageOrder },
    } as never) as unknown as { record: InterviewDoc };

    const applicantId = String(before.applicantId);
    if (input.outcome === 'failed') {
      await applicantService.markRejectedByInterview(
        ctx,
        applicantId,
        { interviewId: id, reason: input.notes ?? 'interview decision edited to failed' },
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

  /**
   * Entry gate (approved workflow): the earliest stage requires a passed screening; every later
   * stage requires the applicant to have passed the immediately preceding stage. Shared by
   * scheduling and starting so both paths gate identically.
   */
  private async assertStageEntry(
    applicantId: string,
    stage: { order: number; name: { en: string } },
  ): Promise<void> {
    const prev = await interviewStageRepository.findPrevActiveBefore(stage.order);
    if (prev === null) {
      const screening = await screeningService.findByApplicantId(applicantId);
      if (screening === null || screening.status !== 'accepted') {
        throw new BusinessRuleError('applicant must pass Initial Screening before interviews');
      }
      return;
    }
    if (!(await interviewRepository.hasPassedStage(applicantId, prev.order))) {
      throw new BusinessRuleError(`applicant must pass "${prev.name.en}" before this interview`);
    }
  }

  /** Bulk cancel / decide / reassign-panel (RW17/I4) — per item, partial success. */
  async bulk(
    ctx: AuthContext,
    input: BulkInterviews,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    return runBulk(
      input.ids,
      async (id) => {
        const current = await interviewRepository.getById(id, scope);
        if (input.action === 'cancel') {
          await this.cancel(ctx, id, { reason: input.reason ?? '', version: current.__v }, scope);
          return;
        }
        if (input.action === 'reassignPanel') {
          await this.reassignPanel(
            ctx,
            id,
            { interviewerIds: input.interviewerIds ?? [], version: current.__v },
            scope,
          );
          return;
        }
        await this.decide(
          ctx,
          id,
          {
            outcome: input.action === 'pass' ? 'passed' : 'failed',
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            version: current.__v,
          },
          scope,
        );
      },
      {
        entityType: 'interview',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }

  /** Schedule one date/panel across a selection of waiting applicants (RW17). */
  async bulkSchedule(
    ctx: AuthContext,
    input: BulkScheduleInterviews,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    return runBulk(
      input.applicantIds,
      async (applicantId) => {
        await this.schedule(
          ctx,
          {
            applicantId,
            stageId: input.stageId,
            scheduledAt: input.scheduledAt,
            interviewerIds: input.interviewerIds,
            ...(input.location === undefined ? {} : { location: input.location }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
          },
          scope,
        );
      },
      { entityType: 'interview', action: 'schedule', actorUserId: ctx.userId },
    );
  }

  /** Start rounds immediately for a selection of waiting applicants (RW12/RW17). */
  async bulkStart(
    ctx: AuthContext,
    input: BulkStartInterviews,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    return runBulk(
      input.applicantIds,
      async (applicantId) => {
        await this.start(
          ctx,
          {
            applicantId,
            stageId: input.stageId,
            interviewerIds: [],
            ...(input.location === undefined ? {} : { location: input.location }),
          },
          scope,
        );
      },
      { entityType: 'interview', action: 'start', actorUserId: ctx.userId },
    );
  }

  /**
   * Round counts per status, split by interview stage, over the LIVE attempts — the per-stage
   * numbers the aggregated counters endpoint reports (RW15/I3). One grouped query for all stages.
   */
  async statusCountsByStage(
    branchId: string | undefined,
    scope: ScopeSelector,
  ): Promise<Record<string, Record<string, number>>> {
    return interviewRepository.countByStatusGrouped(
      'stageId',
      {
        supersededAt: null,
        ...(branchId === undefined ? {} : { branchId: new Types.ObjectId(branchId) }),
      },
      scope,
    );
  }

  /**
   * How the workflow engine addresses this stage (I13). Exposed so cross-stage orchestration —
   * a return to an earlier stage — drives this stage through the SAME engine, never by touching
   * the collection directly.
   */
  get workflowBinding(): StageBinding<never> {
    return BINDING;
  }
}

export const interviewService = new InterviewService();
