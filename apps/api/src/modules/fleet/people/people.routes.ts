import { Router } from 'express';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { FleetPeopleQuerySchema } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { listFleetPeople } from './people.controller';

export const buildFleetPeopleRouter = (): Router => {
  const router = Router();
  // The DRIVERS' own view grant, not a new one and not HR's. Whoever may look at the drivers
  // registry may read the names on it; that is the same permission, asked of the same people.
  // `?includeExited=true` adds the drivers who have left — the violations screen's list.
  router.get(
    '/',
    authenticate,
    authorize('fleetDriver.view'),
    validate({ query: FleetPeopleQuerySchema }),
    asyncHandler(listFleetPeople),
  );
  return router;
};
