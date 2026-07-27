// Evaluation lifecycle — the post-interview, file-based approval checks. For each applicant × phase
// the recruiter opens a record, attaches one or more files (bytes in the platform Files service),
// and records an approve/reject decision with a reason. The decision is EDITABLE (re-deciding
// updates the same record). A `rejected` decision removes the applicant from the active pipeline
// (mirrors a failed interview round via the Applicants barrel, ADR-003).
import { Types } from 'mongoose';
import {
  HrEvaluationEvents,
  type DecideEvaluation,
  type ListEvaluationsQuery,
  type BulkActionResultDto,
  type BulkEvaluations,
  type OpenEvaluation,
  type SetEvaluationAppointment,
  type Paginated,
  type UploadEvaluationFile,
  type SetPlacementRecommendation,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { applicantService, resolvePlacement } from '../applicants';
import { interviewService } from '../interviews';
import { recruitmentTimelineService } from '../timeline';
import { recruitmentWorkflowEngine, registerStageBinding, runBulk, type StageBinding } from '../workflow';
import { EvaluationModel } from './evaluation.model';
import { evaluationRepository, type EvaluationListFilter } from './evaluation.repository';
import { evaluationPhaseRepository } from './evaluation-phase.repository';
import { resolveEvaluationCategoryId } from './evaluation.files';
import { type EvaluationDoc, type EvaluationDecisionEvent, type EvaluationFile } from './evaluation.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'evaluation', entityId: id });

/** How the engine addresses this stage (I13) — one record per applicant × phase × attempt. */
const BINDING = {
  object: 'evaluation',
  model: EvaluationModel,
  entityType: 'evaluation',
  stageField: 'phaseId',
} as unknown as StageBinding<never>;

// So the engine can close this collection's still-open records when the candidate leaves the
// pipeline (I14) — the stage never reaches into the lifecycle, only the engine does.
registerStageBinding(BINDING);

class EvaluationService {
  /**
   * Open (start) an evaluation for an applicant at a phase. Idempotent per (applicant, phase):
   * an existing record is returned as-is. Only a live (`new`) applicant and an active phase qualify.
   */
  async open(ctx: AuthContext, input: OpenEvaluation, scope: ScopeSelector): Promise<EvaluationDoc> {
    const existing = await evaluationRepository.findByApplicantAndPhase(input.applicantId, input.phaseId);
    if (existing !== null) return existing;

    const applicant = await applicantService.getById(input.applicantId, scope);
    if (applicant.status !== 'new') {
      throw new BusinessRuleError('only an applicant in the active pipeline can be evaluated');
    }
    const phase = await evaluationPhaseRepository.findActiveById(input.phaseId);
    if (phase === null) {
      throw new ValidationError([
        { field: 'phaseId', code: 'INVALID', message: 'unknown or inactive evaluation phase' },
      ]);
    }

    // Phases are INDEPENDENT (RW6): the only entry gate is that the applicant cleared every
    // interview round — evaluations are post-interview checks that may then run in any order.
    if (!(await interviewService.hasClearedAllInterviews(input.applicantId))) {
      throw new BusinessRuleError('applicant must clear all interviews before the evaluation phases');
    }

    try {
      const doc = await evaluationRepository.create(
        {
          applicantId: new Types.ObjectId(input.applicantId),
          applicantCode: applicant.code,
          applicantName: applicant.fullNameAr,
          branchId: applicant.branchId,
          phaseId: phase._id,
          phaseKey: phase.key,
          phaseName: phase.name,
          phaseOrder: phase.order,
          status: 'waiting',
          reason: null,
          files: [],
          decidedBy: null,
          decidedAt: null,
          decisionHistory: [],
        },
        { by: ctx.userId },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: [{ field: 'phaseKey', old: null, new: phase.key }],
      });
      return doc;
    } catch (error) {
      // The unique (applicant, phase) index is the race-safe backstop for concurrent opens.
      if (error instanceof Error && error.message.includes('E11000')) {
        const again = await evaluationRepository.findByApplicantAndPhase(input.applicantId, input.phaseId);
        if (again !== null) return again;
        throw new ConflictError('an evaluation for this phase already exists');
      }
      throw error;
    }
  }

  async list(query: ListEvaluationsQuery, scope: ScopeSelector): Promise<Paginated<EvaluationDoc>> {
    return evaluationRepository.listEvaluations({
      filter: this.toFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  private toFilter(query: ListEvaluationsQuery): EvaluationListFilter {
    return {
      applicantId: query.applicantId,
      phaseId: query.phaseId,
      status: query.status,
      branchId: query.branchId,
    };
  }

  async getById(id: string, scope: ScopeSelector): Promise<EvaluationDoc> {
    return evaluationRepository.getById(id, scope);
  }

  /** All of an applicant's evaluations, oldest phase first (read by pipeline/timeline views). */
  async listByApplicant(applicantId: string): Promise<EvaluationDoc[]> {
    return evaluationRepository.findByApplicant(applicantId);
  }

  /** Attach an uploaded file to an evaluation (one phase may collect many). */
  async uploadFile(
    ctx: AuthContext,
    id: string,
    meta: UploadEvaluationFile,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<EvaluationDoc> {
    const before = await evaluationRepository.getById(id, scope);
    const categoryId = await resolveEvaluationCategoryId();
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: 'evaluation',
        entityId: id,
        categoryId,
        displayName: before.phaseName.en,
        visibility: 'private',
        tags: [],
        ...(meta.note === undefined ? {} : { description: meta.note }),
      },
      binary,
    );
    const item: EvaluationFile = {
      fileId: file._id,
      fileName: file.originalName,
      note: meta.note ?? null,
      uploadedBy: new Types.ObjectId(ctx.userId),
      uploadedAt: new Date(),
    };
    const updated = await evaluationRepository.updateById(
      id,
      { files: [...before.files, item] },
      { by: ctx.userId, version: meta.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'file', old: null, new: file.originalName }],
    });
    return updated;
  }

  /** Detach a file from an evaluation (soft-deletes the underlying file version). */
  async removeFile(
    ctx: AuthContext,
    id: string,
    fileId: string,
    version: number,
    scope: ScopeSelector,
  ): Promise<EvaluationDoc> {
    const before = await evaluationRepository.getById(id, scope);
    if (!before.files.some((f) => String(f.fileId) === fileId)) {
      throw new ValidationError([{ field: 'fileId', code: 'INVALID', message: 'no such file on this evaluation' }]);
    }
    const files = before.files.filter((f) => String(f.fileId) !== fileId);
    const updated = await evaluationRepository.updateById(id, { files }, { by: ctx.userId, version, scope });
    await fileService.softDelete(ctx, fileId, scope).catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'file', old: fileId, new: null }],
    });
    return updated;
  }

  /**
   * Approve or reject an evaluation. Re-settable (a later correction re-decides the same record).
   * A `rejected` decision removes the applicant from the active pipeline. Correcting a prior
   * rejection back to `approved` does NOT auto-restore the applicant — restoring is an explicit
   * applicant-lifecycle action, since an applicant may be rejected for more than one reason.
   */
  async decide(ctx: AuthContext, id: string, input: DecideEvaluation, scope: ScopeSelector): Promise<EvaluationDoc> {
    const before = await evaluationRepository.getById(id, scope);
    const now = new Date();
    const event: EvaluationDecisionEvent = {
      at: now,
      from: before.status,
      to: input.decision,
      reason: input.reason ?? null,
      by: new Types.ObjectId(ctx.userId),
    };
    // The engine owns the status change and publishes the event (I13/I15).
    const { record: updated } = await recruitmentWorkflowEngine.transition({
      binding: BINDING,
      id,
      to: input.decision,
      actorUserId: ctx.userId,
      reason: input.reason ?? null,
      version: input.version,
      set: {
        reason: input.reason ?? null,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: now,
        decisionHistory: [...(before.decisionHistory ?? []), event],
      },
      payload: { phaseKey: before.phaseKey },
    } as never) as unknown as { record: EvaluationDoc };
    if (input.decision === 'rejected') {
      await applicantService.markRejectedByEvaluation(
        ctx,
        String(before.applicantId),
        { evaluationId: id, phaseKey: before.phaseKey, reason: input.reason ?? `rejected at ${before.phaseKey}` },
        scope,
      );
    }
    await emit(HrEvaluationEvents.EvaluationDecided, {
      evaluationId: id,
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      phaseKey: before.phaseKey,
      decision: input.decision,
    });
    return updated;
  }

  /**
   * Record or clear the appointment date (RW9). Only phases that declare `appointmentEnabled`
   * carry one — Medical Check is the individual phase this exists for: HR books the visit on the
   * applicant's own record, then uploads the result and decides there.
   */
  async setAppointment(
    ctx: AuthContext,
    id: string,
    input: SetEvaluationAppointment,
    scope: ScopeSelector,
  ): Promise<EvaluationDoc> {
    const before = await evaluationRepository.getById(id, scope);
    const phase = await evaluationPhaseRepository.findActiveById(String(before.phaseId));
    if (phase === null || !phase.appointmentEnabled) {
      throw new BusinessRuleError('this evaluation phase does not schedule appointments');
    }
    const updated = await evaluationRepository.updateById(
      id,
      { appointmentAt: input.appointmentAt },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'appointmentAt',
          old: before.appointmentAt === null ? null : before.appointmentAt.toISOString(),
          new: input.appointmentAt === null ? null : input.appointmentAt.toISOString(),
        },
        ...(input.note === undefined ? [] : [{ field: 'note', old: null, new: input.note }]),
      ],
    });
    await recruitmentTimelineService.record({
      applicantId: String(before.applicantId),
      applicantCode: before.applicantCode,
      branchId: before.branchId,
      type: 'note',
      stage: { kind: 'evaluation', refId: String(before.phaseId), name: before.phaseName },
      correlation: { type: 'evaluation', id },
      entity: { type: 'evaluation', id },
      discriminator: `appointment:${String(before.attempt)}`,
      actorUserId: ctx.userId,
      note:
        input.appointmentAt === null
          ? `${before.phaseKey}: appointment cleared`
          : `${before.phaseKey}: appointment ${input.appointmentAt.toISOString()}`,
    });
    return updated;
  }

  /**
   * Stamp (or release) the batch this record is being worked under (RW8). The batch feature owns
   * the coordination record; the evaluation stays the applicant's single phase result, so the
   * attribution is written here rather than by reaching into the collection from outside.
   */
  async attachToBatch(
    ctx: AuthContext,
    id: string,
    batch: { batchId: string; batchCode: string } | null,
    scope: ScopeSelector,
  ): Promise<EvaluationDoc> {
    const before = await evaluationRepository.getById(id, scope);
    return evaluationRepository.updateById(
      id,
      {
        batchId: batch === null ? null : new Types.ObjectId(batch.batchId),
        batchCode: batch === null ? null : batch.batchCode,
      },
      { by: ctx.userId, version: before.__v, scope },
    );
  }

  /**
   * Whether the applicant has cleared every active evaluation phase — every non-driver phase is
   * `approved`, plus any driver phase that was actually opened for them. Used by later stages to
   * gate a Job Offer after the interview + evaluation pipeline.
   */
  async hasClearedRequiredEvaluations(applicantId: string): Promise<boolean> {
    const [phases, evaluations] = await Promise.all([
      evaluationPhaseRepository.findAllActive(),
      evaluationRepository.findByApplicant(applicantId),
    ]);
    // A superseded attempt is history, never a gate input (RW13).
    const byPhase = new Map(
      evaluations.filter((e) => e.supersededAt === null).map((e) => [String(e.phaseId), e]),
    );
    return phases.every((phase) => {
      const record = byPhase.get(String(phase._id));
      // Driver-only phases only gate when they were opened for this applicant.
      if (phase.driversOnly && record === undefined) return true;
      return record !== undefined && record.status === 'approved';
    });
  }

  /**
   * Bulk approve/reject one phase's queue (RW10/RW17/I4). Each item runs the single-item
   * `decide` in its own transaction; a selection spanning another phase is rejected per id.
   */
  async bulk(
    ctx: AuthContext,
    input: BulkEvaluations,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    const decision = input.action === 'approve' ? 'approved' : 'rejected';
    return runBulk(
      input.ids,
      async (id) => {
        const current = await evaluationRepository.getById(id, scope);
        if (String(current.phaseId) !== input.phaseId) {
          throw new BusinessRuleError('this record belongs to a different evaluation phase');
        }
        await this.decide(
          ctx,
          id,
          {
            decision,
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            version: current.__v,
          },
          scope,
        );
      },
      {
        entityType: 'evaluation',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }

  /**
   * Evaluation counts per status, split by phase, over the LIVE attempts — the per-phase numbers
   * the aggregated counters endpoint reports (RW15/I3). One grouped query for all phases.
   */
  async statusCountsByPhase(
    branchId: string | undefined,
    scope: ScopeSelector,
  ): Promise<Record<string, Record<string, number>>> {
    return evaluationRepository.countByStatusGrouped(
      'phaseId',
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
  /**
   * RW5 — record (or clear) this stage's advisory placement recommendation. It is DATA on the
   * record, never a move: accepting it is a separate, audited reassignment, and the
   * recommendation stays here forever whether it was accepted or not.
   */
  async setRecommendation(
    ctx: AuthContext,
    id: string,
    input: SetPlacementRecommendation,
    scope: ScopeSelector,
  ): Promise<EvaluationDoc> {
    const before = await evaluationRepository.getById(id, scope);
    const resolved =
      input.recommendedPlacement === null ? null : await resolvePlacement(input.recommendedPlacement);
    const updated = await evaluationRepository.updateById(
      id,
      {
        recommendedPlacement: resolved === null ? null : resolved.placement,
        recommendationNote: input.recommendationNote ?? null,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        {
          field: 'recommendedPlacement',
          old: before.recommendedPlacement === null ? null : 'set',
          new: resolved === null ? null : [resolved.label.position, resolved.label.branch].filter((v) => v !== null).join(' · '),
        },
      ],
    });
    return updated;
  }

  /**
   * RW2 step 3 — a reassignment moves the candidate, so their records must follow into the new
   * branch or a branch-scoped user would lose sight of their own history. This touches the
   * denormalized SCOPE FIELD only: no decision, no status, and never a `placementSnapshot`
   * (RW4 — what a record was created under is history and is never rewritten).
   */
  async syncApplicantBranch(applicantId: string, branchId: Types.ObjectId | null): Promise<void> {
    if (!Types.ObjectId.isValid(applicantId)) return;
    await EvaluationModel.updateMany(
      { applicantId: new Types.ObjectId(applicantId) },
      { $set: { branchId } },
    ).exec();
  }

  get workflowBinding(): StageBinding<never> {
    return BINDING;
  }
}

export const evaluationService = new EvaluationService();
