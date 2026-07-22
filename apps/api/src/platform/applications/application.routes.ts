import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  CreateApplicationSchema,
  ListApplicationsQuerySchema,
  UpdateApplicationSchema,
} from './application.validation';
import {
  createApplication,
  deleteApplication,
  getApplication,
  listApplications,
  updateApplication,
} from './application.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildApplicationsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('application.view'),
    validate({ query: ListApplicationsQuerySchema }),
    asyncHandler(listApplications),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('application.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getApplication),
  );
  router.post(
    '/',
    authenticate,
    authorize('application.create'),
    validate({ body: CreateApplicationSchema }),
    asyncHandler(createApplication),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('application.edit'),
    validate({ body: UpdateApplicationSchema, params: IdParamSchema }),
    asyncHandler(updateApplication),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('application.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteApplication),
  );
  return router;
};
