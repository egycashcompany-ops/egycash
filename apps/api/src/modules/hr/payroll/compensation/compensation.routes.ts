// Router: authenticate → authorize → validate → controller.
//
// One route, read-only, and NO permission of its own: a compensation calculation is compensation,
// so it is gated by the key that already governs reading it. PY-3 added nothing to the registry.
import { Router } from 'express';
import { z } from 'zod';
import { objectId, CompensationQuerySchema } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../../platform/web';
import { authenticate } from '../../../../platform/auth';
import { authorize } from '../../../../platform/rbac';
import { getEmployeeCompensation } from './compensation.controller';

const EmployeeParamSchema = z.object({ employeeId: objectId() }).strict();

export const buildCompensationRouter = (): Router => {
  const router = Router();
  router.get(
    '/:employeeId/compensation',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ query: CompensationQuerySchema, params: EmployeeParamSchema }),
    asyncHandler(getEmployeeCompensation),
  );
  return router;
};
