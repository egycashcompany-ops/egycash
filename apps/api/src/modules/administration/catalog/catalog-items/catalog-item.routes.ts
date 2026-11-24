// Units (design §19.3): one key, `administrationCatalog.manage`, reads and writes alike. Reading
// will also take `administrationItem.view` once that key ships (P1a.2) — the item form's unit list
// must populate for an item editor — as IT's catalog takes its asset key: managing a catalog you
// cannot read is not a permission boundary, it is a broken one. Until then the manage key is the
// only key that exists to read with. Writes are also held to organization scope in the service
// (OD-04 A): a unit is one fact for the whole company.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationCatalogItemSchema,
  ListAdministrationCatalogItemsQuerySchema,
  UpdateAdministrationCatalogItemSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { asyncHandler, validate } from '../../../../platform/web';
import {
  createAdministrationCatalogItem,
  listAdministrationCatalogItems,
  updateAdministrationCatalogItem,
} from './catalog-item.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildAdministrationCatalogItemsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('administrationCatalog.manage'),
    validate({ query: ListAdministrationCatalogItemsQuerySchema }),
    asyncHandler(listAdministrationCatalogItems),
  );
  router.post(
    '/',
    authenticate,
    authorize('administrationCatalog.manage'),
    validate({ body: CreateAdministrationCatalogItemSchema }),
    asyncHandler(createAdministrationCatalogItem),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('administrationCatalog.manage'),
    validate({ body: UpdateAdministrationCatalogItemSchema, params: IdParamSchema }),
    asyncHandler(updateAdministrationCatalogItem),
  );
  return router;
};
