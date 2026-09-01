import { Router } from 'express';
import { z } from 'zod';
import {
  CorrectFleetOdometerSchema,
  FleetOdometerBracketQuerySchema,
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
  listOdometerLogs,
  odometerBracket,
  recordOdometer,
} from './odometer.controller';
// The SAME handler `/fleet/maintenance/alarms` is mounted with — one projection, two permissions.
import { listMaintenanceAlarms } from '../maintenance/maintenance.controller';

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
  // Where a counter dated `on` would have to sit to be a point on this chain. The odometer
  // audience's door to it; `/fleet/maintenance/odometer-bracket` is the workshop's, same handler.
  router.get(
    '/bracket',
    authenticate,
    authorize('fleetOdometer.view'),
    validate({ query: FleetOdometerBracketQuerySchema }),
    asyncHandler(odometerBracket),
  );
  // FR-3 — the derived alarm projection for every active vehicle, computed on read. Kept exactly
  // as it was: this is the odometer audience's door to it, and existing clients still use it.
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
