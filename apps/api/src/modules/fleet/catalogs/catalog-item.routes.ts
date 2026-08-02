// Catalogs (design §7): reads ride `fleetVehicle.view` because the forms of every fleet page
// (maintenance check-in, roster, violations) need these lists; mutations are the settings
// surface, `fleetCatalog.manage`.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetCatalogItemSchema,
  ListFleetCatalogQuerySchema,
  UpdateFleetCatalogItemSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { createCatalogItem, listCatalogItems, updateCatalogItem } from './catalog-item.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetCatalogRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetVehicle.view'),
    validate({ query: ListFleetCatalogQuerySchema }),
    asyncHandler(listCatalogItems),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetCatalog.manage'),
    validate({ body: CreateFleetCatalogItemSchema }),
    asyncHandler(createCatalogItem),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetCatalog.manage'),
    validate({ body: UpdateFleetCatalogItemSchema, params: IdParamSchema }),
    asyncHandler(updateCatalogItem),
  );
  return router;
};
