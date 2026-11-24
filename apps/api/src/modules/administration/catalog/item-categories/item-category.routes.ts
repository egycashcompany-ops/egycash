// Item categories (design §19.3): the units' gate — `administrationCatalog.manage` reads and
// writes; the read takes `administrationItem.view` too once that key ships (P1a.2), so the item
// form's category list populates for an item editor. Writes are also held to organization scope
// in the service (OD-04 A): one taxonomy for the whole company.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationItemCategorySchema,
  ListAdministrationItemCategoriesQuerySchema,
  UpdateAdministrationItemCategorySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import {
  createAdministrationItemCategory,
  listAdministrationItemCategories,
  updateAdministrationItemCategory,
} from './item-category.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAdministrationItemCategoriesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('administrationCatalog.manage'),
    validate({ query: ListAdministrationItemCategoriesQuerySchema }),
    asyncHandler(listAdministrationItemCategories),
  );
  router.post(
    '/',
    authenticate,
    authorize('administrationCatalog.manage'),
    validate({ body: CreateAdministrationItemCategorySchema }),
    asyncHandler(createAdministrationItemCategory),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('administrationCatalog.manage'),
    validate({ body: UpdateAdministrationItemCategorySchema, params: IdParamSchema }),
    asyncHandler(updateAdministrationItemCategory),
  );
  return router;
};
