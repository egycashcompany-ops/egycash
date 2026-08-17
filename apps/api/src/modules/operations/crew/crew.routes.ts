// The crew board. One `plan` grant covers assigning, moving and clearing — the fleet-roster
// precedent: they are the same operation on the same board, not separately delegable decisions.
import { Router } from 'express';
import { z } from 'zod';
import {
  ListOperationsCrewRequirementsQuerySchema,
  OperationsCrewBoardQuerySchema,
  OperationsCrewDirectoryQuerySchema,
  PlanOperationsCrewSchema,
  SetOperationsCrewRequirementsSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  getCrewBoard,
  getCrewDirectory,
  listCrewRequirements,
  planCrew,
  removeCrewRequirements,
  setCrewRequirements,
} from './crew.controller';

const EmployeeParamSchema = z.object({ employeeId: objectId() }).strict();

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

  // The pool the board drags from. Read behind `operationsCrew.view` — seeing who is available is
  // part of reading the board, not a separate decision.
  router.get(
    '/directory',
    authenticate,
    authorize('operationsCrew.view'),
    validate({ query: OperationsCrewDirectoryQuerySchema }),
    asyncHandler(getCrewDirectory),
  );

  // The legacy `/requirement` screen. Maintaining the roster is a PLANNING decision — who counts
  // as operations crew and what they carry — so it rides the same grant as planning the board.
  router.get(
    '/requirements',
    authenticate,
    authorize('operationsCrew.view'),
    validate({ query: ListOperationsCrewRequirementsQuerySchema }),
    asyncHandler(listCrewRequirements),
  );
  router.put(
    '/requirements/:employeeId',
    authenticate,
    authorize('operationsCrew.plan'),
    validate({ params: EmployeeParamSchema, body: SetOperationsCrewRequirementsSchema }),
    asyncHandler(setCrewRequirements),
  );
  router.delete(
    '/requirements/:employeeId',
    authenticate,
    authorize('operationsCrew.plan'),
    validate({ params: EmployeeParamSchema }),
    asyncHandler(removeCrewRequirements),
  );

  return router;
};
