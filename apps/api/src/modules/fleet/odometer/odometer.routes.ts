import { Router } from 'express';
import { z } from 'zod';
import {
  CorrectFleetOdometerSchema,
  FleetVehicleIdQuerySchema,
  ListFleetOdometerQuerySchema,
  RecordFleetOdometerSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  correctOdometer,
  expectedOdometerReading,
  listMaintenanceAlarms,
  listOdometerLogs,
  recordOdometer,
} from './odometer.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetOdometerRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetOdometer.view'),
    validate({ query: ListFleetOdometerQuerySchema }),
    asyncHandler(listOdometerLogs),
  );
  // H2's fate — the server says what reading is expected next; the client never computes it.
  router.get(
    '/expected',
    authenticate,
    authorize('fleetOdometer.view'),
    validate({ query: FleetVehicleIdQuerySchema }),
    asyncHandler(expectedOdometerReading),
  );
  // FR-3 — the derived alarm projection for every active vehicle, computed on read.
  router.get(
    '/alarms',
    authenticate,
    authorize('fleetOdometer.view'),
    asyncHandler(listMaintenanceAlarms),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetOdometer.record'),
    validate({ body: RecordFleetOdometerSchema }),
    asyncHandler(recordOdometer),
  );
  // The ONLY way past the monotonic guard (owner FL-4 point 1) — separately granted, audited.
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetOdometer.correct'),
    validate({ body: CorrectFleetOdometerSchema, params: IdParamSchema }),
    asyncHandler(correctOdometer),
  );
  return router;
};
