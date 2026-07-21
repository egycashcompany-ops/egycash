// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1).
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  cancelInterview,
  createInterviewStage,
  decideInterview,
  getInterview,
  listAwaitingInterviews,
  listInterviewStages,
  listInterviews,
  reassignInterviewPanel,
  rescheduleInterview,
  scheduleInterview,
  skipInterviewer,
  submitInterviewEvaluation,
  updateInterviewStage,
} from './interview.controller';
import {
  CancelInterviewSchema,
  CreateInterviewStageSchema,
  DecideInterviewSchema,
  InterviewIdParamSchema,
  InterviewStageIdParamSchema,
  ListAwaitingInterviewsQuerySchema,
  ListInterviewStagesQuerySchema,
  ListInterviewsQuerySchema,
  ReassignInterviewPanelSchema,
  RescheduleInterviewSchema,
  ScheduleInterviewSchema,
  SkipInterviewerSchema,
  SubmitInterviewEvaluationSchema,
  UpdateInterviewStageSchema,
} from './interview.validation';

export const buildInterviewsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('interview.view'),
    validate({ query: ListInterviewsQuerySchema }),
    asyncHandler(listInterviews),
  );
  // Pipeline entry: applicants awaiting their first interview (declared before `/:id`).
  router.get(
    '/awaiting',
    authenticate,
    authorize('interview.view'),
    validate({ query: ListAwaitingInterviewsQuerySchema }),
    asyncHandler(listAwaitingInterviews),
  );
  router.post(
    '/',
    authenticate,
    authorize('interview.create'),
    validate({ body: ScheduleInterviewSchema }),
    asyncHandler(scheduleInterview),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('interview.view'),
    validate({ params: InterviewIdParamSchema }),
    asyncHandler(getInterview),
  );
  router.post(
    '/:id/reschedule',
    authenticate,
    authorize('interview.edit'),
    validate({ body: RescheduleInterviewSchema, params: InterviewIdParamSchema }),
    asyncHandler(rescheduleInterview),
  );
  router.post(
    '/:id/panel',
    authenticate,
    authorize('interview.edit'),
    validate({ body: ReassignInterviewPanelSchema, params: InterviewIdParamSchema }),
    asyncHandler(reassignInterviewPanel),
  );
  router.post(
    '/:id/panel/skip',
    authenticate,
    authorize('interview.edit'),
    validate({ body: SkipInterviewerSchema, params: InterviewIdParamSchema }),
    asyncHandler(skipInterviewer),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('interview.cancel'),
    validate({ body: CancelInterviewSchema, params: InterviewIdParamSchema }),
    asyncHandler(cancelInterview),
  );
  router.post(
    '/:id/evaluations',
    authenticate,
    authorize('interview.evaluate'),
    validate({ body: SubmitInterviewEvaluationSchema, params: InterviewIdParamSchema }),
    asyncHandler(submitInterviewEvaluation),
  );
  router.post(
    '/:id/decide',
    authenticate,
    authorize('interview.decide'),
    validate({ body: DecideInterviewSchema, params: InterviewIdParamSchema }),
    asyncHandler(decideInterview),
  );

  return router;
};

export const buildInterviewStagesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('interview.view'),
    validate({ query: ListInterviewStagesQuerySchema }),
    asyncHandler(listInterviewStages),
  );
  router.post(
    '/',
    authenticate,
    authorize('interviewStage.manage'),
    validate({ body: CreateInterviewStageSchema }),
    asyncHandler(createInterviewStage),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('interviewStage.manage'),
    validate({ body: UpdateInterviewStageSchema, params: InterviewStageIdParamSchema }),
    asyncHandler(updateInterviewStage),
  );
  return router;
};
