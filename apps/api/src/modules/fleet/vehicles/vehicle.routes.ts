import { Router } from 'express';
import { z } from 'zod';
import {
  ChangeFleetVehicleStatusSchema,
  CreateFleetVehicleSchema,
  ListFleetVehiclesQuerySchema,
  UpdateFleetVehicleSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  changeVehicleStatus,
  createVehicle,
  deleteVehicle,
  getVehicle,
  listVehicles,
  updateVehicle,
} from './vehicle.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetVehiclesRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetVehicle.view'),
    validate({ query: ListFleetVehiclesQuerySchema }),
    asyncHandler(listVehicles),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetVehicle.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getVehicle),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetVehicle.create'),
    validate({ body: CreateFleetVehicleSchema }),
    asyncHandler(createVehicle),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetVehicle.edit'),
    validate({ body: UpdateFleetVehicleSchema, params: IdParamSchema }),
    asyncHandler(updateVehicle),
  );
  router.post(
    '/:id/status',
    authenticate,
    authorize('fleetVehicle.changeStatus'),
    validate({ body: ChangeFleetVehicleStatusSchema, params: IdParamSchema }),
    asyncHandler(changeVehicleStatus),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetVehicle.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteVehicle),
  );
  return router;
};
