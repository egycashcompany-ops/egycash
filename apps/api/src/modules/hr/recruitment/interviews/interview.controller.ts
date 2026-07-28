// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
//
// I6 — every action on a ROUND answers with the full workflow envelope. The interview-STAGE
// catalog below is configuration, not a candidate's pipeline, so it is unchanged.
import { type Request, type Response } from 'express';
import {
  type SetPlacementRecommendation,
  type BulkInterviews,
  type BulkScheduleInterviews,
  type BulkStartInterviews,
  type CancelInterview,
  type CreateInterviewStage,
  type DecideInterview,
  type ListInterviewStagesQuery,
  type ListInterviewsQuery,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type StartInterview,
  type StartScheduledInterview,
  type SubmitInterviewEvaluation,
  type UpdateInterviewStage,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { withBulkWorkflowEnvelope, withWorkflowEnvelope } from '../workflow';
import { interviewService } from './interview.service';
import { type InterviewDoc } from './interview.model';
import { interviewStageService } from './interview-stage.service';
import { toInterviewDto, toInterviewStageDto } from './interview.mapper';

type IdParam = { id: string };

const applicantOf = (doc: InterviewDoc): string => String(doc.applicantId);

// ── Interviews ───────────────────────────────────────────────────────────────

export const scheduleInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<ScheduleInterview>(req);
  const scope = scopeSelector(ctx, 'interview.create');
  const envelope = await withWorkflowEnvelope(
    ctx,
    () => interviewService.schedule(ctx, body, scope),
    toInterviewDto,
    applicantOf,
  );
  created(res, envelope, `/api/v1/hr/interviews/${envelope.data.id}`);
};

export const listInterviews = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { query } = validated<never, ListInterviewsQuery>(req);
  okPage(res, await interviewService.list(query, scopeSelector(ctx, 'interview.view')), toInterviewDto);
};

export const getInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toInterviewDto(await interviewService.getById(params.id, scopeSelector(ctx, 'interview.view'))));
};

export const rescheduleInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<RescheduleInterview, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.edit');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.reschedule(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

export const reassignInterviewPanel = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReassignInterviewPanel, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.edit');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.reassignPanel(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

export const skipInterviewer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SkipInterviewer, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.edit');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.skipInterviewer(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

export const cancelInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelInterview, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.cancel');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.cancel(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

export const submitInterviewEvaluation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SubmitInterviewEvaluation, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.evaluate');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.submitEvaluation(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

export const decideInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideInterview, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.decide');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.decide(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

export const redecideInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideInterview, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.decide');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.redecide(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

// ── Interview stages (admin catalog) ─────────────────────────────────────────

export const createInterviewStage = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreateInterviewStage>(req);
  const doc = await interviewStageService.create(body, ctx.userId);
  created(res, toInterviewStageDto(doc), `/api/v1/hr/interview-stages/${String(doc._id)}`);
};

export const listInterviewStages = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListInterviewStagesQuery>(req);
  okPage(res, await interviewStageService.list(query), toInterviewStageDto);
};

export const updateInterviewStage = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdateInterviewStage, never, IdParam>(req);
  const doc = await interviewStageService.update(params.id, body, ctx.userId);
  ok(res, toInterviewStageDto(doc));
};

// ── Start now (RW12/A3) ──────────────────────────────────────────────────────

export const startInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<StartInterview>(req);
  const scope = scopeSelector(ctx, 'interview.create');
  const envelope = await withWorkflowEnvelope(
    ctx,
    () => interviewService.start(ctx, body, scope),
    toInterviewDto,
    applicantOf,
  );
  created(res, envelope, `/api/v1/hr/interviews/${envelope.data.id}`);
};

export const startScheduledInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<StartScheduledInterview, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.edit');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.startScheduled(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

// ── Bulk (RW17/I4) ───────────────────────────────────────────────────────────

/** RW5 — the panel's advisory placement recommendation; never moves the candidate by itself. */
export const setInterviewRecommendation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SetPlacementRecommendation, never, IdParam>(req);
  const scope = scopeSelector(ctx, 'interview.evaluate');
  ok(
    res,
    await withWorkflowEnvelope(
      ctx,
      () => interviewService.setRecommendation(ctx, params.id, body, scope),
      toInterviewDto,
      applicantOf,
    ),
  );
};

export const bulkInterviews = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkInterviews>(req);
  const scope = scopeSelector(ctx, 'interview.edit');
  ok(res, await withBulkWorkflowEnvelope(ctx, () => interviewService.bulk(ctx, body, scope)));
};

export const bulkScheduleInterviews = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkScheduleInterviews>(req);
  const scope = scopeSelector(ctx, 'interview.create');
  ok(res, await withBulkWorkflowEnvelope(ctx, () => interviewService.bulkSchedule(ctx, body, scope)));
};

export const bulkStartInterviews = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<BulkStartInterviews>(req);
  const scope = scopeSelector(ctx, 'interview.create');
  ok(res, await withBulkWorkflowEnvelope(ctx, () => interviewService.bulkStart(ctx, body, scope)));
};
