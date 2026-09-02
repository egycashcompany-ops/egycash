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
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { createCatalogItem, listCatalogItems, updateCatalogItem } from './catalog-item.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetCatalogRouter = (): Router => {
  const router = Router();
  /**
   * The catalogs are the module's VOCABULARY, not the vehicle registry's.
   *
   * Six of the nine kinds are pointed at from outside the registry — `workshop`, `workType` and
   * `sparePart` by a workshop visit, `missionType` by both rosters, `violationType` by a
   * violation — so gating the read on `fleetVehicle.view` alone meant a maintenance clerk opened
   * a check-in dialog with three empty pickers and a table that could not name the workshop it
   * was showing, and a violations clerk could not choose a type at all. Neither failure said
   * anything: the request 403s and the select is simply empty.
   *
   * `fleetCatalog.manage` is in the list for a plainer reason — without it, whoever administers
   * the catalogs could create and rename items but could not LIST them.
   *
   * Reading a vocabulary is not reading the records that use it: no catalog item carries a
   * vehicle, a visit or an amount, so widening the read grants sight of nothing but names an
   * admin curated for these screens to display. Writing stays exactly where it was.
   */
  router.get(
    '/',
    authenticate,
    authorizeAny(
      'fleetVehicle.view',
      'fleetMaintenance.view',
      'fleetRoster.view',
      'fleetViolation.view',
      'fleetCatalog.manage',
    ),
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
