// Router: authenticate → authorize → validate → controller. Mounted by the HR manifest
// under /api/v1/hr. Uses the platform web kit for validate/asyncHandler so the module
// never imports infrastructure directly (Module Structure §1).
import { Router } from 'express';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import {
  addScreeningNote,
  createScreening,
  decideScreening,
  getScreening,
  listAwaitingScreenings,
  listScreenings,
} from './screening.controller';
import {
  AddScreeningNoteSchema,
  CreateScreeningSchema,
  DecideScreeningSchema,
  ListAwaitingScreeningsQuerySchema,
  ListScreeningsQuerySchema,
  ScreeningIdParamSchema,
} from './screening.validation';

export const buildScreeningsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('screening.view'),
    validate({ query: ListScreeningsQuerySchema }),
    asyncHandler(listScreenings),
  );
  // Pipeline entry: live applicants with no screening yet (declared before `/:id`).
  router.get(
    '/awaiting',
    authenticate,
    authorize('screening.view'),
    validate({ query: ListAwaitingScreeningsQuerySchema }),
    asyncHandler(listAwaitingScreenings),
  );
  router.post(
    '/',
    authenticate,
    authorize('screening.create'),
    validate({ body: CreateScreeningSchema }),
    asyncHandler(createScreening),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('screening.view'),
    validate({ params: ScreeningIdParamSchema }),
    asyncHandler(getScreening),
  );
  router.post(
    '/:id/notes',
    authenticate,
    authorize('screening.edit'),
    validate({ body: AddScreeningNoteSchema, params: ScreeningIdParamSchema }),
    asyncHandler(addScreeningNote),
  );
  router.post(
    '/:id/decide',
    authenticate,
    authorize('screening.decide'),
    validate({ body: DecideScreeningSchema, params: ScreeningIdParamSchema }),
    asyncHandler(decideScreening),
  );

  return router;
};
