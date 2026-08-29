// Thin HTTP mapping only (ADR-003): parse, delegate, respond. Every rule lives in the services and
// in `cycle-rules.ts`.
import { type Request, type Response } from 'express';
import {
  type AssignPerformanceEvaluator,
  type ClosePerformanceCycle,
  type ClosePerformanceGoal,
  type CreatePerformanceCycle,
  type ExcusePerformanceReview,
  type FinalizePerformanceReview,
  type CreatePerformanceGoal,
  type ListPerformanceCyclesQuery,
  type ListPerformanceGoalsQuery,
  type ListPerformanceReviewsQuery,
  type OpenPerformanceCycle,
  type ProgressPerformanceGoal,
  type ReturnPerformanceReview,
  type SubmitPerformanceReview,
  type UpdatePerformanceCycle,
  type UpdatePerformanceGoal,
} from '@ecms/contracts';
import { created, ok, okPage } from '../../../platform/web';
import { validated } from '../../../infrastructure/http/validate';
import { authContext } from '../../../platform/auth';
import { scopeSelector } from '../../../shared/types';
import { performanceCycleService } from './cycles/performance-cycle.service';
import { performanceReviewService } from './reviews/performance-review.service';
import { performanceGoalService } from './goals/performance-goal.service';
import {
  toPerformanceCycleDto,
  toPerformanceGoalDto,
  toPerformanceReviewDto,
} from './performance.mapper';

type IdParam = { id: string };

// ── Cycles ──────────────────────────────────────────────────────────────────

const cycleScope = (req: Request) => scopeSelector(authContext(req), 'performanceCycle.view');

export const listPerformanceCycles = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListPerformanceCyclesQuery>(req);
  okPage(res, await performanceCycleService.list(query, cycleScope(req)), toPerformanceCycleDto);
};

export const getPerformanceCycle = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toPerformanceCycleDto(await performanceCycleService.getById(params.id, cycleScope(req))));
};

export const createPerformanceCycle = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreatePerformanceCycle>(req);
  const doc = await performanceCycleService.create(ctx, body);
  created(res, toPerformanceCycleDto(doc), `/api/v1/hr/performance/cycles/${String(doc._id)}`);
};

export const updatePerformanceCycle = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdatePerformanceCycle, never, IdParam>(req);
  const doc = await performanceCycleService.update(ctx, params.id, body, cycleScope(req));
  ok(res, toPerformanceCycleDto(doc));
};

/**
 * Opening returns the cycle AND the materializer's receipt.
 *
 * The receipt is the point: «matched 312, created 312, 4 unassigned» tells somebody the round is
 * real and where the four gaps are. Returning only the cycle would leave «did that work?» to be
 * answered by reloading a queue and counting.
 */
export const openPerformanceCycle = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<OpenPerformanceCycle, never, IdParam>(req);
  const { cycle, result } = await performanceCycleService.open(
    ctx,
    params.id,
    body,
    cycleScope(req),
  );
  ok(res, { cycle: toPerformanceCycleDto(cycle), result });
};

export const closePerformanceCycle = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ClosePerformanceCycle, never, IdParam>(req);
  const doc = await performanceCycleService.close(ctx, params.id, body, cycleScope(req));
  ok(res, toPerformanceCycleDto(doc));
};

// ── Reviews ─────────────────────────────────────────────────────────────────

/** Reviews are about PEOPLE, so every read passes the caller's scope on both axes (D14). */
const reviewScope = (req: Request) => scopeSelector(authContext(req), 'performanceReview.view');

export const listPerformanceReviews = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListPerformanceReviewsQuery>(req);
  okPage(res, await performanceReviewService.list(query, reviewScope(req)), toPerformanceReviewDto);
};

export const getPerformanceReview = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  const doc = await performanceReviewService.getById(params.id, reviewScope(req));
  ok(res, toPerformanceReviewDto(doc));
};

export const assignPerformanceEvaluator = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<AssignPerformanceEvaluator, never, IdParam>(req);
  const doc = await performanceReviewService.assignEvaluator(
    ctx,
    params.id,
    body,
    reviewScope(req),
  );
  ok(res, toPerformanceReviewDto(doc));
};

/**
 * The four acts. Each takes the review's version and returns the row as it now stands, so a screen
 * never has to guess what its own click produced.
 */
export const submitPerformanceReview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<SubmitPerformanceReview, never, IdParam>(req);
  const doc = await performanceReviewService.submit(ctx, params.id, body, reviewScope(req));
  ok(res, toPerformanceReviewDto(doc));
};

export const returnPerformanceReview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ReturnPerformanceReview, never, IdParam>(req);
  const doc = await performanceReviewService.returnToEvaluator(
    ctx,
    params.id,
    body,
    reviewScope(req),
  );
  ok(res, toPerformanceReviewDto(doc));
};

export const finalizePerformanceReview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<FinalizePerformanceReview, never, IdParam>(req);
  const doc = await performanceReviewService.finalize(ctx, params.id, body, reviewScope(req));
  ok(res, toPerformanceReviewDto(doc));
};

export const excusePerformanceReview = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ExcusePerformanceReview, never, IdParam>(req);
  const doc = await performanceReviewService.excuse(ctx, params.id, body, reviewScope(req));
  ok(res, toPerformanceReviewDto(doc));
};

// ── Goals ───────────────────────────────────────────────────────────────────

/** A goal is about a PERSON, so every read passes the caller's scope on both axes (D14). */
const goalScope = (req: Request) => scopeSelector(authContext(req), 'performanceGoal.view');

export const listPerformanceGoals = async (req: Request, res: Response): Promise<void> => {
  const { query } = validated<never, ListPerformanceGoalsQuery>(req);
  okPage(res, await performanceGoalService.list(query, goalScope(req)), toPerformanceGoalDto);
};

export const getPerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  const { params } = validated<never, never, IdParam>(req);
  ok(res, toPerformanceGoalDto(await performanceGoalService.getById(params.id, goalScope(req))));
};

export const createPerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body } = validated<CreatePerformanceGoal>(req);
  const doc = await performanceGoalService.create(ctx, body, goalScope(req));
  created(res, toPerformanceGoalDto(doc), `/api/v1/hr/performance/goals/${String(doc._id)}`);
};

export const updatePerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<UpdatePerformanceGoal, never, IdParam>(req);
  const doc = await performanceGoalService.update(ctx, params.id, body, goalScope(req));
  ok(res, toPerformanceGoalDto(doc));
};

export const progressPerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ProgressPerformanceGoal, never, IdParam>(req);
  const doc = await performanceGoalService.progress(ctx, params.id, body, goalScope(req));
  ok(res, toPerformanceGoalDto(doc));
};

export const closePerformanceGoal = async (req: Request, res: Response): Promise<void> => {
  const ctx = authContext(req);
  const { body, params } = validated<ClosePerformanceGoal, never, IdParam>(req);
  const doc = await performanceGoalService.close(ctx, params.id, body, goalScope(req));
  ok(res, toPerformanceGoalDto(doc));
};
