import { Router } from 'express';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler } from '../../../platform/web';
import { listFleetPeople } from './people.controller';

export const buildFleetPeopleRouter = (): Router => {
  const router = Router();
  // The DRIVERS' own view grant, not a new one and not HR's. Whoever may look at the drivers
  // registry may read the names on it; that is the same permission, asked of the same people.
  router.get('/', authenticate, authorize('fleetDriver.view'), asyncHandler(listFleetPeople));
  return router;
};
