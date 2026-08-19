import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetDriverProfileSchema,
  ListFleetDriversQuerySchema,
  UpdateFleetDriverProfileSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { multipartSingle } from '../license-image-upload';
import {
  createDriverProfile,
  deleteDriverLicenseImage,
  getDriverLicenseImage,
  getDriverProfile,
  listDriverProfiles,
  updateDriverProfile,
  uploadDriverLicenseImage,
} from './driver-profile.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetDriversRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetDriver.view'),
    validate({ query: ListFleetDriversQuerySchema }),
    asyncHandler(listDriverProfiles),
  );
  router.get(
    '/:id',
    authenticate,
    authorize('fleetDriver.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getDriverProfile),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetDriver.manage'),
    validate({ body: CreateFleetDriverProfileSchema }),
    asyncHandler(createDriverProfile),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetDriver.manage'),
    validate({ body: UpdateFleetDriverProfileSchema, params: IdParamSchema }),
    asyncHandler(updateDriverProfile),
  );
  // The licence image rides on the DRIVER PROFILE's own grants: whoever may manage a profile may
  // manage its licence scan, and whoever may view one may see it. No separate permission.
  router.get(
    '/:id/license-image',
    authenticate,
    authorize('fleetDriver.view'),
    validate({ params: IdParamSchema }),
    asyncHandler(getDriverLicenseImage),
  );
  router.post(
    '/:id/license-image',
    authenticate,
    authorize('fleetDriver.manage'),
    multipartSingle(),
    validate({ params: IdParamSchema }),
    asyncHandler(uploadDriverLicenseImage),
  );
  router.delete(
    '/:id/license-image',
    authenticate,
    authorize('fleetDriver.manage'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteDriverLicenseImage),
  );
  return router;
};
