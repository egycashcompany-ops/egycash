// Catalogs (design §7): reads take EITHER `itAsset.view` (the asset form needs the category list)
// or `itCatalog.manage` (the catalogs screen manages these rows and must be able to read them);
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
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createItCatalogItem,
  listItCatalogItems,
  updateItCatalogItem,
} from './catalog-item.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildItCatalogRouter = (): Router => {
  const router = Router();
  // Reading the catalog serves two different callers, so it takes EITHER grant (the
  // `contractTemplate.manage | contract.view` precedent):
  //   * `itAsset.view`     — the asset form's category dropdown must populate for someone who can
  //                          only view assets; that is why this gate was `itAsset.view` alone.
  //   * `itCatalog.manage` — but the catalogs SCREEN is `itCatalog.manage` (design §7), so a
  //                          catalog administrator without `itAsset.view` reached a screen whose
  //                          list then 403'd. Managing a catalog you cannot read is not a
  //                          permission boundary, it is a broken one.
  // This widens nothing: `itCatalog.manage` already authorizes creating and editing these very
  // rows, so being able to read them adds no capability its holder did not already have.
  router.get(
    '/',
    authenticate,
    authorizeAny('itAsset.view', 'itCatalog.manage'),
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
