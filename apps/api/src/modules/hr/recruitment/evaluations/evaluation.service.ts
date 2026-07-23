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
  type OpenEvaluation,
  type Paginated,
  type UploadEvaluationFile,
} from '@ecms/contracts';
import { BusinessRuleError, ConflictError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { applicantService } from '../applicants';
import { interviewService } from '../interviews';
import { evaluationRepository, type EvaluationListFilter } from './evaluation.repository';
import { evaluationPhaseRepository } from './evaluation-phase.repository';
import { resolveEvaluationCategoryId } from './evaluation.files';
import { type EvaluationDoc, type EvaluationDecisionEvent, type EvaluationFile } from './evaluation.model';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'evaluation', entityId: id });

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

    // Sequential entry gate: all interview rounds cleared, then every prior evaluation phase.
    if (!(await interviewService.hasClearedAllInterviews(input.applicantId))) {
      throw new BusinessRuleError('applicant must clear all interviews before the evaluation phases');
    }
    await this.assertPriorPhasesCleared(input.applicantId, phase.order);

    try {
      const doc = await evaluationRepository.create(
        {
          applicantId: new Types.ObjectId(input.applicantId),
          applicantCode: applicant.code,
          branchId: applicant.branchId,
          phaseId: phase._id,
          phaseKey: phase.key,
          phaseName: phase.name,
          phaseOrder: phase.order,
          status: 'pending',
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
    const updated = await evaluationRepository.updateById(
      id,
      {
        status: input.decision,
        reason: input.reason ?? null,
        decidedBy: new Types.ObjectId(ctx.userId),
        decidedAt: now,
        decisionHistory: [...(before.decisionHistory ?? []), event],
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: input.decision }],
    });
    if (input.decision === 'rejected') {
      await applicantService.markRejectedByEvaluation(
        ctx,
        String(before.applicantId),
        { evaluationId: id, phaseKey: before.phaseKey, reason: input.reason ?? `rejected at ${before.phaseKey}` },
        scope,
      );
    } else if (before.status === 'rejected') {
      // Rejection is not final: correcting it re-enters the applicant into the pipeline (audited).
      await applicantService.reactivateFromRejection(
        ctx,
        String(before.applicantId),
        { reason: `${before.phaseKey} decision corrected to ${input.decision}` },
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

  /** Sequential gate: every active prior phase must be approved (driver-only priors are optional). */
  private async assertPriorPhasesCleared(applicantId: string, order: number): Promise<void> {
    const priors = (await evaluationPhaseRepository.findAllActive()).filter((p) => p.order < order);
    if (priors.length === 0) return;
    const evals = await evaluationRepository.findByApplicant(applicantId);
    const byPhase = new Map(evals.map((e) => [String(e.phaseId), e]));
    for (const p of priors) {
      const rec = byPhase.get(String(p._id));
      if (p.driversOnly && rec === undefined) continue;
      if (rec === undefined || rec.status !== 'approved') {
        throw new BusinessRuleError(`applicant must clear "${p.name.en}" before this phase`);
      }
    }
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
    const byPhase = new Map(evaluations.map((e) => [String(e.phaseId), e]));
    return phases.every((phase) => {
      const record = byPhase.get(String(phase._id));
      // Driver-only phases only gate when they were opened for this applicant.
      if (phase.driversOnly && record === undefined) return true;
      return record !== undefined && record.status === 'approved';
    });
  }
}

export const evaluationService = new EvaluationService();
