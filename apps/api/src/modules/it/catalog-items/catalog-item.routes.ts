// Catalogs (design §7): reads ride `itAsset.view` because the asset form needs the category list;
// mutations are the settings surface, `itCatalog.manage` — one grant for both kinds, the
// `fleetCatalog.manage` precedent.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateItCatalogItemSchema,
  ListItCatalogQuerySchema,
  UpdateItCatalogItemSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItCatalogItem,
  listItCatalogItems,
  updateItCatalogItem,
} from './catalog-item.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItCatalogRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('itAsset.view'),
    validate({ query: ListItCatalogQuerySchema }),
    asyncHandler(listItCatalogItems),
  );
  router.post(
    '/',
    authenticate,
    authorize('itCatalog.manage'),
    validate({ body: CreateItCatalogItemSchema }),
    asyncHandler(createItCatalogItem),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('itCatalog.manage'),
    validate({ body: UpdateItCatalogItemSchema, params: IdParamSchema }),
    asyncHandler(updateItCatalogItem),
  );
  return router;
};
