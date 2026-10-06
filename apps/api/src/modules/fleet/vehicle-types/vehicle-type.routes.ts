// Vehicle types (design §7): reads ride the weakest fleet view permission — every fleet page
// needs the type list to render — while mutations are the maintenance RULE surface, because the
// interval on the type IS the rule.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetVehicleTypeSchema,
  OrderFleetVehicleTypesSchema,
  PaginationQuerySchema,
  UpdateFleetVehicleTypeSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize, authorizeAny } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createVehicleType,
  getVehicleType,
  listVehicleTypes,
  orderVehicleTypes,
  updateVehicleType,
} from './vehicle-type.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetVehicleTypesRouter = (): Router => {
  const router = Router();
  // The list — also from «قوائم الحركة» (fleetCatalog.manage) and the settings page that arranges
  // the makes (fleetMaintenanceRule.manage): a catalog manager without vehicle-view must not get
  // an error on the makes' tab. Reading make names exposes nothing else.
  router.get(
    '/',
    authenticate,
    authorizeAny('fleetVehicle.view', 'fleetCatalog.manage', 'fleetMaintenanceRule.manage'),
    validate({ query: PaginationQuerySchema.strict() }),
    asyncHandler(listVehicleTypes),
  );
  // «هيرتب برضو الماركات» — the makes' order. Static, before `/:id`.
  router.put(
    '/order',
    authenticate,
    authorize('fleetMaintenanceRule.manage'),
    validate({ body: OrderFleetVehicleTypesSchema }),
    asyncHandler(orderVehicleTypes),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetVehicle.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getVehicleType),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetMaintenanceRule.manage'),
    validate({ body: CreateFleetVehicleTypeSchema }),
    asyncHandler(createVehicleType),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetMaintenanceRule.manage'),
    validate({ body: UpdateFleetVehicleTypeSchema, params: IdParamSchema }),
    asyncHandler(updateVehicleType),
  );
  return router;
};
