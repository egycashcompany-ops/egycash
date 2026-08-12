// Sections are administered under the SAME grants as the categories they sit inside
// (`applicationCategory.*`). A section is a sub-heading of a category, not a new kind of thing to
// be entitled to — so this adds no permission key and changes no RBAC semantics.
import { Router } from 'express';
import { z } from 'zod';
import { objectId } from '@ecms/contracts';
import { asyncHandler } from '../../infrastructure/http/async-handler';
import { validate } from '../../infrastructure/http/validate';
import { authenticate } from '../auth';
import { authorize } from '../rbac';
import {
  CreateApplicationSectionSchema,
  ListApplicationSectionsQuerySchema,
  ReorderApplicationSectionsSchema,
  UpdateApplicationSectionSchema,
} from './application-section.validation';
import {
  createApplicationSection,
  deleteApplicationSection,
  getApplicationSection,
  listApplicationSections,
  reorderApplicationSections,
  updateApplicationSection,
} from './application-section.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildApplicationSectionsRouter = (): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate,
    authorize('applicationCategory.view'),
    validate({ query: ListApplicationSectionsQuerySchema }),
    asyncHandler(listApplicationSections),
  );
  // Before `/:id`, so the literal segment is not swallowed by the id matcher.
  router.patch(
    '/reorder',
    authenticate,
    authorize('applicationCategory.edit'),
    validate({ body: ReorderApplicationSectionsSchema }),
    asyncHandler(reorderApplicationSections),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('applicationCategory.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getApplicationSection),
  );
  router.post(
    '/',
    authenticate,
    authorize('applicationCategory.create'),
    validate({ body: CreateApplicationSectionSchema }),
    asyncHandler(createApplicationSection),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('applicationCategory.edit'),
    validate({ body: UpdateApplicationSectionSchema, params: IdParamSchema }),
    asyncHandler(updateApplicationSection),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('applicationCategory.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteApplicationSection),
  );
  return router;
};
