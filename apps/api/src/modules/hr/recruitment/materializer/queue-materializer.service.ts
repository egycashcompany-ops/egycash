// Queue materialization (I11). Every stage ALWAYS has a record: "waiting" is a persisted status,
// never the absence of a row. This is what keeps every queue, counter and badge a plain indexed
// read over explicit statuses instead of a cross-collection derivation of who *should* be there.
//
// It runs as a reaction, never inline: the workflow engine publishes a fact, and this opens the
// row that fact implies (I15). Nothing here decides anything — the transition already did.
//
//   applicant registered           → screening waiting
//   screening accepted             → first interview stage waiting
//   interview passed               → next interview stage waiting, or every applicable phase
//   evaluation approved            → nothing (phases are independent; the offer is HR's call)
//   applicant moved to Job Offer   → offer waiting
//
// Cross-feature access goes through the stage barrels (ADR-003); this feature owns no data.
import { Types } from 'mongoose';
import { logger } from '../../../../infrastructure/logging/logger';
import { applicantService, type ApplicantDoc } from '../applicants';
import { screeningService } from '../screening';
import { interviewService, interviewStageService } from '../interviews';
import { evaluationService, evaluationPhaseService } from '../evaluations';
import { jobOfferService } from '../job-offers';
import { recruitmentWorkflowEngine } from '../workflow';

const CATALOG_PAGE_SIZE = 100;

/** The applicant fields the engine needs to stamp on a new stage record. */
const subjectOf = (applicant: ApplicantDoc) => ({
  applicantId: String(applicant._id),
  applicantCode: applicant.code,
  applicantName: applicant.fullNameAr,
  branchId: applicant.branchId,
  placement: applicant.placement,
  placementLabel: applicant.placementLabel,
});

class QueueMaterializerService {
  /** The screening queue an applicant joins the moment they are registered. */
  async openScreening(applicantId: string, actorUserId: string | null): Promise<void> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return;
    await recruitmentWorkflowEngine.ensureStageRecord({
      binding: screeningService.workflowBinding,
      ...subjectOf(applicant),
      actorUserId,
    } as never);
  }

  /** The first interview stage opens as soon as screening is accepted. */
  async openFirstInterview(applicantId: string, actorUserId: string | null): Promise<void> {
    const stages = await interviewStageService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const first = stages.items[0];
    if (first === undefined) return;
    await this.openInterviewStage(applicantId, String(first._id), actorUserId);
  }

  /**
   * Passing a round opens the next one; passing the LAST one opens every applicable evaluation
   * phase, since the phases are independent and all become available at once.
   */
  async advanceAfterInterview(
    applicantId: string,
    stageOrder: number,
    actorUserId: string | null,
  ): Promise<void> {
    const stages = await interviewStageService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const next = stages.items.find((s) => s.order > stageOrder);
    if (next !== undefined) {
      await this.openInterviewStage(applicantId, String(next._id), actorUserId);
      return;
    }
    await this.openEvaluationPhases(applicantId, actorUserId);
  }

  /** Every applicable phase opens together — driver-only phases only for driver applicants. */
  async openEvaluationPhases(applicantId: string, actorUserId: string | null): Promise<void> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return;
    const phases = await evaluationPhaseService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const isDriver = applicant.drivingLicenses.length > 0;
    for (const phase of phases.items) {
      if (phase.applicability === 'driversOnly' && !isDriver) continue;
      await recruitmentWorkflowEngine.ensureStageRecord({
        binding: evaluationService.workflowBinding,
        ...subjectOf(applicant),
        stageRefId: phase._id,
        actorUserId,
        defaults: {
          phaseId: phase._id,
          phaseKey: phase.key,
          phaseName: phase.name,
          phaseOrder: phase.order,
          phaseKind: phase.kind,
        },
      } as never);
    }
  }

  /** The offer queue an applicant joins when HR explicitly moves them to the Job Offer stage. */
  async openJobOffer(applicantId: string, actorUserId: string | null): Promise<void> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return;
    await recruitmentWorkflowEngine.ensureStageRecord({
      binding: jobOfferService.workflowBinding,
      ...subjectOf(applicant),
      actorUserId,
    } as never);
  }

  private async openInterviewStage(
    applicantId: string,
    stageId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return;
    const stages = await interviewStageService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const stage = stages.items.find((s) => String(s._id) === stageId);
    if (stage === undefined) return;
    await recruitmentWorkflowEngine.ensureStageRecord({
      binding: interviewService.workflowBinding,
      ...subjectOf(applicant),
      stageRefId: stage._id,
      actorUserId,
      defaults: {
        stageId: stage._id,
        stageKey: stage.key,
        stageOrder: stage.order,
        stageName: stage.name,
        outcome: 'pending',
      },
    } as never);
  }

  /**
   * Materialization is a projection, not part of the transition: a failure must never roll back
   * the decision that triggered it. It is logged and repaired by the next boot's backfill.
   */
  async safely(what: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      logger.error({ err: error, what }, 'recruitment queue materialization failed');
    }
  }
}

export const queueMaterializerService = new QueueMaterializerService();
export const materializerObjectId = (id: string): Types.ObjectId => new Types.ObjectId(id);
