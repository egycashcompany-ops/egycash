import { Router } from 'express';
import { SaveFleetFixedRosterSchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getFixedRoster, saveFixedRoster } from './fixed-roster.controller';

export const buildFleetFixedRosterRouter = (): Router => {
  const router = Router();
  // The same grants as the daily board: §7 gives one view grant and one planning grant for the
  // whole assignment surface, and a standing crew is that surface, not a new delegable decision.
  router.get('/', authenticate, authorize('fleetRoster.view'), asyncHandler(getFixedRoster));
  router.post(
    '/',
    authenticate,
    authorize('fleetRoster.plan'),
    validate({ body: SaveFleetFixedRosterSchema }),
    asyncHandler(saveFixedRoster),
  );
  return router;
};
