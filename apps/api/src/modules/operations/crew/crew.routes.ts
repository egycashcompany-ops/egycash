// The crew board. One `plan` grant covers assigning, moving and clearing — the fleet-roster
// precedent: they are the same operation on the same board, not separately delegable decisions.
import { Router } from 'express';
import { OperationsCrewBoardQuerySchema, PlanOperationsCrewSchema } from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import { getCrewBoard, planCrew } from './crew.controller';

export const buildOperationsCrewRouter = (): Router => {
  const router = Router();
  router.get(
    '/',
    authenticate,
    authorize('operationsCrew.view'),
    validate({ query: OperationsCrewBoardQuerySchema }),
    asyncHandler(getCrewBoard),
  );
  router.post(
    '/',
    authenticate,
    authorize('operationsCrew.plan'),
    validate({ body: PlanOperationsCrewSchema }),
    asyncHandler(planCrew),
  );
  return router;
};
