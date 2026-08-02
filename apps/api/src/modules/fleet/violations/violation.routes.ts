import { Router } from 'express';
import { z } from 'zod';
import {
  FleetViolationRollupQuerySchema,
  ListFleetViolationsQuerySchema,
  RecordFleetDriverViolationSchema,
  RecordFleetVehicleViolationSchema,
  SetFleetGrievanceSchema,
  UpdateFleetViolationSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  deleteViolation,
  getViolationRollup,
  listViolations,
  recordDriverViolation,
  recordVehicleViolation,
  setGrievance,
  updateViolation,
} from './violation.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetViolationsRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetViolation.view'),
    validate({ query: ListFleetViolationsQuerySchema }),
    asyncHandler(listViolations),
  );
  // §2.9 — the annual per-(vehicle, year) rollup, derived at query time.
  router.get(
    '/rollup',
    authenticate,
    authorize('fleetViolation.view'),
    validate({ query: FleetViolationRollupQuerySchema }),
    asyncHandler(getViolationRollup),
  );
  router.post(
    '/vehicle',
    authenticate,
    authorize('fleetViolation.record'),
    validate({ body: RecordFleetVehicleViolationSchema }),
    asyncHandler(recordVehicleViolation),
  );
  router.post(
    '/driver',
    authenticate,
    authorize('fleetViolation.record'),
    validate({ body: RecordFleetDriverViolationSchema }),
    asyncHandler(recordDriverViolation),
  );
  // H9's fate — the ONE per-(vehicle, year) figure; PUT because it is a set/replace.
  router.put(
    '/grievance',
    authenticate,
    authorize('fleetViolation.grievance'),
    validate({ body: SetFleetGrievanceSchema }),
    asyncHandler(setGrievance),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetViolation.edit'),
    validate({ body: UpdateFleetViolationSchema, params: IdParamSchema }),
    asyncHandler(updateViolation),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetViolation.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteViolation),
  );
  return router;
};
