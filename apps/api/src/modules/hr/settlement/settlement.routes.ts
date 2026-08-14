// Router: authenticate → authorize → validate → controller.
//
// NO PERMISSION OF ITS OWN, deliberately. Everything this route answers is that person's pay: the
// exit month's compensation, what is still owed on their loan, the leave they lost. Reading pay is
// already governed by `employee.viewCompensation`, and a second key over the same facts would mean
// somebody could be refused the summary while allowed each of its four sources — a distinction the
// data does not support. PY-3's compensation read made the same call for the same reason.
import { Router } from 'express';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { EmployeeIdParamSchema } from '../employee-management/employees/employee.validation';
import { getEmployeeSettlement } from './settlement.controller';

/** Mounted under `/hr/employees` — the path is relative to `/:id`. */
export const buildSettlementRouter = (): Router => {
  const router = Router();
  router.get(
    '/:id/settlement',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeSettlement),
  );
  return router;
};
