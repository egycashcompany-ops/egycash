// Router: authenticate → authorize → validate → controller.
//
// THE PERMISSION SPLIT. `performanceCycle.manage` defines a round and `performanceCycle.conduct`
// OPENS and CLOSES one — separated because opening writes a row for every employee in scope and
// closing is the act that ends the round, while editing a draft's dates is neither. The same
// reasoning that kept `trainingSession.conduct` out of `trainingSession.edit`.
//
// `performanceReview.view` is its own key rather than folded into the cycle's: a round is a
// company object anybody planning one may read, and the reviews are about NAMED PEOPLE.
import { Router } from 'express';
import { z } from 'zod';
import {
  AssignPerformanceEvaluatorSchema,
  ClosePerformanceCycleSchema,
  ClosePerformanceGoalSchema,
  CreatePerformanceCycleSchema,
  CreatePerformanceGoalSchema,
  ListPerformanceCyclesQuerySchema,
  ListPerformanceGoalsQuerySchema,
  ListPerformanceReviewsQuerySchema,
  OpenPerformanceCycleSchema,
  ProgressPerformanceGoalSchema,
  UpdatePerformanceCycleSchema,
  UpdatePerformanceGoalSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  assignPerformanceEvaluator,
  closePerformanceCycle,
  closePerformanceGoal,
  createPerformanceCycle,
  createPerformanceGoal,
  getPerformanceCycle,
  getPerformanceGoal,
  getPerformanceReview,
  listPerformanceCycles,
  listPerformanceGoals,
  listPerformanceReviews,
  openPerformanceCycle,
  progressPerformanceGoal,
  updatePerformanceCycle,
  updatePerformanceGoal,
} from './performance.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildPerformanceCyclesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('performanceCycle.view'),
    validate({ query: ListPerformanceCyclesQuerySchema }),
    asyncHandler(listPerformanceCycles),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('performanceCycle.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getPerformanceCycle),
  );
  router.post(
    '/',
    authenticate,
    authorize('performanceCycle.manage'),
    validate({ body: CreatePerformanceCycleSchema }),
    asyncHandler(createPerformanceCycle),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('performanceCycle.manage'),
    validate({ body: UpdatePerformanceCycleSchema, params: IdParamSchema }),
    asyncHandler(updatePerformanceCycle),
  );
  router.post(
    '/:id/open',
    authenticate,
    authorize('performanceCycle.conduct'),
    validate({ body: OpenPerformanceCycleSchema, params: IdParamSchema }),
    asyncHandler(openPerformanceCycle),
  );
  router.post(
    '/:id/close',
    authenticate,
    authorize('performanceCycle.conduct'),
    validate({ body: ClosePerformanceCycleSchema, params: IdParamSchema }),
    asyncHandler(closePerformanceCycle),
  );
  return router;
};

export const buildPerformanceReviewsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('performanceReview.view'),
    validate({ query: ListPerformanceReviewsQuerySchema }),
    asyncHandler(listPerformanceReviews),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('performanceReview.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getPerformanceReview),
  );
  /**
   * Assigning is `performanceCycle.conduct`, NOT a review-level key.
   *
   * Naming who reviews whom is running the round, not writing an assessment — and the key that
   * writes assessments does not exist yet (P4). Inventing `performanceReview.assess` here to hang
   * this on would ship a grant nothing enforces, which is worse than no grant: it reads in the
   * matrix like a capability somebody has been given.
   */
  router.patch(
    '/:id/evaluator',
    authenticate,
    authorize('performanceCycle.conduct'),
    validate({ body: AssignPerformanceEvaluatorSchema, params: IdParamSchema }),
    asyncHandler(assignPerformanceEvaluator),
  );
  return router;
};

/**
 * Goals get their own two keys rather than riding on the cycle's.
 *
 * `performanceGoal.manage` is held by whoever sets and moves goals — a line manager working with
 * one person — and that is a different, wider group than the one that opens and closes company
 * rounds. Folding goals into `performanceCycle.conduct` would mean giving every line manager the
 * power to close a company-wide cycle so they could write a goal.
 *
 * PROGRESS AND CLOSE CARRY THE SAME KEY, deliberately. Both are the goal's owner saying what
 * happened to it; the difference between them is whether it is over, not who is entitled to speak.
 */
export const buildPerformanceGoalsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('performanceGoal.view'),
    validate({ query: ListPerformanceGoalsQuerySchema }),
    asyncHandler(listPerformanceGoals),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('performanceGoal.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getPerformanceGoal),
  );
  router.post(
    '/',
    authenticate,
    authorize('performanceGoal.manage'),
    validate({ body: CreatePerformanceGoalSchema }),
    asyncHandler(createPerformanceGoal),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('performanceGoal.manage'),
    validate({ body: UpdatePerformanceGoalSchema, params: IdParamSchema }),
    asyncHandler(updatePerformanceGoal),
  );
  router.post(
    '/:id/progress',
    authenticate,
    authorize('performanceGoal.manage'),
    validate({ body: ProgressPerformanceGoalSchema, params: IdParamSchema }),
    asyncHandler(progressPerformanceGoal),
  );
  router.post(
    '/:id/close',
    authenticate,
    authorize('performanceGoal.manage'),
    validate({ body: ClosePerformanceGoalSchema, params: IdParamSchema }),
    asyncHandler(closePerformanceGoal),
  );
  return router;
};
