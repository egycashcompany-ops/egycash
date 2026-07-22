import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  CreateApplicationCategorySchema,
  ListApplicationCategoriesQuerySchema,
  UpdateApplicationCategorySchema,
} from './application-category.validation';
import {
  createApplicationCategory,
  deleteApplicationCategory,
  getApplicationCategory,
  listApplicationCategories,
  updateApplicationCategory,
} from './application-category.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildApplicationCategoriesRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('applicationCategory.view'),
    validate({ query: ListApplicationCategoriesQuerySchema }),
    asyncHandler(listApplicationCategories),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('applicationCategory.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getApplicationCategory),
  );
  router.post(
    '/',
    authenticate,
    authorize('applicationCategory.create'),
    validate({ body: CreateApplicationCategorySchema }),
    asyncHandler(createApplicationCategory),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('applicationCategory.edit'),
    validate({ body: UpdateApplicationCategorySchema, params: IdParamSchema }),
    asyncHandler(updateApplicationCategory),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('applicationCategory.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteApplicationCategory),
  );
  return router;
};
