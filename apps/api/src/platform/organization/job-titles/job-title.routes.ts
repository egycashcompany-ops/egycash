import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { validate } from '../../../infrastructure/http/validate';
import { authenticate } from '../../auth';
import { authorize } from '../../rbac';
import {
  CreateJobTitleSchema,
  ListOrgUnitsQuerySchema,
  UpdateJobTitleSchema,
} from './job-title.validation';
import {
  createJobTitle,
  deleteJobTitle,
  getJobTitle,
  jobTitleOptions,
  listJobTitles,
  updateJobTitle,
} from './job-title.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildJobTitlesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('jobTitle.view'),
    validate({ query: ListOrgUnitsQuerySchema }),
    asyncHandler(listJobTitles),
  );
  // Declared BEFORE `/:id`, or `options` is read as an id and rejected as a malformed ObjectId.
  // Authenticated but not gated by `jobTitle.view`: a user who may write a notification rule must
  // be able to name a job title without being able to read the catalogue (org-unit.http.ts §).
  router.get('/options', authenticate, asyncHandler(jobTitleOptions));
  router.get(
    '/:id',
    authenticate,
    authorize('jobTitle.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getJobTitle),
  );
  router.post(
    '/',
    authenticate,
    authorize('jobTitle.create'),
    validate({ body: CreateJobTitleSchema }),
    asyncHandler(createJobTitle),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('jobTitle.edit'),
    validate({ body: UpdateJobTitleSchema, params: IdParamSchema }),
    asyncHandler(updateJobTitle),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('jobTitle.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteJobTitle),
  );
  return router;
};
