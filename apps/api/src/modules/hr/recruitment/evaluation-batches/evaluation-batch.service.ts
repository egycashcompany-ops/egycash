// Evaluation-batch lifecycle (RW8). Security Check and Driving Test are worked on a GROUP of
// applicants: HR drafts a batch, the system generates the official list plus an export package,
// the package goes out, and the returned results are uploaded and decided item by item.
//
//   draft ──add/remove──▶ draft ──issue──▶ issued ──(results, decisions)──▶ closed
//     └──cancel(reason)──▶ cancelled            issued ──cancel(reason)──▶ cancelled
//
// Three rules keep a batch from becoming a second source of truth (I1):
//   • every item points at the applicant's ordinary evaluation record, opened through the existing
//     idempotent `evaluationService.open`;
//   • deciding an item decides that evaluation through `evaluationService.decide`, so the audit
//     record, the workflow event and the timeline entry are the ones a single decision produces;
//   • membership freezes at issue — afterwards an item is only ever VOIDED with a reason.
//
// Cross-feature access goes through the stage barrels (ADR-003).
import { Types } from 'mongoose';
import {
  HrEvaluationBatchEvents,
  type AddBatchItems,
  type BulkActionResultDto,
  type BulkBatchItems,
  type BulkEvaluationBatches,
  type CancelEvaluationBatch,
  type CloseEvaluationBatch,
  type CreateEvaluationBatch,
  type DecideBatchItem,
  type IssueEvaluationBatch,
  type ListBatchCandidatesQuery,
  type ListEvaluationBatchesQuery,
  type Paginated,
  type UpdateEvaluationBatch,
  type UploadBatchResult,
  type VoidBatchItem,
} from '@ecms/contracts';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../../../shared/errors';
import { type AuthContext, type ScopeSelector } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { fileService, type UploadedBinary } from '../../../../platform/files';
import { applicantService, type ApplicantDoc } from '../applicants';
import { evaluationService, evaluationPhaseService, type EvaluationDoc } from '../evaluations';
import { interviewService } from '../interviews';
import { runBulk } from '../workflow';
import { batchManageScope } from './evaluation-batch.access';
import { nextBatchNumber } from './batch-sequence';
import { resolveEvaluationBatchCategoryId } from './evaluation-batch.files';
import {
  emptyPackage,
  type BatchCounts,
  type BatchItem,
  type EvaluationBatchDoc,
} from './evaluation-batch.model';
import {
  evaluationBatchRepository,
  type EvaluationBatchListFilter,
} from './evaluation-batch.repository';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'evaluationBatch', entityId: id });

/** Catalogs are paged; evaluation phases are a handful, never hundreds. */
const CANDIDATE_PAGE_SIZE = 500;

/** Denormalized counts, always recomputed from `items` — never incremented in place. */
const countsOf = (items: BatchItem[]): BatchCounts => ({
  total: items.length,
  pending: items.filter((i) => i.result === 'pending').length,
  approved: items.filter((i) => i.result === 'approved').length,
  rejected: items.filter((i) => i.result === 'rejected').length,
  voided: items.filter((i) => i.result === 'voided').length,
});

class EvaluationBatchService {
  // ── Reads ─────────────────────────────────────────────────────────────────

  /**
   * `visiblePhaseIds` is the RW7 gate: the collection is one aggregate across every phase, so an
   * unfiltered list must be narrowed to the phases the caller may see, not just scoped by branch.
   */
  async list(
    query: ListEvaluationBatchesQuery,
    scope: ScopeSelector,
    visiblePhaseIds?: string[],
  ): Promise<Paginated<EvaluationBatchDoc>> {
    const filter: EvaluationBatchListFilter = {
      phaseId: query.phaseId,
      ...(visiblePhaseIds === undefined ? {} : { phaseIds: visiblePhaseIds }),
      status: query.status,
      branchId: query.branchId,
      issuedFrom: query.issuedFrom,
      issuedTo: query.issuedTo,
      search: query.search,
    };
    return evaluationBatchRepository.listBatches({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<EvaluationBatchDoc> {
    return evaluationBatchRepository.getById(id, scope);
  }

  /**
   * The selection pool for "Generate batch": applicants sitting in this phase's `waiting` queue
   * who are not already held by an open batch of the same phase. Because a `waiting` evaluation
   * record exists for every applicable phase (I11), the pool is a plain indexed read.
   */
  async listCandidates(
    query: ListBatchCandidatesQuery,
    scope: ScopeSelector,
  ): Promise<{ evaluation: EvaluationDoc; applicant: ApplicantDoc }[]> {
    const waiting = await evaluationService.list(
      {
        page: 1,
        pageSize: Math.min(query.limit, CANDIDATE_PAGE_SIZE),
        sortDir: 'asc',
        sortBy: 'createdAt',
        phaseId: query.phaseId,
        status: 'waiting',
        includeSuperseded: false,
        // One branch, said in the list form the queue filter now takes.
        ...(query.branchId === undefined ? {} : { branchId: [query.branchId] }),
      },
      scope,
    );
    const held = await evaluationBatchRepository.applicantsInOpenBatches(
      query.phaseId,
      waiting.items.map((e) => String(e.applicantId)),
    );
    const out: { evaluation: EvaluationDoc; applicant: ApplicantDoc }[] = [];
    for (const evaluation of waiting.items) {
      const applicantId = String(evaluation.applicantId);
      if (held.has(applicantId)) continue;
      const applicant = await applicantService.findByIdSystem(applicantId);
      if (applicant === null || applicant.status !== 'new') continue;
      out.push({ evaluation, applicant });
    }
    return out;
  }

  // ── Draft ─────────────────────────────────────────────────────────────────

  /** Draft a batch from a selection of applicants — the one bulk action that CREATES (RW17). */
  async create(
    ctx: AuthContext,
    input: CreateEvaluationBatch,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const phase = await evaluationPhaseService.getById(input.phaseId);
    if (phase.kind !== 'batch') {
      throw new BusinessRuleError('this evaluation phase is worked individually, not in batches');
    }
    if (!phase.active) {
      throw new ValidationError([
        { field: 'phaseId', code: 'INVALID', message: 'unknown or inactive evaluation phase' },
      ]);
    }
    const items = await this.buildItems(ctx, input.phaseId, input.applicantIds, scope);
    if (items.length === 0) {
      throw new BusinessRuleError('none of the selected applicants is eligible for this batch');
    }
    const code = await nextBatchNumber(phase.key);
    const doc = await evaluationBatchRepository.create(
      {
        code,
        phaseId: phase._id,
        phaseKey: phase.key,
        phaseName: phase.name,
        // A batch that spans branches carries none — a single-branch batch keeps the scope (ADR-015).
        branchId: this.commonBranch(items),
        status: 'draft',
        title: input.title ?? null,
        scheduledFor: input.scheduledFor ?? null,
        expectedReturnAt: input.expectedReturnAt ?? null,
        sentAt: null,
        returnedAt: null,
        items,
        counts: countsOf(items),
        package: emptyPackage(),
        returnedDocuments: [],
      },
      { by: ctx.userId },
    );
    await this.stampEvaluations(ctx, items, String(doc._id), code, scope);
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: [
        { field: 'code', old: null, new: code },
        { field: 'phaseKey', old: null, new: phase.key },
        { field: 'itemCount', old: null, new: items.length },
      ],
    });
    await emit(HrEvaluationBatchEvents.BatchCreated, {
      batchId: String(doc._id),
      code,
      phaseKey: phase.key,
      itemCount: items.length,
    });
    return doc;
  }

  /** Editable metadata. Dates stay editable after issue — `sentAt`/`returnedAt` are facts (A5). */
  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateEvaluationBatch,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    this.assertNotTerminal(before);
    const set: Record<string, unknown> = {};
    if (input.title !== undefined) set.title = input.title;
    if (input.scheduledFor !== undefined) set.scheduledFor = input.scheduledFor;
    if (input.sentAt !== undefined) set.sentAt = input.sentAt;
    if (input.expectedReturnAt !== undefined) set.expectedReturnAt = input.expectedReturnAt;
    const after = await evaluationBatchRepository.updateById(id, set, {
      by: ctx.userId,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: Object.keys(set).map((field) => ({ field, old: null, new: String(set[field] ?? '') })),
    });
    return after;
  }

  /** Add applicants to a DRAFT batch — membership freezes at issue. */
  async addItems(
    ctx: AuthContext,
    id: string,
    input: AddBatchItems,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    if (before.status !== 'draft') {
      throw new BusinessRuleError('membership is frozen once the batch is issued');
    }
    const existing = new Set(before.items.map((i) => String(i.applicantId)));
    const fresh = input.applicantIds.filter((applicantId) => !existing.has(applicantId));
    const added = await this.buildItems(ctx, String(before.phaseId), fresh, scope);
    if (added.length === 0) {
      throw new BusinessRuleError('none of the selected applicants is eligible for this batch');
    }
    const items = [...before.items, ...added];
    const after = await evaluationBatchRepository.updateById(
      id,
      { items, counts: countsOf(items), branchId: this.commonBranch(items) },
      { by: ctx.userId, version: input.version, scope },
    );
    await this.stampEvaluations(ctx, added, id, before.code, scope);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'itemsAdded', old: null, new: added.length }],
    });
    return after;
  }

  /**
   * Remove an applicant from a DRAFT batch. This is the ONLY removal that ever happens: after
   * issue an item is voided, never removed (RW8).
   */
  async removeItem(
    ctx: AuthContext,
    id: string,
    applicantId: string,
    version: number,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    if (before.status !== 'draft') {
      throw new BusinessRuleError('an issued batch keeps every item — void it instead');
    }
    const target = before.items.find((i) => String(i.applicantId) === applicantId);
    if (target === undefined) throw new NotFoundError('no such applicant in this batch');
    const items = before.items.filter((i) => String(i.applicantId) !== applicantId);
    const after = await evaluationBatchRepository.updateById(
      id,
      { items, counts: countsOf(items), branchId: this.commonBranch(items) },
      { by: ctx.userId, version, scope },
    );
    // The evaluation record itself stays — only its batch attribution is released.
    await evaluationService
      .attachToBatch(ctx, String(target.evaluationId), null, scope)
      .catch(() => undefined);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'itemRemoved', old: target.applicantCode, new: null }],
    });
    return after;
  }

  // ── Issue ─────────────────────────────────────────────────────────────────

  /** Freeze membership, stamp the sent date, and queue the package build (RW8b). */
  async issue(
    ctx: AuthContext,
    id: string,
    input: IssueEvaluationBatch,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    if (before.status !== 'draft') throw new BusinessRuleError('only a draft batch can be issued');
    if (before.items.length === 0) throw new BusinessRuleError('an empty batch cannot be issued');
    const now = new Date();
    const after = await evaluationBatchRepository.updateById(
      id,
      {
        status: 'issued',
        issuedAt: now,
        issuedBy: new Types.ObjectId(ctx.userId),
        sentAt: input.sentAt ?? now,
        'package.status': 'queued',
        'package.error': null,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'status', old: 'draft', new: 'issued' }],
    });
    await emit(HrEvaluationBatchEvents.BatchIssued, {
      batchId: id,
      code: before.code,
      phaseKey: before.phaseKey,
      itemCount: before.items.length,
    });
    // RW8b — the package is built in the WORKER; issuing never waits on chromium.
    await emit(
      HrEvaluationBatchEvents.BatchGenerated,
      { batchId: id, code: before.code },
      { reliable: true, actorId: ctx.userId },
    );
    return after;
  }

  /** Re-request the package build after a failure (RW8b — retryable from the UI). */
  async retryPackage(ctx: AuthContext, id: string, scope: ScopeSelector): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    if (before.status === 'draft') throw new BusinessRuleError('issue the batch before building its package');
    const after = await evaluationBatchRepository.updateById(
      id,
      { 'package.status': 'queued', 'package.error': null },
      { by: ctx.userId, version: before.__v, scope },
    );
    await emit(
      HrEvaluationBatchEvents.BatchGenerated,
      { batchId: id, code: before.code },
      { reliable: true, actorId: ctx.userId },
    );
    return after;
  }

  // ── Results (RW8c) ────────────────────────────────────────────────────────

  /** Upload a returned result document. The first upload stamps `returnedAt` (A5). */
  async uploadResult(
    ctx: AuthContext,
    id: string,
    meta: UploadBatchResult,
    binary: UploadedBinary,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    if (before.status === 'draft') {
      throw new BusinessRuleError('results can only be returned against an issued batch');
    }
    if (meta.applicantId !== undefined && !before.items.some((i) => String(i.applicantId) === meta.applicantId)) {
      throw new ValidationError([
        { field: 'applicantId', code: 'INVALID', message: 'no such applicant in this batch' },
      ]);
    }
    const file = await fileService.upload(
      ctx,
      {
        moduleId: 'hr',
        entityType: 'evaluationBatch',
        entityId: id,
        categoryId: await resolveEvaluationBatchCategoryId(),
        displayName: `${before.code} result`,
        visibility: 'private',
        tags: [],
        ...(meta.note === undefined ? {} : { description: meta.note }),
      },
      binary,
    );
    const returnedDocuments = [
      ...before.returnedDocuments,
      {
        fileId: file._id,
        fileName: file.originalName,
        note: meta.note ?? null,
        applicantId: meta.applicantId === undefined ? null : new Types.ObjectId(meta.applicantId),
        uploadedBy: new Types.ObjectId(ctx.userId),
        uploadedAt: new Date(),
      },
    ];
    // Attributing a document to one applicant also stamps that item's result file.
    const items =
      meta.applicantId === undefined
        ? before.items
        : before.items.map((i) =>
            String(i.applicantId) === meta.applicantId ? { ...i, resultFileId: file._id } : i,
          );
    const returnedAt = before.returnedAt ?? meta.returnedAt ?? new Date();
    const after = await evaluationBatchRepository.updateById(
      id,
      { returnedDocuments, items, returnedAt },
      { by: ctx.userId, version: meta.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'resultDocument', old: null, new: file.originalName }],
    });
    await emit(HrEvaluationBatchEvents.BatchReturned, {
      batchId: id,
      code: before.code,
      phaseKey: before.phaseKey,
      documentCount: returnedDocuments.length,
      returnedAt,
    });
    return after;
  }

  // ── Decisions ─────────────────────────────────────────────────────────────

  /**
   * Decide ONE item. The decision is applied to the applicant's evaluation record through the
   * existing service, so the batch never becomes a second source of truth (I1).
   */
  async decideItem(
    ctx: AuthContext,
    id: string,
    applicantId: string,
    input: DecideBatchItem,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    if (before.status === 'draft') {
      throw new BusinessRuleError('issue the batch before deciding its items');
    }
    const item = before.items.find((i) => String(i.applicantId) === applicantId);
    if (item === undefined) throw new NotFoundError('no such applicant in this batch');
    if (item.result === 'voided') throw new BusinessRuleError('a voided item cannot be decided');

    const evaluation = await evaluationService.getById(String(item.evaluationId), scope);
    await evaluationService.decide(
      ctx,
      String(item.evaluationId),
      {
        decision: input.result,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        version: evaluation.__v,
      },
      scope,
    );
    return this.applyItemResult(ctx, before, applicantId, input.result, input.reason ?? null, input.version);
  }

  /** Retire an item without deleting it (candidate withdrew, sent in error…). */
  async voidItem(
    ctx: AuthContext,
    id: string,
    applicantId: string,
    input: VoidBatchItem,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    const item = before.items.find((i) => String(i.applicantId) === applicantId);
    if (item === undefined) throw new NotFoundError('no such applicant in this batch');
    // Voiding only retires the batch membership — the evaluation record stays exactly as it is,
    // so the applicant simply returns to the phase queue.
    const after = await this.applyItemResult(ctx, before, applicantId, 'voided', input.reason, input.version);
    await evaluationService
      .attachToBatch(ctx, String(item.evaluationId), null, scope)
      .catch(() => undefined);
    return after;
  }

  /** Bulk decide/void items inside one batch (RW10/I4 — per-item, partial success). */
  async bulkItems(
    ctx: AuthContext,
    id: string,
    input: BulkBatchItems,
    scope: ScopeSelector,
  ): Promise<BulkActionResultDto> {
    return runBulk(
      input.ids,
      async (applicantId) => {
        const current = await evaluationBatchRepository.getById(id, scope);
        if (input.action === 'void') {
          await this.voidItem(
            ctx,
            id,
            applicantId,
            { reason: input.reason as string, version: current.__v },
            scope,
          );
          return;
        }
        await this.decideItem(
          ctx,
          id,
          applicantId,
          {
            result: input.action === 'approve' ? 'approved' : 'rejected',
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            version: current.__v,
          },
          scope,
        );
      },
      {
        entityType: 'evaluationBatchItem',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }

  // ── Terminal transitions ──────────────────────────────────────────────────

  /** Close an issued batch — every live item must carry a decision first. */
  async close(
    ctx: AuthContext,
    id: string,
    input: CloseEvaluationBatch,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    if (before.status !== 'issued') throw new BusinessRuleError('only an issued batch can be closed');
    if (before.counts.pending > 0) {
      throw new BusinessRuleError('every item must be decided or voided before the batch is closed');
    }
    const after = await evaluationBatchRepository.updateById(
      id,
      { status: 'closed', closedAt: new Date(), closedBy: new Types.ObjectId(ctx.userId) },
      { by: ctx.userId, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [{ field: 'status', old: before.status, new: 'closed' }],
    });
    await emit(HrEvaluationBatchEvents.BatchClosed, {
      batchId: id,
      code: before.code,
      phaseKey: before.phaseKey,
      itemCount: before.items.length,
    });
    return after;
  }

  /** Abandon a batch with a reason. Cancelled batches are kept forever like any other. */
  async cancel(
    ctx: AuthContext,
    id: string,
    input: CancelEvaluationBatch,
    scope: ScopeSelector,
  ): Promise<EvaluationBatchDoc> {
    const before = await evaluationBatchRepository.getById(id, scope);
    this.assertNotTerminal(before);
    const after = await evaluationBatchRepository.updateById(
      id,
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: new Types.ObjectId(ctx.userId),
        cancelledReason: input.reason,
      },
      { by: ctx.userId, version: input.version, scope },
    );
    // A cancelled batch releases its candidates: their evaluation records return to the queue.
    for (const item of before.items) {
      await evaluationService
        .attachToBatch(ctx, String(item.evaluationId), null, scope)
        .catch(() => undefined);
    }
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: [
        { field: 'status', old: before.status, new: 'cancelled' },
        { field: 'reason', old: null, new: input.reason },
      ],
    });
    await emit(HrEvaluationBatchEvents.BatchCancelled, {
      batchId: id,
      code: before.code,
      phaseKey: before.phaseKey,
      itemCount: before.items.length,
    });
    return after;
  }

  /**
   * Bulk close/cancel over batches themselves (list-level actions). A selection may span phases,
   * so the permission is resolved PER batch — an id the caller may not manage fails as that one
   * item, and the rest of the selection still applies (I4).
   */
  async bulk(ctx: AuthContext, input: BulkEvaluationBatches): Promise<BulkActionResultDto> {
    return runBulk(
      input.ids,
      async (id) => {
        const scope = await batchManageScope(ctx, id);
        const current = await evaluationBatchRepository.getById(id, scope);
        if (input.action === 'close') {
          await this.close(ctx, id, { version: current.__v }, scope);
          return;
        }
        await this.cancel(
          ctx,
          id,
          { reason: input.reason ?? 'cancelled in bulk', version: current.__v },
          scope,
        );
      },
      {
        entityType: 'evaluationBatch',
        action: input.action,
        actorUserId: ctx.userId,
        reason: input.reason ?? null,
      },
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private assertNotTerminal(doc: EvaluationBatchDoc): void {
    if (doc.status === 'closed' || doc.status === 'cancelled') {
      throw new BusinessRuleError(`a ${doc.status} batch can no longer be changed`);
    }
  }

  /** A batch spanning several branches carries none; a single-branch batch keeps the scope. */
  private commonBranch(items: BatchItem[]): Types.ObjectId | null {
    const branches = new Set(
      items.map((i) => (i.placementSnapshot.branchId === null ? '' : String(i.placementSnapshot.branchId))),
    );
    if (branches.size !== 1) return null;
    const [only] = [...branches];
    return only === undefined || only === '' ? null : new Types.ObjectId(only);
  }

  /**
   * Turn a selection into batch items, enforcing eligibility per applicant: live applicant, all
   * interviews cleared, phase applicable, no approved record at that phase, and not already held
   * by another open batch of the same phase. An ineligible id is skipped, never silently included.
   */
  private async buildItems(
    ctx: AuthContext,
    phaseId: string,
    applicantIds: string[],
    scope: ScopeSelector,
  ): Promise<BatchItem[]> {
    if (applicantIds.length === 0) return [];
    const held = await evaluationBatchRepository.applicantsInOpenBatches(phaseId, applicantIds);
    const items: BatchItem[] = [];
    for (const applicantId of applicantIds) {
      if (held.has(applicantId)) continue;
      const applicant = await applicantService.findByIdSystem(applicantId);
      if (applicant === null || applicant.status !== 'new') continue;
      if (!(await interviewService.hasClearedAllInterviews(applicantId))) continue;
      // Idempotent: an applicant already sitting in the phase queue keeps their existing record.
      const evaluation = await evaluationService.open(ctx, { applicantId, phaseId }, scope);
      if (evaluation.status === 'approved') continue;
      items.push({
        applicantId: applicant._id,
        applicantCode: applicant.code,
        applicantName: applicant.fullNameAr,
        evaluationId: evaluation._id,
        placementSnapshot: applicant.placement,
        placementSnapshotLabel: applicant.placementLabel,
        nationalId: applicant.nationalId,
        result: 'pending',
        reason: null,
        resultFileId: null,
        decidedBy: null,
        decidedAt: null,
      });
    }
    return items;
  }

  /** Stamp the batch attribution onto each member's evaluation record. */
  private async stampEvaluations(
    ctx: AuthContext,
    items: BatchItem[],
    batchId: string,
    batchCode: string,
    scope: ScopeSelector,
  ): Promise<void> {
    for (const item of items) {
      await evaluationService
        .attachToBatch(ctx, String(item.evaluationId), { batchId, batchCode }, scope)
        .catch(() => undefined);
    }
  }

  /** Write one item's outcome and recompute the denormalized counts. */
  private async applyItemResult(
    ctx: AuthContext,
    before: EvaluationBatchDoc,
    applicantId: string,
    result: BatchItem['result'],
    reason: string | null,
    version: number,
  ): Promise<EvaluationBatchDoc> {
    const now = new Date();
    const items = before.items.map((i) =>
      String(i.applicantId) === applicantId
        ? { ...i, result, reason, decidedBy: new Types.ObjectId(ctx.userId), decidedAt: now }
        : i,
    );
    const after = await evaluationBatchRepository.updateById(
      String(before._id),
      { items, counts: countsOf(items) },
      { by: ctx.userId, version },
    );
    await auditService.record({
      entityRef: entityRef(String(before._id)),
      action: 'update',
      changes: [
        { field: 'itemResult', old: applicantId, new: result },
        ...(reason === null ? [] : [{ field: 'reason', old: null, new: reason }]),
      ],
    });
    return after;
  }
}

export const evaluationBatchService = new EvaluationBatchService();
