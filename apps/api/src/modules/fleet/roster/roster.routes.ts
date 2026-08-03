import { Router } from 'express';
import { FleetRosterQuerySchema, PlanFleetRosterSchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getRosterDay, planRoster } from './roster.controller';

export const buildFleetRosterRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('fleetRoster.view'),
    validate({ query: FleetRosterQuerySchema }),
    asyncHandler(getRosterDay),
  );
  router.post(
    '/',
    authenticate,
    authorize('fleetRoster.plan'),
    validate({ body: PlanFleetRosterSchema }),
    asyncHandler(planRoster),
  );
  return router;
};
