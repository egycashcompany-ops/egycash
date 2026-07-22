import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../auth';
import { authorize } from '../../rbac';
import {
  CreateJobPositionSchema,
  ListJobPositionsQuerySchema,
  UpdateJobPositionSchema,
} from './job-position.validation';
import {
  createJobPosition,
  deleteJobPosition,
  getJobPosition,
  listJobPositions,
  updateJobPosition,
} from './job-position.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildJobPositionsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('jobPosition.view'),
    validate({ query: ListJobPositionsQuerySchema }),
    asyncHandler(listJobPositions),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('jobPosition.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getJobPosition),
  );
  router.post(
    '/',
    authenticate,
    authorize('jobPosition.create'),
    validate({ body: CreateJobPositionSchema }),
    asyncHandler(createJobPosition),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('jobPosition.edit'),
    validate({ body: UpdateJobPositionSchema, params: IdParamSchema }),
    asyncHandler(updateJobPosition),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('jobPosition.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteJobPosition),
  );
  return router;
};
