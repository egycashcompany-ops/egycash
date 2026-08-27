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
  CreatePerformanceCycleSchema,
  ListPerformanceCyclesQuerySchema,
  ListPerformanceReviewsQuerySchema,
  OpenPerformanceCycleSchema,
  UpdatePerformanceCycleSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  assignPerformanceEvaluator,
  closePerformanceCycle,
  createPerformanceCycle,
  getPerformanceCycle,
  getPerformanceReview,
  listPerformanceCycles,
  listPerformanceReviews,
  openPerformanceCycle,
  updatePerformanceCycle,
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
