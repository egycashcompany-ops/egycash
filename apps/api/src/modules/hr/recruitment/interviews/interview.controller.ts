// Thin HTTP mapping only (ADR-003). Uses the platform web kit (module → platform →
// infrastructure) rather than importing infrastructure directly.
import { type Request, type Response } from 'express';
import {
  type CancelInterview,
  type CreateInterviewStage,
  type DecideInterview,
  type ListInterviewStagesQuery,
  type ListInterviewsQuery,
  type ReassignInterviewPanel,
  type RescheduleInterview,
  type ScheduleInterview,
  type SkipInterviewer,
  type SubmitInterviewEvaluation,
  type UpdateInterviewStage,
} from '@ecms/contracts';
import { created, ok, okPage, validated } from '../../../../platform/web';
import { authContext } from '../../../../platform/auth';
import { scopeSelector } from '../../../../shared/types';
import { interviewService } from './interview.service';
import { interviewStageService } from './interview-stage.service';
import { toInterviewDto, toInterviewStageDto } from './interview.mapper';

type IdParam = { id: string };

// ── Interviews ───────────────────────────────────────────────────────────────

export const scheduleInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<ScheduleInterview>(req);
  const doc = await interviewService.schedule(ctx, body, scopeSelector(ctx, 'interview.create'));
  created(res, toInterviewDto(doc), `/api/v1/hr/interviews/${String(doc._id)}`);
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
  const doc = await interviewService.reschedule(ctx, params.id, body, scopeSelector(ctx, 'interview.edit'));
  ok(res, toInterviewDto(doc));
};

export const reassignInterviewPanel = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReassignInterviewPanel, never, IdParam>(req);
  const doc = await interviewService.reassignPanel(ctx, params.id, body, scopeSelector(ctx, 'interview.edit'));
  ok(res, toInterviewDto(doc));
};

export const skipInterviewer = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SkipInterviewer, never, IdParam>(req);
  const doc = await interviewService.skipInterviewer(ctx, params.id, body, scopeSelector(ctx, 'interview.edit'));
  ok(res, toInterviewDto(doc));
};

export const cancelInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<CancelInterview, never, IdParam>(req);
  const doc = await interviewService.cancel(ctx, params.id, body, scopeSelector(ctx, 'interview.cancel'));
  ok(res, toInterviewDto(doc));
};

export const submitInterviewEvaluation = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SubmitInterviewEvaluation, never, IdParam>(req);
  const doc = await interviewService.submitEvaluation(ctx, params.id, body, scopeSelector(ctx, 'interview.evaluate'));
  ok(res, toInterviewDto(doc));
};

export const decideInterview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<DecideInterview, never, IdParam>(req);
  const doc = await interviewService.decide(ctx, params.id, body, scopeSelector(ctx, 'interview.decide'));
  ok(res, toInterviewDto(doc));
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
