// Return a candidate to an earlier stage (RW13/A8). The one rule that shapes everything here:
// HISTORY IS NEVER REWRITTEN. No record is deleted, no decision edited, no file detached. Forward
// records get a supersede marker — the only write they will ever receive — and a fresh attempt
// opens at the target stage, so the existing gates (which read the latest non-superseded attempt)
// simply resume from there.
//
// Every write goes through the workflow engine via each stage's own binding (I13); this feature
// owns no collection and touches no model. Cross-feature reads go through the stage barrels
// (ADR-003).
import { type Types } from 'mongoose';
import {
  type ReturnToStage,
  type ReturnToStagePreviewDto,
  type StageRef,
  type StageRefDto,
} from '@ecms/contracts';
import { BusinessRuleError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { unitOfWork } from '../../../../platform/kernel/unit-of-work';
import { employeeRepository } from '../../employee-management/employees';
import { applicantService, type ApplicantDoc } from '../applicants';
import { screeningService } from '../screening';
import { interviewService, interviewStageService } from '../interviews';
import { evaluationService, evaluationPhaseService } from '../evaluations';
import { jobOfferService } from '../job-offers';
import { newCorrelationId, recruitmentTimelineService } from '../timeline';
import { recruitmentWorkflowEngine, type StageBinding } from '../workflow';

/**
 * Stage rank — the single ordering that decides what is "forward of" the target. Interview stages
 * and evaluation phases rank inside their own band by their catalog `order`, so adding a stage or
 * reordering phases needs no change here.
 */
const BAND = { screening: 1000, interview: 2000, evaluation: 3000, jobOffer: 4000 } as const;

const CATALOG_PAGE_SIZE = 100;

/** Live statuses that must be CLOSED by a real transition before the record is superseded. */
const CLOSE_FIRST: Record<string, { statuses: string[]; to: string }> = {
  interview: { statuses: ['scheduled', 'inProgress'], to: 'cancelled' },
  offer: { statuses: ['waiting', 'draft', 'sent', 'accepted'], to: 'superseded' },
};

type StageKind = 'screening' | 'interview' | 'evaluation' | 'offer';

interface StageRecordRef {
  kind: StageKind;
  id: string;
  label: string;
  status: string;
  version: number;
}

export interface ReturnTarget {
  ref: StageRef;
  rank: number;
  dto: StageRefDto;
  /** Fields only the target's own catalog knows, written when the new attempt is created. */
  defaults: Record<string, unknown>;
  stageRefId: Types.ObjectId | null;
  binding: StageBinding<never>;
}

export interface ReturnPlan {
  applicant: ApplicantDoc;
  target: ReturnTarget;
  /** Forward records that will be superseded — never deleted, never edited. */
  supersedes: StageRecordRef[];
  /** The subset that must first be closed by a transition (a round cancelled, an offer superseded). */
  closes: StageRecordRef[];
  newAttempt: number;
}

const bindingFor = (kind: StageKind): StageBinding<never> => {
  if (kind === 'screening') return screeningService.workflowBinding;
  if (kind === 'interview') return interviewService.workflowBinding;
  if (kind === 'evaluation') return evaluationService.workflowBinding;
  return jobOfferService.workflowBinding;
};

class ReturnToStageService {
  /** What a return WOULD do, so the UI can show the consequences before the act (RW13). */
  async preview(
    applicantId: string,
    ref: StageRef,
    scope: ScopeSelector,
  ): Promise<ReturnToStagePreviewDto> {
    const plan = await this.plan(applicantId, ref, scope);
    return {
      target: plan.target.dto,
      supersedes: plan.supersedes.map((s) => ({
        entityType: s.kind,
        entityId: s.id,
        label: s.label,
        status: s.status,
      })),
      cancels: plan.closes.map((c) => ({ entityType: c.kind, entityId: c.id, label: c.label })),
      newAttempt: plan.newAttempt,
    };
  }

  /**
   * Perform the return. The live forward records are closed by real transitions (so each one
   * publishes its own event), then every forward record is superseded and the target's next
   * attempt opens — all in one transaction, so a return is all-or-nothing.
   */
  async execute(
    ctx: AuthContext,
    applicantId: string,
    input: ReturnToStage,
    scope: ScopeSelector,
  ): Promise<ReturnPlan> {
    const plan = await this.plan(applicantId, input.target, scope);
    if (plan.applicant.__v !== input.version) {
      throw new BusinessRuleError('the applicant changed since it was read');
    }
    const returnId = newCorrelationId();

    await unitOfWork(async (session) => {
      for (const record of plan.closes) {
        await recruitmentWorkflowEngine.transitionIn(
          {
            binding: bindingFor(record.kind),
            id: record.id,
            to: CLOSE_FIRST[record.kind]?.to as never,
            actorUserId: ctx.userId,
            reason: input.reason,
            correlationId: returnId,
            payload: { returnId },
          },
          session,
        );
      }

      for (const record of plan.supersedes) {
        await recruitmentWorkflowEngine.supersede(
          bindingFor(record.kind),
          record.id,
          returnId,
          ctx.userId,
          session,
        );
      }

      // The return itself is history, written INSIDE the transaction (I5): it commits with the
      // supersede markers or not at all, so the timeline can never show a return that did not
      // happen — or miss one that did.
      await recruitmentTimelineService.record(
        {
          applicantId,
          applicantCode: plan.applicant.code,
          type: 'returnedToStage',
          correlation: { type: 'applicant', id: returnId },
          actorUserId: ctx.userId,
          reason: input.reason,
          branchId: plan.applicant.branchId,
          discriminator: returnId,
          metadata: {
            returnId,
            targetKey: plan.target.dto.key,
            newAttempt: plan.newAttempt,
            superseded: plan.supersedes.map((s) => `${s.kind}:${s.id}`),
          },
        },
        session,
      );

      // The target re-opens on the next attempt, carrying the applicant's CURRENT placement.
      await recruitmentWorkflowEngine.ensureStageRecord(
        {
          binding: plan.target.binding,
          applicantId,
          applicantCode: plan.applicant.code,
          applicantName: plan.applicant.fullNameAr,
          branchId: plan.applicant.branchId,
          stageRefId: plan.target.stageRefId,
          attempt: plan.newAttempt,
          actorUserId: ctx.userId,
          placement: plan.applicant.placement,
          placementLabel: plan.applicant.placementLabel,
          defaults: plan.target.defaults as never,
        },
        session,
      );
    });

    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'applicant', entityId: applicantId },
      action: 'update',
      changes: [
        { field: 'returnedToStage', old: null, new: plan.target.dto.key },
        { field: 'reason', old: null, new: input.reason },
        { field: 'superseded', old: null, new: plan.supersedes.length },
      ],
    });

    return plan;
  }

  /**
   * Resolve the target, verify the return is allowed, and collect exactly what it will touch.
   * Shared by `preview` and `execute`, so the confirmation the user saw is the act performed.
   */
  private async plan(applicantId: string, ref: StageRef, scope: ScopeSelector): Promise<ReturnPlan> {
    const applicant = await applicantService.getById(applicantId, scope);
    if (applicant.status === 'withdrawn') {
      throw new BusinessRuleError('a withdrawn applicant must be restored before returning a stage');
    }
    // Post-hire corrections belong to the Employee module's personnel actions, not here.
    const employee = await employeeRepository.findByApplicantIdSystem(applicantId);
    if (employee !== null) {
      throw new BusinessRuleError('this applicant has been hired — use a personnel action instead');
    }

    const target = await this.resolveTarget(ref);
    const [screening, interviews, evaluations, offers] = await Promise.all([
      screeningService.findByApplicantId(applicantId),
      interviewService.listByApplicant(applicantId),
      evaluationService.listByApplicant(applicantId),
      jobOfferService.listByApplicant(applicantId),
    ]);

    const supersedes: StageRecordRef[] = [];
    const closes: StageRecordRef[] = [];
    let furthest = 0;
    let targetAttempts = 0;

    const consider = (
      record: StageRecordRef,
      rank: number,
      attempt: number,
      superseded: boolean,
    ): void => {
      if (superseded) return;
      furthest = Math.max(furthest, rank);
      if (rank === target.rank) targetAttempts = Math.max(targetAttempts, attempt);
      if (rank <= target.rank) return;
      supersedes.push(record);
      if (CLOSE_FIRST[record.kind]?.statuses.includes(record.status) === true) closes.push(record);
    };

    if (screening !== null) {
      consider(
        {
          kind: 'screening',
          id: String(screening._id),
          label: 'Initial Screening',
          status: screening.status,
          version: screening.__v,
        },
        BAND.screening,
        screening.attempt,
        screening.supersededAt !== null,
      );
    }
    for (const interview of interviews) {
      consider(
        {
          kind: 'interview',
          id: String(interview._id),
          label: interview.stageName.en,
          status: interview.status,
          version: interview.__v,
        },
        BAND.interview + interview.stageOrder,
        interview.attempt,
        interview.supersededAt !== null,
      );
    }
    for (const evaluation of evaluations) {
      consider(
        {
          kind: 'evaluation',
          id: String(evaluation._id),
          label: evaluation.phaseName.en,
          status: evaluation.status,
          version: evaluation.__v,
        },
        BAND.evaluation + evaluation.phaseOrder,
        evaluation.attempt,
        evaluation.supersededAt !== null,
      );
    }
    for (const offer of offers) {
      consider(
        {
          kind: 'offer',
          id: String(offer._id),
          label: offer.code ?? 'Job Offer',
          status: offer.status,
          version: offer.__v,
        },
        BAND.jobOffer,
        offer.attempt,
        offer.supersededAt !== null,
      );
    }

    if (furthest <= target.rank) {
      throw new BusinessRuleError('the target stage is not behind the applicant’s current position');
    }

    return { applicant, target, supersedes, closes, newAttempt: targetAttempts + 1 };
  }

  /** Turn the requested `{ kind, refId }` into a rank, a display ref and the new attempt's fields. */
  private async resolveTarget(ref: StageRef): Promise<ReturnTarget> {
    if (ref.kind === 'screening') {
      return {
        ref,
        rank: BAND.screening,
        dto: { kind: 'screening', refId: null, key: 'screening', name: null },
        defaults: {},
        stageRefId: null,
        binding: screeningService.workflowBinding,
      };
    }
    if (ref.kind === 'jobOffer') {
      return {
        ref,
        rank: BAND.jobOffer,
        dto: { kind: 'jobOffer', refId: null, key: 'jobOffers', name: null },
        defaults: {},
        stageRefId: null,
        binding: jobOfferService.workflowBinding,
      };
    }
    if (ref.refId === null) {
      throw new ValidationError([
        { field: 'target.refId', code: 'REQUIRED', message: 'this stage kind needs a specific stage' },
      ]);
    }
    if (ref.kind === 'interview') {
      const stages = await interviewStageService.list({
        page: 1,
        pageSize: CATALOG_PAGE_SIZE,
        sortDir: 'asc',
        active: true,
      });
      const stage = stages.items.find((s) => String(s._id) === ref.refId);
      if (stage === undefined) {
        throw new ValidationError([
          { field: 'target.refId', code: 'INVALID', message: 'unknown or inactive interview stage' },
        ]);
      }
      return {
        ref,
        rank: BAND.interview + stage.order,
        dto: {
          kind: 'interview',
          refId: String(stage._id),
          key: `interview:${String(stage._id)}`,
          name: stage.name,
        },
        defaults: {
          stageId: stage._id,
          stageKey: stage.key,
          stageOrder: stage.order,
          stageName: stage.name,
          outcome: 'pending',
        },
        stageRefId: stage._id,
        binding: interviewService.workflowBinding,
      };
    }
    const phases = await evaluationPhaseService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const phase = phases.items.find((p) => String(p._id) === ref.refId);
    if (phase === undefined) {
      throw new ValidationError([
        { field: 'target.refId', code: 'INVALID', message: 'unknown or inactive evaluation phase' },
      ]);
    }
    return {
      ref,
      rank: BAND.evaluation + phase.order,
      dto: {
        kind: 'evaluation',
        refId: String(phase._id),
        key: `evaluation:${String(phase._id)}`,
        name: phase.name,
      },
      defaults: {
        phaseId: phase._id,
        phaseKey: phase.key,
        phaseOrder: phase.order,
        phaseName: phase.name,
        phaseKind: phase.kind,
      },
      stageRefId: phase._id,
      binding: evaluationService.workflowBinding,
    };
  }
}

export const returnToStageService = new ReturnToStageService();
