// The standing crew (الطاقم الثابت).
//
// Rides the EXISTING crew grants — `operationsCrew.view` to read, `operationsCrew.plan` to change
// — and declares none of its own. Deciding who crews which vehicle is ONE authority whether it is
// said once or every morning; splitting it would invent a role the business never described.
//
// The precedent is next door and exact: `/operations/requirements` is a settings-shaped crew
// screen under these same two grants, one of five Operations screens with no PageDef at all
// (operations.module.ts:179-185 records the same choice for B5 and B6).
import { Router } from 'express';
import { z } from 'zod';
import { SetOperationsStandingCrewSchema, objectId } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  getStandingCrew,
  removeStandingCrew,
  setStandingCrew,
} from './standing-crew.controller';

const VehicleParamSchema = z.object({ vehicleId: objectId() }).strict();

export const buildOperationsStandingCrewRouter = (): Router => {
  const router = Router();

  // No query schema: this board has no date and nothing else to narrow by. That absence IS the
  // entity — a standing crew that took a date would be a daily crew row wearing another name.
  router.get('/', authenticate, authorize('operationsCrew.view'), asyncHandler(getStandingCrew));

  router.put(
    '/',
    authenticate,
    authorize('operationsCrew.plan'),
    validate({ body: SetOperationsStandingCrewSchema }),
    asyncHandler(setStandingCrew),
  );

  // Removing a vehicle from the cash-transfer fleet. Separate from the save on purpose: the save
  // sends only CHANGED rows, so inferring deletion from a row's absence would empty the fleet the
  // first time somebody saved a single edit.
  router.delete(
    '/:vehicleId',
    authenticate,
    authorize('operationsCrew.plan'),
    validate({ params: VehicleParamSchema }),
    asyncHandler(removeStandingCrew),
  );

  return router;
};
