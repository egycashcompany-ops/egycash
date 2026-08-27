// Router: authenticate → authorize → validate → controller.
//
// THE PERMISSION SPLIT. `trainingCourse.*` administers the CATALOGUE — configuration, and a small
// group's job. `trainingSession.*` schedules and runs DELIVERIES, which is a larger group's daily
// work, and `trainingSession.conduct` is the one that starts, completes and cancels: completing is
// what will write the immutable records (D7), so it is a heavier act than editing a room booking
// and is not folded into `edit`.
//
// The catalogue is deliberately NOT gated by `trainingSession.view`: somebody scheduling a delivery
// must be able to pick a course, and nothing in the catalogue is sensitive.
import { Router } from 'express';
import { z } from 'zod';
import {
  CancelTrainingEnrollmentSchema,
  CreateTrainingCourseSchema,
  CreateTrainingNominationSchema,
  CreateTrainingSessionSchema,
  DecideTrainingNominationSchema,
  EnrollInTrainingSessionSchema,
  ListTrainingEnrollmentsQuerySchema,
  ListTrainingNominationsQuerySchema,
  ListTrainingCoursesQuerySchema,
  ListTrainingSessionsQuerySchema,
  TransitionTrainingSessionSchema,
  UpdateTrainingCourseSchema,
  UpdateTrainingSessionSchema,
  WithdrawTrainingNominationSchema,
  objectId,
} from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import {
  cancelTrainingEnrollment,
  createTrainingCourse,
  createTrainingNomination,
  createTrainingSession,
  decideTrainingNomination,
  enrollInTrainingSession,
  getTrainingNomination,
  listTrainingEnrollments,
  listTrainingNominations,
  withdrawTrainingNomination,
  getTrainingCourse,
  getTrainingSession,
  listTrainingCourses,
  listTrainingSessions,
  transitionTrainingSession,
  updateTrainingCourse,
  updateTrainingSession,
} from './training.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildTrainingCoursesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    // Authenticated, not gated by `trainingCourse.manage`: picking a course is not administering
    // the catalogue, and the same decoupling `org-unit.http.ts` states for its dropdowns.
    validate({ query: ListTrainingCoursesQuerySchema }),
    asyncHandler(listTrainingCourses),
  );
  router.get(
    '/:id',
    authenticate,
    validate({ params: IdParamSchema }),
    asyncHandler(getTrainingCourse),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingCourse.manage'),
    validate({ body: CreateTrainingCourseSchema }),
    asyncHandler(createTrainingCourse),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('trainingCourse.manage'),
    validate({ body: UpdateTrainingCourseSchema, params: IdParamSchema }),
    asyncHandler(updateTrainingCourse),
  );
  return router;
};

export const buildTrainingSessionsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('trainingSession.view'),
    validate({ query: ListTrainingSessionsQuerySchema }),
    asyncHandler(listTrainingSessions),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('trainingSession.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getTrainingSession),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingSession.create'),
    validate({ body: CreateTrainingSessionSchema }),
    asyncHandler(createTrainingSession),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('trainingSession.edit'),
    validate({ body: UpdateTrainingSessionSchema, params: IdParamSchema }),
    asyncHandler(updateTrainingSession),
  );
  // Its own grant: completing a session is what qualifies people (D7), not a field edit.
  router.post(
    '/:id/transition',
    authenticate,
    authorize('trainingSession.conduct'),
    validate({ body: TransitionTrainingSessionSchema, params: IdParamSchema }),
    asyncHandler(transitionTrainingSession),
  );
  return router;
};

/**
 * Nominations and the seats they create (T3).
 *
 * THE PERMISSION SPLIT IS D3 MADE MECHANICAL. `create` asks; `decide` answers. Two keys, because
 * one key held by one person is not a two-person rule — and the service additionally refuses the
 * nominator their own decision, since a key says what you may do, not who you are.
 *
 * Seats sit on `decide` rather than a key of their own: putting somebody in directly and approving
 * a nomination for them are the same act with and without the paperwork, and taking a seat back is
 * the same authority reversing itself. A third key would suggest they were three different powers.
 */
export const buildTrainingNominationsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('trainingNomination.view'),
    validate({ query: ListTrainingNominationsQuerySchema }),
    asyncHandler(listTrainingNominations),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('trainingNomination.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getTrainingNomination),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingNomination.create'),
    validate({ body: CreateTrainingNominationSchema }),
    asyncHandler(createTrainingNomination),
  );
  router.post(
    '/:id/decide',
    authenticate,
    authorize('trainingNomination.decide'),
    validate({ body: DecideTrainingNominationSchema, params: IdParamSchema }),
    asyncHandler(decideTrainingNomination),
  );
  // On `create`, not `decide`: taking your own request back is not a decision about somebody.
  router.post(
    '/:id/withdraw',
    authenticate,
    authorize('trainingNomination.create'),
    validate({ body: WithdrawTrainingNominationSchema, params: IdParamSchema }),
    asyncHandler(withdrawTrainingNomination),
  );
  return router;
};

export const buildTrainingEnrollmentsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('trainingNomination.view'),
    validate({ query: ListTrainingEnrollmentsQuerySchema }),
    asyncHandler(listTrainingEnrollments),
  );
  router.post(
    '/',
    authenticate,
    authorize('trainingNomination.decide'),
    validate({ body: EnrollInTrainingSessionSchema }),
    asyncHandler(enrollInTrainingSession),
  );
  router.post(
    '/:id/cancel',
    authenticate,
    authorize('trainingNomination.decide'),
    validate({ body: CancelTrainingEnrollmentSchema, params: IdParamSchema }),
    asyncHandler(cancelTrainingEnrollment),
  );
  return router;
};
