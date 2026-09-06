import { Router } from 'express';
import { z } from 'zod';
import {
  FleetViolationRollupQuerySchema,
  ListFleetViolationsQuerySchema,
  RecordFleetDriverViolationSchema,
  RecordFleetDriverViolationsSchema,
  RecordFleetVehicleViolationSchema,
  SetFleetGrievanceSchema,
  SetFleetViolationCollectedSchema,
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
  recordDriverViolations,
  recordVehicleViolation,
  setGrievance,
  setViolationCollected,
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
  // The drivers' bar files a vehicle's fines in one act — all of them, or none (see the service).
  router.post(
    '/driver/batch',
    authenticate,
    authorize('fleetViolation.record'),
    validate({ body: RecordFleetDriverViolationsSchema }),
    asyncHandler(recordDriverViolations),
  );
  // Collecting is its own grant: the cashier who ticks a row is not the clerk who corrects it.
  router.patch(
    '/:id/collected',
    authenticate,
    authorize('fleetViolation.collect'),
    validate({ body: SetFleetViolationCollectedSchema, params: IdParamSchema }),
    asyncHandler(setViolationCollected),
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
