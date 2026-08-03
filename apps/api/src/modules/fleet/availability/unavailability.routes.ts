import { Router } from 'express';
import { z } from 'zod';
import {
  CreateFleetUnavailabilitySchema,
  ListFleetUnavailabilityQuerySchema,
  UpdateFleetUnavailabilitySchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  cancelUnavailability,
  createUnavailability,
  listUnavailability,
  updateUnavailability,
} from './unavailability.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetAvailabilityRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetAvailability.view'),
    validate({ query: ListFleetUnavailabilityQuerySchema }),
    asyncHandler(listUnavailability),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetAvailability.record'),
    validate({ body: CreateFleetUnavailabilitySchema }),
    asyncHandler(createUnavailability),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetAvailability.edit'),
    validate({ body: UpdateFleetUnavailabilitySchema, params: IdParamSchema }),
    asyncHandler(updateUnavailability),
  );
  // `edit` covers cancellation (design §7) — ending a span early and deleting it are one grant.
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetAvailability.edit'),
    validate({ params: IdParamSchema }),
    asyncHandler(cancelUnavailability),
  );
  return router;
};
