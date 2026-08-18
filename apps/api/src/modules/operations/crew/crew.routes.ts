// The crew board. One `plan` grant covers assigning, moving and clearing — the fleet-roster
// precedent: they are the same operation on the same board, not separately delegable decisions.
import { Router } from 'express';
import { z } from 'zod';
import {
  ListOperationsCrewRequirementsQuerySchema,
  OperationsCrewBoardQuerySchema,
  OperationsCrewAttendanceQuerySchema,
  OperationsCrewDirectoryQuerySchema,
  PlanOperationsCrewSchema,
  SeedOperationsCrewFromStandingSchema,
  SetOperationsCrewRequirementsSchema,
  objectId,
} from '@ecms/contracts';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { asyncHandler, validate } from '../../../platform/web';
import {
  getCrewBoard,
  getCrewAttendance,
  getCrewDirectory,
  listCrewRequirements,
  planCrew,
  seedCrewFromStanding,
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

  // The descent. It WRITES the board, so it rides `operationsCrew.plan` rather than `.view` — and
  // it is a POST rather than something that happens on a GET, because a read must never author a
  // day's crew. The client may fire it whenever it likes: it is idempotent by construction, since
  // a vehicle that already has a crew row is vetoed rather than merged into.
  router.post(
    '/seed',
    authenticate,
    authorize('operationsCrew.plan'),
    validate({ body: SeedOperationsCrewFromStandingSchema }),
    asyncHandler(seedCrewFromStanding),
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

  // The day's attendance beside the roster (B5). TWO grants, chained — `operationsCrew.view` to
  // read the roster and HR's OWN `attendance.view` to read attendance. Chained, not `authorizeAny`,
  // on purpose: this endpoint surfaces another module's data, and it must not become a way to see
  // HR attendance without HR's grant. Read-only, and it gates no assignment (discovery §10.2).
  router.get(
    '/attendance',
    authenticate,
    authorize('operationsCrew.view'),
    authorize('attendance.view'),
    validate({ query: OperationsCrewAttendanceQuerySchema }),
    asyncHandler(getCrewAttendance),
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
