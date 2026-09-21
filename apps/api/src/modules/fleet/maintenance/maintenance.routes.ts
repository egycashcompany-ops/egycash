import { Router } from 'express';
import { z } from 'zod';
import {
  CheckInFleetMaintenanceSchema,
  CheckOutFleetMaintenanceSchema,
  FleetOdometerBracketQuerySchema,
  ListFleetMaintenanceQuerySchema,
  ReopenFleetMaintenanceSchema,
  UpdateFleetMaintenanceSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  checkInMaintenance,
  checkOutMaintenance,
  deleteMaintenance,
  listMaintenanceAlarms,
  listMaintenanceVisits,
  reopenMaintenance,
  updateMaintenance,
} from './maintenance.controller';
// The SAME handler `/fleet/odometer/bracket` is mounted with — one rule, two permissions.
import { odometerBracket } from '../odometer/odometer.controller';

const IdParamSchema = z.object({ id: objectId() }).strict();

export const buildFleetMaintenanceRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetMaintenance.view'),
    validate({ query: ListFleetMaintenanceQuerySchema }),
    asyncHandler(listMaintenanceVisits),
  );
  /**
   * The alarm projection, for the audience that runs the workshop (FR-3).
   *
   * The SAME handler and therefore the same `computeAlarms()` as `GET /fleet/odometer/alarms`;
   * only `authorize(...)` differs. Whoever records a service can see what it did to the cycle
   * without also being granted the odometer log, and neither route can drift from the other
   * because there is one projection and one function behind both.
   *
   * Safe above the `:id` routes and independent of ordering: this router has no `GET /:id`.
   */
  router.get(
    '/alarms',
    authenticate,
    authorize('fleetMaintenance.view'),
    asyncHandler(listMaintenanceAlarms),
  );
  /**
   * The odometer bracket for a vehicle on a date — the workshop's door to it.
   *
   * The counter typed into a check-in, a check-out or an edit is exactly the number this rule is
   * about, so the people typing it must be able to ask. Behind `fleetOdometer.view` alone the
   * request would 403 for a maintenance-only operator and the dialog would render normally with
   * no warning at all — a safety net that disappears silently for precisely its audience, which
   * is worse than not having one. Same handler as `/fleet/odometer/bracket`, only the
   * `authorize(...)` differs, so the two answers cannot drift.
   */
  router.get(
    '/odometer-bracket',
    authenticate,
    authorize('fleetMaintenance.view'),
    validate({ query: FleetOdometerBracketQuerySchema }),
    asyncHandler(odometerBracket),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetMaintenance.checkIn'),
    validate({ body: CheckInFleetMaintenanceSchema }),
    asyncHandler(checkInMaintenance),
  );
  router.post(
    '/:id/check-out',
    authenticate,
    authorize('fleetMaintenance.checkOut'),
    validate({ body: CheckOutFleetMaintenanceSchema, params: IdParamSchema }),
    asyncHandler(checkOutMaintenance),
  );
  // `checkOut` covers its own undo (legacy deleted_dock=5) — one grant for both directions.
  router.post(
    '/:id/reopen',
    authenticate,
    authorize('fleetMaintenance.checkOut'),
    validate({ body: ReopenFleetMaintenanceSchema, params: IdParamSchema }),
    asyncHandler(reopenMaintenance),
  );
  router.patch(
    '/:id',
    authenticate,
    authorize('fleetMaintenance.edit'),
    validate({ body: UpdateFleetMaintenanceSchema, params: IdParamSchema }),
    asyncHandler(updateMaintenance),
  );
  router.delete(
    '/:id',
    authenticate,
    authorize('fleetMaintenance.delete'),
    validate({ params: IdParamSchema }),
    asyncHandler(deleteMaintenance),
  );
  return router;
};
