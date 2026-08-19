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
import { multipartSingle } from '../license-image-upload';
import {
  changeVehicleStatus,
  createVehicle,
  deleteVehicle,
  deleteVehicleLicenseImage,
  getDefaultBranch,
  getVehicle,
  getVehicleLicenseImage,
  listVehicles,
  updateVehicle,
  uploadVehicleLicenseImage,
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
  // Declared before '/:id' so the literal path wins over the parameter.
  router.get(
    '/default-branch',
    authenticate,
    authorize('fleetVehicle.view'),
    asyncHandler(getDefaultBranch),
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
  // The license image rides on the VEHICLE's own grants (§13): whoever may edit a vehicle may
  // manage its license scan, and whoever may view one may see it. No separate permission.
  router.get(
    '/:id/license-image',
    authenticate,
    authorize('fleetVehicle.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getVehicleLicenseImage),
  );
  router.post(
    '/:id/license-image',
    authenticate,
    authorize('fleetVehicle.edit'),
    multipartSingle(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadVehicleLicenseImage),
  );
  router.delete(
    '/:id/license-image',
    authenticate,
    authorize('fleetVehicle.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteVehicleLicenseImage),
  );
  return router;
};
