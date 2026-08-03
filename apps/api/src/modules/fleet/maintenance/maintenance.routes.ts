import { Router } from 'express';
import { z } from 'zod';
import {
  CheckInFleetMaintenanceSchema,
  CheckOutFleetMaintenanceSchema,
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
  listMaintenanceVisits,
  reopenMaintenance,
  updateMaintenance,
} from './maintenance.controller';

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
