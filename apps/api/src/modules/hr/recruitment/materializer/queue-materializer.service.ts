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

/** What one boot backfill did, so an operator can see whether anything was actually missing. */
export interface StageBacklogReport {
  /** Live applicants walked. */
  scanned: number;
  /** Applicants that were missing at least one `waiting` row and now have it. */
  repaired: number;
  /** Applicants whose repair threw — logged, never fatal: a backfill must not fail a boot. */
  failed: number;
}

/**
 * Materialization OPENS a stage the candidate has no live record at — it never re-opens one they
 * already left. Re-opening after a return is the return's job, which supplies the attempt
 * explicitly; without this guard a replayed event would keep minting attempts, because a terminal
 * record is exactly what `ensureStageRecord` re-opens.
 */
const hasLiveRecord = async (
  model: { findOne: (filter: Record<string, unknown>) => { lean: () => { exec: () => Promise<unknown> } } },
  applicantId: string,
  stageField?: 'stageId' | 'phaseId',
  stageRefId?: Types.ObjectId,
): Promise<boolean> => {
  const filter: Record<string, unknown> = {
    applicantId: new Types.ObjectId(applicantId),
    supersededAt: null,
    isDeleted: false,
  };
  if (stageField !== undefined && stageRefId !== undefined) filter[stageField] = stageRefId;
  return (await model.findOne(filter).lean().exec()) !== null;
};

/** The applicant fields the engine needs to stamp on a new stage record. */
const subjectOf = (applicant: ApplicantDoc) => ({
  applicantId: String(applicant._id),
  applicantCode: applicant.code,
  applicantName: applicant.fullNameAr,
  branchId: applicant.branchId,
  placement: applicant.placement,
  placementLabel: applicant.placementLabel,
});

/** The shape `reopenAfterReactivation` reads back off a closed row. */
type ClosedRow = Record<string, unknown> & { _id: Types.ObjectId };
interface ClosedRecordModel {
  find: (filter: Record<string, unknown>) => { lean: () => { exec: () => Promise<ClosedRow[]> } };
}

/**
 * Per stage: the status its records land in when the candidate leaves (mirroring the engine's
 * `LIFECYCLE_CLOSE`), and how to rebuild the catalog fields a fresh attempt needs — copied off the
 * closed row, so no catalog lookup can disagree with the round the candidate actually stood at.
 */
const REOPENABLE: {
  binding: () => never;
  closedAs: string;
  stageField?: 'stageId' | 'phaseId';
  defaults: (row: ClosedRow) => Record<string, unknown>;
}[] = [
  {
    binding: () => screeningService.workflowBinding as never,
    closedAs: 'cancelled',
    defaults: () => ({}),
  },
  {
    binding: () => interviewService.workflowBinding as never,
    closedAs: 'cancelled',
    stageField: 'stageId',
    defaults: (row) => ({
      stageId: row.stageId,
      stageKey: row.stageKey,
      stageOrder: row.stageOrder,
      stageName: row.stageName,
      outcome: 'pending',
    }),
  },
  {
    binding: () => evaluationService.workflowBinding as never,
    closedAs: 'cancelled',
    stageField: 'phaseId',
    defaults: (row) => ({
      phaseId: row.phaseId,
      phaseKey: row.phaseKey,
      phaseName: row.phaseName,
      phaseOrder: row.phaseOrder,
      phaseKind: row.phaseKind,
    }),
  },
  {
    binding: () => jobOfferService.workflowBinding as never,
    closedAs: 'withdrawn',
    defaults: () => ({}),
  },
];

class QueueMaterializerService {
  /**
   * The screening queue an applicant joins the moment they are registered.
   *
   * Every `open*` method answers whether it actually opened a row, so the boot backfill below can
   * report what it repaired. A `false` is the ordinary answer on the live path: the row is
   * already there.
   */
  async openScreening(applicantId: string, actorUserId: string | null): Promise<boolean> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return false;
    const binding = screeningService.workflowBinding as unknown as { model: never };
    if (await hasLiveRecord(binding.model, applicantId)) return false;
    const { created } = await recruitmentWorkflowEngine.ensureStageRecord({
      binding: screeningService.workflowBinding,
      ...subjectOf(applicant),
      actorUserId,
    } as never);
    return created;
  }

  /** The first interview stage opens as soon as screening is accepted. */
  async openFirstInterview(applicantId: string, actorUserId: string | null): Promise<boolean> {
    const stages = await interviewStageService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const first = stages.items[0];
    if (first === undefined) return false;
    return this.openInterviewStage(applicantId, String(first._id), actorUserId);
  }

  /**
   * Passing a round opens the next one; passing the LAST one opens every applicable evaluation
   * phase, since the phases are independent and all become available at once.
   */
  async advanceAfterInterview(
    applicantId: string,
    stageOrder: number,
    actorUserId: string | null,
  ): Promise<boolean> {
    const stages = await interviewStageService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const next = stages.items.find((s) => s.order > stageOrder);
    if (next !== undefined) {
      return this.openInterviewStage(applicantId, String(next._id), actorUserId);
    }
    return this.openEvaluationPhases(applicantId, actorUserId);
  }

  /** Every applicable phase opens together — driver-only phases only for driver applicants. */
  async openEvaluationPhases(applicantId: string, actorUserId: string | null): Promise<boolean> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return false;
    const phases = await evaluationPhaseService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const isDriver = applicant.drivingLicenses.length > 0;
    const binding = evaluationService.workflowBinding as unknown as { model: never };
    let opened = false;
    for (const phase of phases.items) {
      if (phase.applicability === 'driversOnly' && !isDriver) continue;
      if (await hasLiveRecord(binding.model, applicantId, 'phaseId', phase._id)) continue;
      const { created } = await recruitmentWorkflowEngine.ensureStageRecord({
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
      opened = opened || created;
    }
    return opened;
  }

  /**
   * Reactivation (I14): the candidate is back, so the stages their departure CLOSED re-open — each
   * on a fresh attempt, because the closed row is terminal and history is never revived (I11/I12).
   *
   * Which stages? Exactly the ones carrying a lifecycle-closure status on their latest live
   * attempt. That is inferable from the records themselves, which is the point: the departure left
   * its trace in the status vocabulary rather than in a flag, so the return can read it back out
   * without any mirrored lifecycle state existing anywhere (I1/I10).
   *
   * The new attempt is stamped with the candidate's CURRENT placement, like any materialization.
   */
  async reopenAfterReactivation(applicantId: string, actorUserId: string | null): Promise<boolean> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return false;

    let opened = false;
    for (const stage of REOPENABLE) {
      const binding = stage.binding() as unknown as { model: ClosedRecordModel };
      const closed = await binding.model
        .find({
          applicantId: new Types.ObjectId(applicantId),
          supersededAt: null,
          isDeleted: false,
          status: stage.closedAs,
        })
        .lean()
        .exec();
      for (const record of closed) {
        const refId = stage.stageField === undefined ? undefined : record[stage.stageField];
        const { created } = await recruitmentWorkflowEngine.ensureStageRecord({
          binding: stage.binding(),
          ...subjectOf(applicant),
          ...(refId === undefined ? {} : { stageRefId: refId }),
          actorUserId,
          defaults: stage.defaults(record),
        } as never);
        opened = opened || created;
      }
    }
    return opened;
  }

  /** The offer queue an applicant joins when HR explicitly moves them to the Job Offer stage. */
  async openJobOffer(applicantId: string, actorUserId: string | null): Promise<boolean> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return false;
    const binding = jobOfferService.workflowBinding as unknown as { model: never };
    if (await hasLiveRecord(binding.model, applicantId)) return false;
    const { created } = await recruitmentWorkflowEngine.ensureStageRecord({
      binding: jobOfferService.workflowBinding,
      ...subjectOf(applicant),
      actorUserId,
    } as never);
    return created;
  }

  private async openInterviewStage(
    applicantId: string,
    stageId: string,
    actorUserId: string | null,
  ): Promise<boolean> {
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant === null || applicant.status !== 'new') return false;
    const stages = await interviewStageService.list({
      page: 1,
      pageSize: CATALOG_PAGE_SIZE,
      sortDir: 'asc',
      active: true,
    });
    const stage = stages.items.find((s) => String(s._id) === stageId);
    if (stage === undefined) return false;
    const binding = interviewService.workflowBinding as unknown as { model: never };
    if (await hasLiveRecord(binding.model, applicantId, 'stageId', stage._id)) return false;
    const { created } = await recruitmentWorkflowEngine.ensureStageRecord({
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
    return created;
  }

  /**
   * Materialization is a projection, not part of the transition: a failure must never roll back
   * the decision that triggered it. It is logged and repaired by the next boot's backfill.
   */
  async safely(what: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      logger.error({ err: error, what }, 'recruitment queue materialization failed');
    }
  }

  /**
   * I8/I11 — the boot backfill, and the repair `safely()` above promises.
   *
   * Materialization runs as a REACTION to a published fact, which leaves two ways for a live
   * applicant to stand at a stage with no row to stand on: they moved through the pipeline before
   * I11 existed (every pre-refactor applicant), or their materialization threw and was swallowed
   * so the decision that triggered it would still commit. Either way the queue silently loses
   * them, because a queue is now a plain read over explicit rows and no longer derives who
   * *should* appear.
   *
   * The stage is resolved from the candidate's own records — never from a stored cursor (I1) — and
   * every row is opened through the same `open*` methods the live path uses, each of which returns
   * early when the row is already there. Re-running therefore writes nothing, which is what makes
   * it safe on every boot.
   */
  async backfillWaitingBacklog(batchSize = 500): Promise<StageBacklogReport> {
    const report: StageBacklogReport = { scanned: 0, repaired: 0, failed: 0 };

    await applicantService.eachLiveIdSystem(batchSize, async (applicantId) => {
      report.scanned += 1;
      try {
        if (await this.repairOne(applicantId)) report.repaired += 1;
      } catch (error) {
        report.failed += 1;
        logger.error({ err: error, applicantId }, 'recruitment queue backfill failed for applicant');
      }
    });

    if (report.repaired > 0 || report.failed > 0) {
      logger.info({ ...report }, 'recruitment queue backfill opened missing waiting rows');
    }
    return report;
  }

  /** Walk one candidate's ladder as far as their own records reach, opening whatever is missing. */
  private async repairOne(applicantId: string): Promise<boolean> {
    let opened = await this.openScreening(applicantId, null);

    const screening = await screeningService.findByApplicantId(applicantId);
    if (screening === null || screening.status !== 'accepted') return opened;
    opened = (await this.openFirstInterview(applicantId, null)) || opened;

    // The furthest round they PASSED is the position their records prove; anything earlier
    // already has a row, and anything later is not theirs to stand at yet.
    const interviews = await interviewService.listByApplicant(applicantId);
    const passed = interviews.filter(
      (i) => i.supersededAt === null && i.status === 'completed' && i.outcome === 'passed',
    );
    if (passed.length > 0) {
      const furthest = Math.max(...passed.map((i) => i.stageOrder));
      opened = (await this.advanceAfterInterview(applicantId, furthest, null)) || opened;
    }

    // The offer is never opened by progress alone — it is HR's explicit move (I11), and
    // `movedToOfferAt` is the record of that decision having been taken.
    const applicant = await applicantService.findByIdSystem(applicantId);
    if (applicant !== null && applicant.movedToOfferAt !== null) {
      opened = (await this.openJobOffer(applicantId, null)) || opened;
    }
    return opened;
  }
}

export const queueMaterializerService = new QueueMaterializerService();
