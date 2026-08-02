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
import {
  createDriverProfile,
  getDriverProfile,
  listDriverProfiles,
  updateDriverProfile,
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
  return router;
};
