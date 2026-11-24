// Units (design §19.3): `administrationCatalog.manage` writes; reading takes it OR
// `administrationItem.view` — the item form's unit list and the register's unit label must
// populate for an item reader, as IT's catalog takes its asset key, and the catalogs screen must
// read what its key manages: managing a catalog you cannot read is not a permission boundary, it is
// a broken one. It widens nothing: the rows are names every item already shows. Writes are also
// held to organization scope in the service (OD-04 A): a unit is one fact for the whole company.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateAdministrationCatalogItemSchema,
  ListAdministrationCatalogItemsQuerySchema,
  UpdateAdministrationCatalogItemSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../../platform/auth';
import { authorize, authorizeAny } from '../../../../platform/rbac';
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
    authorizeAny('administrationItem.view', 'administrationCatalog.manage'),
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
