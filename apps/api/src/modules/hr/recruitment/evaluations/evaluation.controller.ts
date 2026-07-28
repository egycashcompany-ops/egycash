// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform → infrastructure)
// rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type BulkEvaluations,
  type CreateEvaluationPhase,
  type DecideEvaluation,
  type ListEvaluationPhasesQuery,
  type ListEvaluationsQuery,
  type OpenEvaluation,
  type RemoveEvaluationFile,
  type SetEvaluationAppointment,
  type SetPlacementRecommendation,
  type UpdateEvaluationPhase,
  type UploadEvaluationFile,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { ValidationError } from '../../../../shared/errors';
import { type UploadedBinary } from '../../../../platform/files';
import { evaluationPhaseService } from './evaluation-phase.service';
import { withBulkWorkflowEnvelope, withWorkflowEnvelope } from '../workflow';
import { evaluationService } from './evaluation.service';
import { type EvaluationDoc } from './evaluation.model';
import { toEvaluationDto, toEvaluationPhaseDto } from './evaluation.mapper';

type IdParam = { id: string };

const applicantOf = (doc: EvaluationDoc): string => String(doc.applicantId);
type FileParam = { id: string; fileId: string };

const binaryOf = (req: Request): UploadedBinary => {
  const file = req.file;
  if (file === undefined) {
    throw new ValidationError([{ field: 'body.file', code: 'REQUIRED', message: 'multipart field "file" is required' }]);
  }
  return { originalName: file.originalname, mime: file.mimetype, size: file.size, buffer: file.buffer };
};

// ── Phase catalog (admin) ────────────────────────────────────────────────────

export const listEvaluationPhases = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListEvaluationPhasesQuery>(req);
  okPage(res, await evaluationPhaseService.list(query), toEvaluationPhaseDto);
};

export const createEvaluationPhase = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateEvaluationPhase>(req);
  const doc = await evaluationPhaseService.create(body, ctx.userId);
  created(res, toEvaluationPhaseDto(doc), `/api/v1/hr/evaluation-phases/${String(doc._id)}`);
};

export const updateEvaluationPhase = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateEvaluationPhase, never, IdParam>(req);
  ok(res, toEvaluationPhaseDto(await evaluationPhaseService.update(params.id, body, ctx.userId)));
};

// ── Evaluations (per applicant × phase) ──────────────────────────────────────

export const listEvaluations = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListEvaluationsQuery>(req);
  okPage(res, await evaluationService.list(query, scopeSelector(ctx, 'evaluation.view')), toEvaluationDto);
};

export const openEvaluation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<OpenEvaluation>(req);
  const scope = scopeSelector(ctx, 'evaluation.manage');
  const envelope = await withWorkflowEnvelope(
    ctx,
    () => evaluationService.open(ctx, body, scope),
    toEvaluationDto,
    applicantOf,
  );
  created(res, envelope, `/api/v1/hr/evaluations/${envelope.data.id}`);
};

export const getEvaluation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toEvaluationDto(await evaluationService.getById(params.id, scopeSelector(ctx, 'evaluation.view'))));
};

export const uploadEvaluationFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UploadEvaluationFile, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'evaluation.manage');
  created(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => evaluationService.uploadFile(ctx, params.id, body, binaryOf(req), scope),
      toEvaluationDto,
      applicantOf,
    ),
  );
};

export const removeEvaluationFile = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RemoveEvaluationFile, never, FileParam>(req);
  const scope = scopeSelector(ctx, 'evaluation.manage');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => evaluationService.removeFile(ctx, params.id, params.fileId, body.version, scope),
      toEvaluationDto,
      applicantOf,
    ),
  );
};

export const decideEvaluation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideEvaluation, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'evaluation.manage');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => evaluationService.decide(ctx, params.id, body, scope),
      toEvaluationDto,
      applicantOf,
    ),
  );
};

/** RW9 — book (or clear) the visit on an individual phase that schedules one. */
export const setEvaluationAppointment = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SetEvaluationAppointment, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'evaluation.manage');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => evaluationService.setAppointment(ctx, params.id, body, scope),
      toEvaluationDto,
      applicantOf,
    ),
  );
};

/** RW5 — the reviewer's advisory placement recommendation; never moves the candidate by itself. */
export const setEvaluationRecommendation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SetPlacementRecommendation, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'evaluation.manage');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => evaluationService.setRecommendation(ctx, params.id, body, scope),
      toEvaluationDto,
      applicantOf,
    ),
  );
};

export const bulkEvaluations = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkEvaluations>(req);
  const scope = scopeSelector(ctx, 'evaluation.manage');
  ok(res, await withBulkWorkflowEnvelope(ctx, () => evaluationService.bulk(ctx, body, scope)));
};
