// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
//
// I6 — a batch action that names ONE candidate (decide/void an item) answers with the full
// workflow envelope, because there is a candidate whose state to report. Batch-LEVEL actions
// (create, issue, close, cancel, add items, upload results) span many candidates and therefore
// have no single workflow state; they keep the plain response until the batch-history question is
// decided, and are listed as the one open item in the I6 report rather than given an invented one.
//
// Authorization is phase-aware (RW7), so it cannot sit in a static `authorize()` on the route: the
// permission resource is a property of the batch's phase. Every handler resolves it first.
import { type Request, type Response } from 'express';
import {
  type AddBatchItems,
  type BulkBatchItems,
  type BulkEvaluationBatches,
  type CancelEvaluationBatch,
  type CloseEvaluationBatch,
  type CreateEvaluationBatch,
  type DecideBatchItem,
  type IssueEvaluationBatch,
  type ListBatchCandidatesQuery,
  type ListEvaluationBatchesQuery,
  type RemoveBatchItem,
  type UpdateEvaluationBatch,
  type UploadBatchResult,
  type VoidBatchItem,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { ForbiddenError, ValidationError } from '../../../../shared/errors';
import { type UploadedBinary } from '../../../../platform/files';
import {
  anyPhaseViewScope,
  assertPhaseManage,
  assertPhaseView,
  batchManageScope,
  batchViewScope,
  canViewAnyPhase,
  phaseManageScope,
  phaseViewScope,
  visibleBatchPhaseIds,
} from './evaluation-batch.access';
import { withBulkWorkflowEnvelope, withWorkflowEnvelope } from '../workflow';
import { evaluationBatchService } from './evaluation-batch.service';
import {
  toBatchCandidateDto,
  toEvaluationBatchDto,
  toEvaluationBatchSummaryDto,
} from './evaluation-batch.mapper';

type IdParam = { id: string };
type ItemParam = { id: string; applicantId: string };

const binaryOf = (req: Request): UploadedBinary => {
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([
      { field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' },
    ]);
  }
  return { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer };
};

// ── Reads ───────────────────────────────────────────────────────────────────

export const listEvaluationBatches = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEvaluationBatchesQuery>(req);
  // A phase filter narrows to that phase's own grant. An unfiltered list spans every phase the
  // caller can see, so it runs at the widest scope they hold AND is restricted to those phases —
  // the collection is one aggregate, so branch scoping alone would hand over other phases' batches.
  if (query.phaseId !== undefined) {
    const scope = phaseViewScope(ctx, await assertPhaseView(ctx, query.phaseId));
    okPage(res, await evaluationBatchService.list(query, scope), toEvaluationBatchSummaryDto);
    return;
  }
  if (!canViewAnyPhase(ctx)) throw new ForbiddenError();
  const visible = await visibleBatchPhaseIds(ctx);
  okPage(
    res,
    await evaluationBatchService.list(query, anyPhaseViewScope(ctx), visible),
    toEvaluationBatchSummaryDto,
  );
};

export const getEvaluationBatch = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const scope = await batchViewScope(ctx, params.id);
  ok(res, toEvaluationBatchDto(await evaluationBatchService.getById(params.id, scope)));
};

export const listBatchCandidates = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListBatchCandidatesQuery>(req);
  const scope = phaseManageScope(ctx, await assertPhaseManage(ctx, query.phaseId));
  const rows = await evaluationBatchService.listCandidates(query, scope);
  ok(
    res,
    rows.map(({ evaluation, applicant }) => toBatchCandidateDto(applicant, evaluation.createdAt)),
  );
};

// ── Draft ───────────────────────────────────────────────────────────────────

export const createEvaluationBatch = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateEvaluationBatch>(req);
  const scope = phaseManageScope(ctx, await assertPhaseManage(ctx, body.phaseId));
  const doc = await evaluationBatchService.create(ctx, body, scope);
  created(res, toEvaluationBatchDto(doc), `/api/v1/hr/evaluation-batches/${String(doc._id)}`);
};

export const updateEvaluationBatch = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateEvaluationBatch, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(res, toEvaluationBatchDto(await evaluationBatchService.update(ctx, params.id, body, scope)));
};

export const addEvaluationBatchItems = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AddBatchItems, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(res, toEvaluationBatchDto(await evaluationBatchService.addItems(ctx, params.id, body, scope)));
};

export const removeEvaluationBatchItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RemoveBatchItem, never, ItemParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  const doc = await evaluationBatchService.removeItem(
    ctx,
    params.id,
    params.applicantId,
    body.version,
    scope,
  );
  ok(res, toEvaluationBatchDto(doc));
};

// ── Issue + package ─────────────────────────────────────────────────────────

export const issueEvaluationBatch = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<IssueEvaluationBatch, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(res, toEvaluationBatchDto(await evaluationBatchService.issue(ctx, params.id, body, scope)));
};

export const retryEvaluationBatchPackage = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(res, toEvaluationBatchDto(await evaluationBatchService.retryPackage(ctx, params.id, scope)));
};

// ── Results + decisions ─────────────────────────────────────────────────────

export const uploadEvaluationBatchResult = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UploadBatchResult, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  const doc = await evaluationBatchService.uploadResult(ctx, params.id, body, binaryOf(req), scope);
  created(res, toEvaluationBatchDto(doc));
};

export const decideEvaluationBatchItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideBatchItem, never, ItemParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => evaluationBatchService.decideItem(ctx, params.id, params.applicantId, body, scope),
      toEvaluationBatchDto,
      () => params.applicantId,
    ),
  );
};

export const voidEvaluationBatchItem = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<VoidBatchItem, never, ItemParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => evaluationBatchService.voidItem(ctx, params.id, params.applicantId, body, scope),
      toEvaluationBatchDto,
      () => params.applicantId,
    ),
  );
};

export const bulkEvaluationBatchItems = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<BulkBatchItems, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(res, await withBulkWorkflowEnvelope(ctx, () => evaluationBatchService.bulkItems(ctx, params.id, body, scope)));
};

// ── Terminal ────────────────────────────────────────────────────────────────

export const closeEvaluationBatch = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CloseEvaluationBatch, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(res, toEvaluationBatchDto(await evaluationBatchService.close(ctx, params.id, body, scope)));
};

export const cancelEvaluationBatch = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelEvaluationBatch, never, IdParam>(req);
  const scope = await batchManageScope(ctx, params.id);
  ok(res, toEvaluationBatchDto(await evaluationBatchService.cancel(ctx, params.id, body, scope)));
};

export const bulkEvaluationBatches = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkEvaluationBatches>(req);
  // A selection may span phases, so the permission is resolved per batch inside the runner; an id
  // the caller may not manage is reported as that one failed item.
  ok(res, await withBulkWorkflowEnvelope(ctx, () => evaluationBatchService.bulk(ctx, body)));
};
