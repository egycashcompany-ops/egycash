// Item categories (design §19.3): the units' gate — `administrationCatalog.manage` writes, and the
// read takes it OR `administrationItem.view`, so the item form's category and subcategory lists and
// the register's category filter populate for an item reader — OR a supplier's write keys, so the
// supplier form can pick the categories a supplier supplies (§7.1: a picker's gate grows with the
// keys that need it). It widens nothing: the rows are names every item and supplier already shows.
// Writes are also held to organization scope in the service (OD-04 A): one taxonomy for the whole
// company.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationItemCategorySchema,
  ListAdministrationItemCategoriesQuerySchema,
  UpdateAdministrationItemCategorySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
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
    authorizeAny(
      'administrationItem.view',
      'administrationCatalog.manage',
      'administrationSupplier.create',
      'administrationSupplier.edit',
    ),
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
