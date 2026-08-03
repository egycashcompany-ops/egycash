// Vehicle types (design §7): reads ride the weakest fleet view permission — every fleet page
// needs the type list to render — while mutations are the maintenance RULE surface, because the
// interval on the type IS the rule.
import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetVehicleTypeSchema,
  PaginationQuerySchema,
  UpdateFleetVehicleTypeSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  createVehicleType,
  getVehicleType,
  listVehicleTypes,
  updateVehicleType,
} from './vehicle-type.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetVehicleTypesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetVehicle.view'),
    validate({ query: PaginationQuerySchema.strict() }),
    asyncHandler(listVehicleTypes),
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
