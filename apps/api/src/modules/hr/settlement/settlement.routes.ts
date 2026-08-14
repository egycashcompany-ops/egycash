// Router: authenticate → authorize → validate → controller.
//
// NO PERMISSION OF ITS OWN, deliberately. Everything this route answers is that person's pay: the
// exit month's compensation, what is still owed on their loan, the leave they lost. Reading pay is
// already governed by `employee.viewCompensation`, and a second key over the same facts would mean
// somebody could be refused the summary while allowed each of its four sources — a distinction the
// data does not support. PY-3's compensation read made the same call for the same reason.
import { Router } from 'express';
import { ListSettlementQueueQuerySchema } from '@ecms/contracts';
import { asyncHandler, validate } from '../../../platform/web';
import { authenticate } from '../../../platform/auth';
import { authorize } from '../../../platform/rbac';
import { EmployeeIdParamSchema } from '../employee-management/employees/employee.validation';
import { getEmployeeSettlement, listSettlementQueue } from './settlement.controller';

/** Mounted under `/hr/employees` — the paths are relative to it. */
export const buildSettlementRouter = (): Router => {
  const router = Router();
  /**
   * The queue (P-HR-17), declared FIRST and mounted before the employees router.
   *
   * `/settlement-queue` is one path segment, so `GET /:id` in the employees router would otherwise
   * swallow it and try to read an employee whose id is the word "settlement-queue". This is the
   * same ordering `/rehire-check` already relies on, for the same reason — and the manifest mounts
   * this router ahead of `buildEmployeesRouter()`, which is what makes it work across routers
   * rather than only within one.
   */
  router.get(
    '/settlement-queue',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ query: ListSettlementQueueQuerySchema }),
    asyncHandler(listSettlementQueue),
  );
  router.get(
    '/:id/settlement',
    authenticate,
    authorize('employee.viewCompensation'),
    validate({ params: EmployeeIdParamSchema }),
    asyncHandler(getEmployeeSettlement),
  );
  return router;
};
