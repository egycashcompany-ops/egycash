// `GET /fleet/dashboard` — the module's landing read.
//
// `authorizeAny`, because this door serves five audiences and each is let in by their own grant.
// It is not a weaker gate: what a caller is SHOWN is decided section by section against the same
// permissions inside the controller, so holding one of them opens the door and opens nothing
// behind it that the holder could not already read from its own endpoint.
import { Router } from 'express';
import { asyncHandler } from '../../../infrastructure/http/async-handler';
import { authenticate } from '../../../platform/auth';
import { authorizeAny } from '../../../platform/rbac';
import { getFleetDashboard } from './dashboard.controller';

export const buildFleetDashboardRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorizeAny(
      'fleetVehicle.view',
      'fleetDriver.view',
      'fleetOdometer.view',
      'fleetMaintenance.view',
      'fleetAccident.view',
    ),
    asyncHandler(getFleetDashboard),
  );
  return router;
};
